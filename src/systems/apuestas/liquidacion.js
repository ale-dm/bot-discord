// Liquidación de apuestas a partidos, retos 1 contra 1 a un partido y quinielas (cron de cada hora en index.js, y el
// botón 💸 Liquidar ahora del panel de admin → ⚽ Apuestas; antes el comando /pagarapuestas). Después: DM a quien
// cobra y, si el servidor tiene canal de resultados, un resumen público de lo cerrado.
const { EmbedBuilder } = require("discord.js");
const db = require("../../core/db");
const dinero = require("../dinero");
const retos = require("../retos");
const mercados = require("./mercados");
const combinadas = require("./combinadas");
const pase = require("../pase/pase");
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
        dinero.pagar(userId, cantidad);
        dinero.apuntar(userId, "apuestas", descripcion, cantidad);
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
            // Las combinadas con una pata en ese partido se devuelven enteras.
            combinadas.caducarPartido(p.match_id, (userId, cantidad, descripcion) => reembolsar(userId, cantidad, descripcion));
            // Los retos 1 contra 1 a ese partido, igual: cada uno recupera lo suyo.
            const devueltos = retos.devolverPorPartido(p.match_id, "el partido se quedó sin resultado");
            resumen.reembolsos += devueltos.pagos.length;
            resumen.pagos.push(...devueltos.pagos);
            resumen.retosCerrados.push(...devueltos.cerrados.map((r) => r.id));
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

/** Aciertos necesarios para cobrar una quiniela: la mitad de los partidos, redondeando hacia arriba. */
function minimoAciertosQuiniela(numPartidos) {
    return Math.ceil(numPartidos / 2);
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
            // Lo que se ha cerrado en esta pasada, para publicarlo en el canal de resultados (anunciarResultados).
            partidos: [],
            quinielas: [],
            retos: [],
            // Ids de todos los retos cerrados (también los devueltos), para repintar sus mensajes.
            retosCerrados: [],
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
              -- Solo los que tienen apuestas, patas de combinadas o retos pendientes: preguntar por el resto gasta cuota para nada.
              AND (EXISTS (SELECT 1 FROM apuestas_usuario a WHERE a.match_id = apuestas_partidos.match_id AND a.pagado = 0)
                   OR EXISTS (SELECT 1 FROM combinada_patas pa JOIN combinadas c ON c.id = pa.combinada_id
                              WHERE pa.match_id = apuestas_partidos.match_id AND pa.resultado = 'pendiente' AND c.estado = 'abierta')
                   OR EXISTS (SELECT 1 FROM retos r WHERE r.match_id = apuestas_partidos.match_id AND r.estado IN ('pendiente', 'en_juego')))
        `,
            )
            .all(corte, limite);
        (partidos.length ? logInfo : logDebug)(`[PAGARAPUESTAS] (${origen}) ${partidos.length} partidos pendientes de cierre`);

        const cerrarPartido = db.transaction((partido, resultado, marcador) => {
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
            const cierre = { apostantes: apuestas.length, ganadores: [], repartido: 0 };
            for (const ap of apuestas) {
                resumen.total++;
                // Las de marcador exacto (F-AP-10) aciertan con el marcador; las demás, con el resultado.
                const gana = mercados.acierta(ap.eleccion, resultado, marcador, ap.linea);
                pase.registrarEnTodos(ap.user_id, "apuesta");
                if (gana) {
                    const premio = Math.round(ap.cantidad * ap.cuota);
                    dinero.pagar(ap.user_id, premio);
                    dinero.apuntar(ap.user_id, "apuestas", `Apuesta ganada: ${partido.home_team} vs ${partido.away_team}`, premio);
                    cierre.ganadores.push(ap.user_id);
                    cierre.repartido += premio;
                    resumen.pagadas++;
                    resumen.pagos.push({ userId: ap.user_id, premio, descripcion: `${partido.home_team} vs ${partido.away_team}` });
                    logInfo(
                        `[PAGARAPUESTAS] Pagado ${premio} monedas a usuario ${ap.user_id} (apostó ${ap.cantidad} con cuota ${ap.cuota})`,
                    );
                } else {
                    resumen.fallidas++;
                    logInfo(
                        `[PAGARAPUESTAS] Apuesta perdida: usuario ${ap.user_id} perdió ${ap.cantidad} monedas (apostó ${ap.eleccion}, ganó ${resultado}, ${marcador})`,
                    );
                }
                db.prepare("UPDATE apuestas_usuario SET pagado = 1, premio = ? WHERE id = ?").run(
                    gana ? Math.round(ap.cantidad * ap.cuota) : 0,
                    ap.id,
                );
            }
            // Combinadas con una pata en este partido: una pata fallida pierde el boleto; con todas acertadas, se paga.
            resumen.pagos.push(...combinadas.resolverPartido(partido.match_id, resultado, marcador));
            // Retos 1 contra 1 al partido: el ganador se lleva lo de los dos (los que nadie aceptó se devuelven).
            const deRetos = retos.resolverPartido(partido.match_id, resultado, marcador);
            resumen.pagos.push(...deRetos.pagos);
            for (const r of deRetos.cerrados) {
                resumen.retosCerrados.push(r.id);
                const ganador = r.participantes.find((p) => p.premio > 0 && r.estado === "resuelto");
                if (ganador) {
                    resumen.retos.push({
                        creador: r.creador,
                        rival: r.rival,
                        ganador: ganador.userId,
                        premio: ganador.premio,
                        partido: r.resultado,
                    });
                }
            }
            return cierre;
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
            const marcador = `${r.home.score}-${r.away.score}`;
            const cierre = cerrarPartido(partido, r.resultado, marcador);
            // Un partido con solo retos no sale como "nadie acertó (0 apuestas)": sus retos van aparte.
            if (cierre.apostantes) {
                resumen.partidos.push({ deporte: deporteKey, home: partido.home_team, away: partido.away_team, marcador, ...cierre });
            }
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

            // Para cobrar hay que acertar al menos la mitad de los partidos (5 de 10). Si nadie llega,
            // se devuelve lo apostado: antes el 90 % se repartía entre los que más acertaran aunque
            // fallaran todo, y un jugador solo recuperaba el 90 % sin acertar nada.
            const minimo = minimoAciertosQuiniela(partidosQ.length);
            const maxAciertos = apuestasConAciertos.length ? Math.max(...apuestasConAciertos.map((a) => a.aciertos)) : 0;
            const hayGanadores = maxAciertos >= minimo;
            const ganadoras = hayGanadores ? apuestasConAciertos.filter((a) => a.aciertos === maxAciertos) : [];
            const bote = apuestasConAciertos.reduce((acc, a) => acc + a.cantidad, 0);
            const fondoPremios = Math.floor(bote * 0.9);
            const premioUnitario = ganadoras.length > 0 ? Math.floor(fondoPremios / ganadoras.length) : 0;

            db.transaction(() => {
                for (const a of apuestasConAciertos) {
                    // Sin ganadores, "premio" es lo que se le devuelve (como en las caducadas).
                    const premio = hayGanadores ? (a.aciertos === maxAciertos ? premioUnitario : 0) : a.cantidad;
                    if (premio > 0) {
                        const descripcion = hayGanadores
                            ? `Quiniela ganada: ${q.jornada}`
                            : `Reembolso: quiniela ${q.jornada}, nadie llegó a ${minimo} aciertos`;
                        dinero.pagar(a.user_id, premio);
                        dinero.apuntar(a.user_id, "apuestas", descripcion, premio);
                        resumen.pagos.push(
                            hayGanadores
                                ? { userId: a.user_id, premio, descripcion: `Quiniela ${q.jornada}` }
                                : { userId: a.user_id, premio, descripcion, reembolso: true },
                        );
                    }
                    db.prepare(
                        `
                        UPDATE quiniela_apuestas
                        SET pagado = 1, aciertos = ?, premio = ?
                        WHERE id = ?
                    `,
                    ).run(a.aciertos, hayGanadores ? premio : 0, a.id);
                }
                db.prepare(`UPDATE quinielas SET estado = 'cerrada', cerrada_en = ? WHERE id = ?`).run(new Date().toISOString(), q.id);
            })();

            if (!hayGanadores) resumen.reembolsos += apuestasConAciertos.length;
            resumen.quinielasCerradas++;
            resumen.premiosQuiniela += premioUnitario * ganadoras.length;
            resumen.quinielas.push({
                deporte: deporteKey,
                jornada: q.jornada,
                jugadores: apuestasConAciertos.length,
                partidos: partidosQ.length,
                minimo,
                maxAciertos,
                ganadores: ganadoras.map((a) => a.user_id),
                premioUnitario,
            });
            logInfo(
                hayGanadores
                    ? `[PAGARAPUESTAS] Quiniela cerrada ${q.id}: ${ganadoras.length} ganadores con ${maxAciertos} aciertos, premio unitario ${premioUnitario}`
                    : `[PAGARAPUESTAS] Quiniela cerrada ${q.id}: nadie llegó a ${minimo} aciertos (máx. ${maxAciertos}), ${apuestasConAciertos.length} apuestas reembolsadas`,
            );
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
                    ? `↩️ Te he devuelto **${p.premio.toLocaleString("es")}** monedas: ${p.descripcion.replace(/^Reembolso: /, "")}.`
                    : `🏆 ¡Has ganado **${p.premio.toLocaleString("es")}** monedas con tu apuesta (${p.descripcion})!`,
            );
        } catch (e) {
            (e.code === 50007 ? logDebug : logWarn)(`[PAGARAPUESTAS] No se pudo avisar por DM a ${p.userId}: ${e.message}`);
        }
    }
}

const fmt = (n) => Number(n || 0).toLocaleString("es");
// Menciones sin repetir y sin avisar (el mensaje se manda con allowedMentions vacío): se ve quién, sin ping.
const menciones = (ids, max = 10) => {
    const unicos = [...new Set(ids)];
    return (
        unicos
            .slice(0, max)
            .map((id) => `<@${id}>`)
            .join(", ") + (unicos.length > max ? ` y ${unicos.length - max} más` : "")
    );
};

/** Embed con los partidos y quinielas cerrados en una liquidación, o null si no se cerró nada. */
function resultadosEmbed(resumen) {
    const lineas = [];
    for (const p of resumen.partidos || []) {
        const comp = DEPORTES[p.deporte]?.name || p.deporte;
        const acertantes = new Set(p.ganadores).size;
        const detalle = p.ganadores.length
            ? `✅ ${acertantes} de ${p.apostantes} acertaron · **${fmt(p.repartido)}** 🪙 en premios · 🏆 ${menciones(p.ganadores)}`
            : `❌ Nadie acertó (${p.apostantes} ${p.apostantes === 1 ? "apuesta" : "apuestas"})`;
        lineas.push(`⚽ **${p.home} ${p.marcador} ${p.away}** · ${comp}\n${detalle}`);
    }
    for (const q of resumen.quinielas || []) {
        const comp = DEPORTES[q.deporte]?.name || q.deporte;
        const detalle = q.ganadores.length
            ? `🏆 ${q.ganadores.length} ${q.ganadores.length === 1 ? "ganador" : "ganadores"} con ${q.maxAciertos}/${q.partidos} aciertos · **${fmt(q.premioUnitario)}** 🪙 cada uno · ${menciones(q.ganadores)}`
            : `↩️ Nadie llegó a ${q.minimo} aciertos (máximo ${q.maxAciertos}): se devuelve lo apostado a ${q.jugadores} ${q.jugadores === 1 ? "jugador" : "jugadores"}`;
        lineas.push(`🧾 **Quiniela ${q.jornada}** · ${comp}\n${detalle}`);
    }
    // Con persona(): el Duende (F-DU-03) sale por su nombre, no es un usuario de Discord.
    const { persona } = require("../../paneles/retos");
    for (const r of resumen.retos || []) {
        lineas.push(
            `⚔️ **Reto** ${persona(r.creador)} vs ${persona(r.rival)} · ${r.partido}\n🏆 Gana ${persona(r.ganador)} y se lleva **${fmt(r.premio)}** 🪙`,
        );
    }
    if (!lineas.length) return null;
    let descripcion = "";
    for (const l of lineas) {
        if (descripcion.length + l.length + 2 > 4000) {
            descripcion += "\n…";
            break;
        }
        descripcion += (descripcion ? "\n\n" : "") + l;
    }
    return new EmbedBuilder()
        .setTitle("📢 Resultados de las apuestas")
        .setDescription(descripcion)
        .setFooter({ text: "Tus jugadas, en /juegos → 📋 Mis jugadas" })
        .setColor(0x27ae60)
        .setTimestamp();
}

/**
 * Publica los resultados de una liquidación en el canal de resultados de cada servidor que lo tenga configurado
 * (/paneladmin → ⚽ Apuestas). Best-effort: un canal que no existe o sin permisos se registra y se sigue.
 * @returns {Promise<number>} canales en los que se ha publicado
 */
async function anunciarResultados(client, resumen) {
    const embed = resultadosEmbed(resumen);
    if (!embed) return 0;
    const guildSettings = require("../guildSettings");
    let publicados = 0;
    for (const guild of client.guilds.cache.values()) {
        const canalId = guildSettings.getSettings(guild.id).apuestas.canal_resultados;
        if (!canalId) continue;
        try {
            const canal = guild.channels.cache.get(canalId) || (await guild.channels.fetch(canalId).catch(() => null));
            if (!canal?.isTextBased?.()) {
                logWarn(`[PAGARAPUESTAS] El canal de resultados ${canalId} de ${guild.name} no existe o no es de texto`);
                continue;
            }
            await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
            publicados++;
        } catch (e) {
            logWarn(`[PAGARAPUESTAS] No se pudieron publicar los resultados en ${guild.name}: ${e.message}`);
        }
    }
    return publicados;
}

/** Resumen de una liquidación para enseñarlo (panel de admin → ⚽ Apuestas → 💸 Liquidar ahora). */
function resumenEmbed(resumen) {
    let descripcionDeportes = "";
    for (const [deporte, cantidad] of Object.entries(resumen.partidosProcesados)) {
        const deporteInfo = DEPORTES[deporte];
        if (deporteInfo && cantidad > 0) descripcionDeportes += `• ${deporteInfo.name}: **${cantidad}** partidos\n`;
    }
    const retosCerrados = resumen.retosCerrados?.length || 0;
    const nada = resumen.total === 0 && resumen.quinielasCerradas === 0 && resumen.caducados === 0 && !retosCerrados;
    return new EmbedBuilder()
        .setTitle("💸 Pago de apuestas deportivas")
        .setDescription(
            `🏆 **Apuestas ganadoras:** ${resumen.pagadas}\n` +
                `❌ **Apuestas perdedoras:** ${resumen.fallidas}\n` +
                `📊 **Total procesadas:** ${resumen.total}\n` +
                `🗓️ **Partidos finalizados:** ${Object.values(resumen.partidosProcesados).reduce((a, b) => a + b, 0)}\n\n` +
                `🧾 **Quinielas cerradas:** ${resumen.quinielasCerradas}\n` +
                `🎁 **Premios quiniela repartidos:** ${resumen.premiosQuiniela}\n` +
                (retosCerrados ? `⚔️ **Retos a partidos cerrados:** ${retosCerrados}\n` : "") +
                (resumen.caducados
                    ? `↩️ **Sin resultado (más de 3 días):** ${resumen.caducados} · **apuestas reembolsadas:** ${resumen.reembolsos}\n`
                    : "") +
                "\n" +
                (descripcionDeportes ? `**Deportes procesados:**\n${descripcionDeportes}\n` : "") +
                (nada ? "📋 No había apuestas pendientes de pago." : "✅ Procesamiento completado."),
        )
        .setColor(resumen.total > 0 ? 0x27ae60 : 0x2980b9)
        .setTimestamp();
}

module.exports = {
    liquidarApuestas,
    avisarGanadores,
    anunciarResultados,
    resultadosEmbed,
    minimoAciertosQuiniela,
    resumenEmbed,
    AUTO_MIN_HORAS_DESDE_INICIO,
};
