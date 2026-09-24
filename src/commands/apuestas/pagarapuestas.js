const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const db = require("../../core/db");
const { logInfo, logWarn, logError, logDebug } = require("../../core/logger");

const { DEPORTES, DIAS_RESULTADOS, deporteValido, obtenerResultados, resultadoDeScore } = require("../../services/oddsApi");

// Un partido de fútbol dura ~2h desde el inicio: antes de eso no merece la pena gastar
// cuota de la Odds API preguntando por su resultado (lo usa la liquidación automática).
const AUTO_MIN_HORAS_DESDE_INICIO = 2;

if (!process.env.ODDS_API_KEY) {
    logWarn("[PAGARAPUESTAS] ODDS_API_KEY no configurada en .env: no se podrán liquidar apuestas.");
}

/**
 * Partidos y quinielas que ya no se pueden resolver (empezaron hace más de DIAS_RESULTADOS días
 * y siguen sin resultado): se marcan como caducados y se devuelve lo apostado. Sin esto se
 * quedaban abiertos para siempre, con el dinero retenido, y el cron seguía preguntando por
 * ellos a la API cada hora (gastando cuota).
 */
function caducarSinResultado(limite, resumen) {
    const ahoraIso = new Date().toISOString();
    const reembolsar = (userId, cantidad, descripcion) => {
        db.prepare("UPDATE banco SET saldo = saldo + ? WHERE userId = ?").run(cantidad, userId);
        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
            userId,
            ahoraIso,
            descripcion,
            cantidad,
        );
        resumen.reembolsos++;
        resumen.pagos.push({ userId, premio: cantidad, descripcion, reembolso: true });
        logInfo(`[PAGARAPUESTAS] Reembolsadas ${cantidad} monedas a ${userId}: ${descripcion}`);
    };

    const partidos = db
        .prepare(
            `
        SELECT * FROM apuestas_partidos WHERE estado = 'abierto' AND start_time < ?
    `,
        )
        .all(limite);
    const quinielas = db
        .prepare(
            `
        SELECT q.* FROM quinielas q
        WHERE q.estado = 'abierta'
          AND EXISTS (SELECT 1 FROM quiniela_partidos p WHERE p.quiniela_id = q.id AND p.resultado_final IS NULL AND p.start_time < ?)
    `,
        )
        .all(limite);
    if (!partidos.length && !quinielas.length) return;

    db.transaction(() => {
        for (const p of partidos) {
            const apuestas = db.prepare("SELECT * FROM apuestas_usuario WHERE match_id = ? AND pagado = 0").all(p.match_id);
            for (const ap of apuestas) {
                reembolsar(ap.user_id, ap.cantidad, `Reembolso: ${p.home_team} vs ${p.away_team} sin resultado disponible`);
                // premio = cantidad: se le devuelve lo apostado.
                db.prepare("UPDATE apuestas_usuario SET pagado = 1, premio = ? WHERE id = ?").run(ap.cantidad, ap.id);
            }
            db.prepare("UPDATE apuestas_partidos SET estado = 'caducado' WHERE id = ?").run(p.id);
        }
        for (const q of quinielas) {
            const apuestas = db.prepare("SELECT * FROM quiniela_apuestas WHERE quiniela_id = ? AND pagado = 0").all(q.id);
            for (const ap of apuestas) {
                reembolsar(ap.user_id, ap.cantidad, `Reembolso: quiniela ${q.jornada} sin todos los resultados`);
                db.prepare("UPDATE quiniela_apuestas SET pagado = 1, premio = 0 WHERE id = ?").run(ap.id);
            }
            db.prepare("UPDATE quinielas SET estado = 'caducada', cerrada_en = ? WHERE id = ?").run(ahoraIso, q.id);
        }
    })();
    resumen.caducados += partidos.length + quinielas.length;
    logInfo(
        `[PAGARAPUESTAS] Caducados ${partidos.length} partidos y ${quinielas.length} quinielas sin resultado (empezaron hace más de ${DIAS_RESULTADOS} días); ${resumen.reembolsos} apuestas reembolsadas`,
    );
}

let liquidacionEnCurso = false;

/**
 * Cierra los partidos terminados, paga las apuestas ganadoras y liquida las quinielas
 * completadas. Se usa tanto desde /pagarapuestas como desde el cron de index.js.
 * @param {object} opts
 * @param {number} [opts.minHorasDesdeInicio=0] - solo mira partidos empezados hace al menos N horas
 * @param {string} [opts.origen] - para los logs
 * @returns {Promise<object|null>} resumen, o null si ya había una liquidación en marcha
 */
async function liquidarApuestas({ minHorasDesdeInicio = 0, origen = "manual" } = {}) {
    if (liquidacionEnCurso) return null;
    if (!process.env.ODDS_API_KEY) throw new Error("Falta ODDS_API_KEY en .env");
    liquidacionEnCurso = true;
    try {
        const resumen = {
            pagadas: 0,
            fallidas: 0,
            total: 0,
            partidosProcesados: {},
            quinielasCerradas: 0,
            premiosQuiniela: 0,
            caducados: 0,
            reembolsos: 0,
            pagos: [],
        };
        const ahora = Date.now();
        const corte = new Date(ahora - minHorasDesdeInicio * 3600 * 1000).toISOString();
        // La API solo devuelve resultados de los últimos DIAS_RESULTADOS días: lo que empezó antes
        // ya no se puede resolver, y preguntar por ello solo gasta cuota.
        const limite = new Date(ahora - DIAS_RESULTADOS * 24 * 3600 * 1000).toISOString();

        caducarSinResultado(limite, resumen);

        // Los scores de cada deporte se piden una sola vez por liquidación (partidos + quinielas).
        const cacheScores = new Map();
        const scoresDe = async (deporteKey) => {
            if (!cacheScores.has(deporteKey)) {
                const deporte = DEPORTES[deporteKey];
                try {
                    const scores = await obtenerResultados(deporteKey);
                    logInfo(`[PAGARAPUESTAS] API devolvió ${scores.length} resultados para ${deporte.name}`);
                    cacheScores.set(deporteKey, scores);
                } catch (e) {
                    logError(`[PAGARAPUESTAS] Error consultando la API para ${deporte.name}:`, e);
                    cacheScores.set(deporteKey, null);
                }
            }
            return cacheScores.get(deporteKey);
        };

        // --- Apuestas a partidos sueltos ---
        const partidos = db
            .prepare(
                `
            SELECT * FROM apuestas_partidos
            WHERE estado = 'abierto' AND start_time < ? AND start_time >= ?
              -- Solo los que tienen apuestas pendientes: preguntar por el resto gasta cuota para nada.
              AND EXISTS (SELECT 1 FROM apuestas_usuario a WHERE a.match_id = apuestas_partidos.match_id AND a.pagado = 0)
        `,
            )
            .all(corte, limite);
        (partidos.length ? logInfo : logDebug)(`[PAGARAPUESTAS] (${origen}) ${partidos.length} partidos pendientes de cierre`);

        const cerrarPartido = db.transaction((partido, resultado) => {
            db.prepare("UPDATE apuestas_partidos SET estado = 'finalizado', resultado = ? WHERE match_id = ?").run(
                resultado,
                partido.match_id,
            );
            const apuestas = db
                .prepare(
                    `
                SELECT * FROM apuestas_usuario
                WHERE match_id = ? AND pagado = 0
            `,
                )
                .all(partido.match_id);
            for (const ap of apuestas) {
                resumen.total++;
                if (ap.eleccion === resultado) {
                    const premio = Math.round(ap.cantidad * ap.cuota);
                    db.prepare("UPDATE banco SET saldo = saldo + ? WHERE userId = ?").run(premio, ap.user_id);
                    db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
                        ap.user_id,
                        new Date().toISOString(),
                        `Apuesta ganada: ${partido.home_team} vs ${partido.away_team}`,
                        premio,
                    );
                    resumen.pagadas++;
                    resumen.pagos.push({ userId: ap.user_id, premio, descripcion: `${partido.home_team} vs ${partido.away_team}` });
                    logInfo(
                        `[PAGARAPUESTAS] Pagado ${premio} monedas a usuario ${ap.user_id} (apostó ${ap.cantidad} con cuota ${ap.cuota})`,
                    );
                } else {
                    resumen.fallidas++;
                    logInfo(
                        `[PAGARAPUESTAS] Apuesta perdida: usuario ${ap.user_id} perdió ${ap.cantidad} monedas (apostó ${ap.eleccion}, ganó ${resultado})`,
                    );
                }
                db.prepare("UPDATE apuestas_usuario SET pagado = 1, premio = ? WHERE id = ?").run(
                    ap.eleccion === resultado ? Math.round(ap.cantidad * ap.cuota) : 0,
                    ap.id,
                );
            }
        });

        for (const partido of partidos) {
            const deporteKey = deporteValido(partido.deporte);
            const scores = await scoresDe(deporteKey);
            if (!scores) continue;

            const r = resultadoDeScore(scores.find((s) => s.id === partido.match_id));
            if (!r) {
                logDebug(`[PAGARAPUESTAS] Partido ${partido.home_team} vs ${partido.away_team} aún sin resultado final`);
                continue;
            }
            logInfo(`[PAGARAPUESTAS] ${partido.home_team} ${r.home.score}-${r.away.score} ${partido.away_team} -> ${r.resultado}`);
            cerrarPartido(partido, r.resultado);
            resumen.partidosProcesados[deporteKey] = (resumen.partidosProcesados[deporteKey] || 0) + 1;
        }

        // --- Quinielas ---
        // Cada resultado se guarda en cuanto se conoce (quiniela_partidos.resultado_final): una
        // jornada dura de viernes a lunes, y cuando acaba el último partido el primero ya no está
        // en la ventana de la API. Antes solo se guardaban si estaban los 10 a la vez, y así una
        // jornada larga no se podía completar nunca.
        const quinielasAbiertas = db.prepare(`SELECT * FROM quinielas WHERE estado = 'abierta'`).all();

        for (const q of quinielasAbiertas) {
            const deporteKey = deporteValido(q.deporte);
            let partidosQ = db
                .prepare(
                    `
                SELECT * FROM quiniela_partidos WHERE quiniela_id = ? ORDER BY orden ASC
            `,
                )
                .all(q.id);
            if (!partidosQ.length) continue;

            // Una quiniela sin jugadores no se consulta (caducará sola sin nada que devolver).
            const tieneJugadores = !!db.prepare("SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND pagado = 0").get(q.id);
            const consultables = tieneJugadores ? partidosQ.filter((p) => !p.resultado_final && p.start_time < corte) : [];
            if (consultables.length) {
                const scores = await scoresDe(deporteKey);
                if (!scores) continue;
                for (const p of consultables) {
                    const r = resultadoDeScore(scores.find((s) => s.id === p.match_id));
                    if (r) db.prepare(`UPDATE quiniela_partidos SET resultado_final = ? WHERE id = ?`).run(r.resultado, p.id);
                }
                partidosQ = db.prepare(`SELECT * FROM quiniela_partidos WHERE quiniela_id = ? ORDER BY orden ASC`).all(q.id);
            }
            if (partidosQ.some((p) => !p.resultado_final)) continue;

            const resultados = partidosQ.map((p) => ({ partidoId: p.id, resultado: p.resultado_final }));
            const apuestasQ = db
                .prepare(
                    `
                SELECT * FROM quiniela_apuestas WHERE quiniela_id = ? AND pagado = 0
            `,
                )
                .all(q.id);

            const apuestasConAciertos = apuestasQ.map((ap) => {
                const pred = (ap.predicciones || "").toUpperCase();
                let aciertos = 0;
                resultados.forEach((r, i) => {
                    const esperado = r.resultado === "home" ? "1" : r.resultado === "draw" ? "X" : "2";
                    if (pred[i] === esperado) aciertos++;
                });
                return { ...ap, aciertos };
            });

            const maxAciertos = apuestasConAciertos.length ? Math.max(...apuestasConAciertos.map((a) => a.aciertos)) : 0;
            const ganadoras = apuestasConAciertos.filter((a) => a.aciertos === maxAciertos);
            const bote = apuestasConAciertos.reduce((acc, a) => acc + a.cantidad, 0);
            const fondoPremios = Math.floor(bote * 0.9);
            const premioUnitario = ganadoras.length > 0 ? Math.floor(fondoPremios / ganadoras.length) : 0;

            db.transaction(() => {
                for (const a of apuestasConAciertos) {
                    const premio = a.aciertos === maxAciertos ? premioUnitario : 0;
                    if (premio > 0) {
                        db.prepare(`UPDATE banco SET saldo = saldo + ? WHERE userId = ?`).run(premio, a.user_id);
                        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
                            a.user_id,
                            new Date().toISOString(),
                            `Quiniela ganada: ${q.jornada}`,
                            premio,
                        );
                        resumen.pagos.push({ userId: a.user_id, premio, descripcion: `Quiniela ${q.jornada}` });
                    }
                    db.prepare(
                        `
                        UPDATE quiniela_apuestas
                        SET pagado = 1, aciertos = ?, premio = ?
                        WHERE id = ?
                    `,
                    ).run(a.aciertos, premio, a.id);
                }
                db.prepare(`UPDATE quinielas SET estado = 'cerrada', cerrada_en = ? WHERE id = ?`).run(new Date().toISOString(), q.id);
            })();

            resumen.quinielasCerradas++;
            resumen.premiosQuiniela += premioUnitario * ganadoras.length;
            logInfo(`[PAGARAPUESTAS] Quiniela cerrada ${q.id}: ${ganadoras.length} ganadores, premio unitario ${premioUnitario}`);
        }

        (resumen.total || resumen.quinielasCerradas || resumen.caducados ? logInfo : logDebug)(
            `[PAGARAPUESTAS] (${origen}) Completado: ${resumen.pagadas} ganadoras, ${resumen.fallidas} perdedoras, ${resumen.total} total, ${resumen.quinielasCerradas} quinielas, ${resumen.caducados} caducados`,
        );
        return resumen;
    } finally {
        liquidacionEnCurso = false;
    }
}

// Avisa por DM a quien haya cobrado algo. Best-effort: si tiene los DMs cerrados, se ignora.
async function avisarGanadores(client, pagos) {
    for (const p of pagos) {
        try {
            const user = await client.users.fetch(p.userId);
            await user.send(
                p.reembolso
                    ? `↩️ Te he devuelto **${p.premio.toLocaleString("es")}** monedas: ${p.descripcion.replace(/^Reembolso: /, "")} (no hay forma de saber el resultado).`
                    : `🏆 ¡Has ganado **${p.premio.toLocaleString("es")}** monedas con tu apuesta (${p.descripcion})!`,
            );
        } catch (e) {
            (e.code === 50007 ? logDebug : logWarn)(`[PAGARAPUESTAS] No se pudo avisar por DM a ${p.userId}: ${e.message}`);
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("pagarapuestas")
        .setDescription("Revisa partidos finalizados y paga las apuestas ganadoras (se hace solo cada hora)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    liquidarApuestas,
    avisarGanadores,
    AUTO_MIN_HORAS_DESDE_INICIO,

    async run(client, interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "⛔ Solo administradores pueden forzar el pago de apuestas.", ephemeral: true });
            return;
        }
        await interaction.reply({ content: "⏳ Procesando apuestas deportivas...", ephemeral: true });
        logInfo(`[PAGARAPUESTAS] Iniciado por ${interaction.user.username} (${interaction.user.id})`);

        let resumen;
        try {
            resumen = await liquidarApuestas({ origen: `manual:${interaction.user.username}` });
        } catch (e) {
            logError(`[PAGARAPUESTAS] Error en la liquidación manual:`, e);
            await interaction.editReply({ content: `❌ ${e.message}` });
            return;
        }
        if (!resumen) {
            await interaction.editReply({ content: "⏳ Ya hay una liquidación en marcha, prueba en un momento." });
            return;
        }
        void avisarGanadores(client, resumen.pagos);

        let descripcionDeportes = "";
        for (const [deporte, cantidad] of Object.entries(resumen.partidosProcesados)) {
            const deporteInfo = DEPORTES[deporte];
            if (deporteInfo && cantidad > 0) {
                descripcionDeportes += `• ${deporteInfo.name}: **${cantidad}** partidos\n`;
            }
        }

        const nada = resumen.total === 0 && resumen.quinielasCerradas === 0 && resumen.caducados === 0;
        const resumenEmbed = new EmbedBuilder()
            .setTitle("💸 Pago de apuestas deportivas")
            .setDescription(
                `🏆 **Apuestas ganadoras:** ${resumen.pagadas}\n` +
                    `❌ **Apuestas perdedoras:** ${resumen.fallidas}\n` +
                    `📊 **Total procesadas:** ${resumen.total}\n` +
                    `🗓️ **Partidos finalizados:** ${Object.values(resumen.partidosProcesados).reduce((a, b) => a + b, 0)}\n\n` +
                    `🧾 **Quinielas cerradas:** ${resumen.quinielasCerradas}\n` +
                    `🎁 **Premios quiniela repartidos:** ${resumen.premiosQuiniela}\n` +
                    (resumen.caducados
                        ? `↩️ **Sin resultado (más de 3 días):** ${resumen.caducados} · **apuestas reembolsadas:** ${resumen.reembolsos}\n`
                        : "") +
                    "\n" +
                    (descripcionDeportes ? `**Deportes procesados:**\n${descripcionDeportes}\n` : "") +
                    (nada ? "📋 No había apuestas pendientes de pago." : "✅ Procesamiento completado exitosamente."),
            )
            .setColor(resumen.total > 0 ? 0x27ae60 : 0x2980b9)
            .setTimestamp();

        await interaction.editReply({ content: "", embeds: [resumenEmbed] });
    },
};
