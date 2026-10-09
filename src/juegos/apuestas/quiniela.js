const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require("discord.js");
const db = require("../../core/db");
const dinero = require("../../systems/dinero");
const limites = require("../../systems/apuestas/limites");
const { logInfo, logError } = require("../../core/logger");
const { DEPORTES, sincronizarPartidos } = require("../../services/oddsApi");
const { minimoAciertosQuiniela } = require("../../systems/apuestas/liquidacion");
const misJugadas = require("../../systems/apuestas/misJugadas");
const { lineaQuiniela, filaTrasApostar } = require("../../paneles/misJugadas");
const { filaPestanas } = require("../../paneles/pestanasJuegos");
const { esAdmin } = require("../../core/permisos");

const MAX_BET_AMOUNT = Number(process.env.MAX_BET_AMOUNT || 1000);
const MIN_BET_AMOUNT = Number(process.env.MIN_BET_AMOUNT || 10);
const QUINIELA_MATCH_COUNT = 10;
const QUINIELA_LOCK_MINUTES = Number(process.env.QUINIELA_LOCK_MINUTES || 15);
const sesionesQuiniela = new Map();

function obtenerSemanaISO(fecha) {
    const date = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return { year: date.getUTCFullYear(), week };
}

function construirNombreJornadaSemanal(deporteSeleccionado, partidos) {
    const ahora = new Date();
    const { week } = obtenerSemanaISO(ahora);
    return `Jornada ${week}`;
}

function getSesionKey(userId, quinielaId) {
    return `${userId}:${quinielaId}`;
}

function obtenerPartidosQuiniela(quinielaId) {
    return db
        .prepare(
            `
        SELECT * FROM quiniela_partidos
        WHERE quiniela_id = ?
        ORDER BY orden ASC
    `,
        )
        .all(quinielaId);
}

function estaBloqueadoPorTiempo(startTime) {
    const inicio = new Date(startTime).getTime();
    const ahora = Date.now();
    const diffMs = inicio - ahora;
    return diffMs <= QUINIELA_LOCK_MINUTES * 60 * 1000;
}

// Repinta el editor de la quiniela (embed y botones) con la pantalla del partido actual.
async function refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion) {
    const deporte = DEPORTES[quiniela.deporte] || DEPORTES.laliga;
    const embed = renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion);
    const rows = renderQuinielaEditorRows(quinielaId, sesion, partidos.length);
    await interaction.update({ embeds: [embed], components: rows });
}

function renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion) {
    const lineas = partidos
        .map((p, idx) => {
            const marca = idx === sesion.currentIndex ? "▶" : "•";
            const pick = sesion.pronosticos[idx] || "-";
            return `${marca} ${p.orden}. ${p.home_team} vs ${p.away_team}  [${pick}]`;
        })
        .join("\n");

    const actual = partidos[sesion.currentIndex];
    const actualDate = new Date(actual.start_time);
    const actualHora = actualDate.toLocaleString("es-ES");
    const bloqueado = estaBloqueadoPorTiempo(actual.start_time);
    const progreso = sesion.pronosticos.filter(Boolean).length;

    return new EmbedBuilder()
        .setTitle(`🧾 ${quiniela.jornada} — ${deporte.name}`)
        .setDescription(
            `Selecciona los pronósticos uno a uno con los botones **1 / X / 2**.\n\n` +
                `**Partidos**\n${lineas}\n\n` +
                `**Seleccionado:** ${actual.orden}. ${actual.home_team} vs ${actual.away_team}\n` +
                `**Hora:** ${actualHora}\n` +
                `**Estado:** ${bloqueado ? `🔒 Bloqueado (faltan < ${QUINIELA_LOCK_MINUTES} min)` : `🟢 Abierto`}\n` +
                `**Progreso:** ${progreso}/${partidos.length} | Cadena: \`${sesion.pronosticos.map((p) => p || "-").join("")}\``,
        )
        .setColor(0x3498db)
        .setFooter({ text: "1 = Local, X = Empate, 2 = Visitante" });
}

function renderQuinielaEditorRows(quinielaId, sesion, totalPartidos) {
    const completa = sesion.pronosticos.every(Boolean);
    const selectedLocked = sesion.currentStartTime ? estaBloqueadoPorTiempo(sesion.currentStartTime) : false;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quiniela_pick_${quinielaId}_1`)
            .setLabel("1")
            .setStyle(ButtonStyle.Success)
            .setDisabled(selectedLocked),
        new ButtonBuilder()
            .setCustomId(`quiniela_pick_${quinielaId}_X`)
            .setLabel("X")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(selectedLocked),
        new ButtonBuilder()
            .setCustomId(`quiniela_pick_${quinielaId}_2`)
            .setLabel("2")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(selectedLocked),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quiniela_prev_${quinielaId}`)
            .setLabel("⬅️ Anterior")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(sesion.currentIndex === 0),
        new ButtonBuilder()
            .setCustomId(`quiniela_next_${quinielaId}`)
            .setLabel("Siguiente ➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(sesion.currentIndex >= totalPartidos - 1),
        new ButtonBuilder().setCustomId(`quiniela_clear_${quinielaId}`).setLabel("🧹 Limpiar").setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`quiniela_confirmar_${quinielaId}`)
            .setLabel("✅ Confirmar pronósticos")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!completa),
        new ButtonBuilder().setCustomId(`quiniela_cancelar_${quinielaId}`).setLabel("❌ Cancelar").setStyle(ButtonStyle.Danger),
    );

    return [row1, row2, row3];
}

/**
 * Crea la quiniela de la jornada de una competición con sus próximos 10 partidos (mínimo 5). La usan el botón
 * 🛠️ Crear quiniela de la quiniela y el panel de admin → ⚽ Apuestas. @returns {{ ok: boolean, mensaje: string }}
 */
async function crearQuiniela(deporteSeleccionado, creadorId) {
    if (!DEPORTES[deporteSeleccionado]) return { ok: false, mensaje: "❌ Competición no válida." };
    const abierta = db.prepare(`SELECT id FROM quinielas WHERE estado = 'abierta' AND deporte = ? LIMIT 1`).get(deporteSeleccionado);
    if (abierta) return { ok: false, mensaje: "⚠️ Ya existe una quiniela activa para esta competición." };

    try {
        await sincronizarPartidos(deporteSeleccionado);
    } catch (e) {
        logError(`[Quiniela] No se pudieron sincronizar partidos de ${deporteSeleccionado}:`, e);
        return { ok: false, mensaje: `❌ No se pudo actualizar partidos: ${e.message}` };
    }

    const ahora = new Date().toISOString();
    const partidos = db
        .prepare(
            `SELECT * FROM apuestas_partidos WHERE deporte = ? AND estado = 'abierto' AND start_time > ? ORDER BY start_time ASC LIMIT ?`,
        )
        .all(deporteSeleccionado, ahora, QUINIELA_MATCH_COUNT);
    if (partidos.length < 5) return { ok: false, mensaje: "❌ No hay suficientes partidos próximos para crear quiniela (mínimo 5)." };

    const jornada = construirNombreJornadaSemanal(deporteSeleccionado, partidos);
    const mismaSemana = db
        .prepare(`SELECT id FROM quinielas WHERE deporte = ? AND jornada = ? ORDER BY id DESC LIMIT 1`)
        .get(deporteSeleccionado, jornada);
    if (mismaSemana) return { ok: false, mensaje: `⚠️ Ya existe una quiniela para ${jornada}.` };

    const quinielaId = db.transaction(() => {
        const res = db
            .prepare(`INSERT INTO quinielas (deporte, jornada, estado, creador_id, creada_en) VALUES (?, ?, 'abierta', ?, ?)`)
            .run(deporteSeleccionado, jornada, creadorId, ahora);
        const insertPartido = db.prepare(
            `INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        partidos.forEach((p, idx) => insertPartido.run(res.lastInsertRowid, p.match_id, idx + 1, p.home_team, p.away_team, p.start_time));
        return res.lastInsertRowid;
    })();
    logInfo(`[QUINIELA] Creada quiniela ${quinielaId} (${jornada}, ${deporteSeleccionado}) por ${creadorId}`);
    return {
        ok: true,
        mensaje: `✅ Quiniela **${jornada}** creada (${DEPORTES[deporteSeleccionado].name}) con ${partidos.length} partidos.`,
    };
}

module.exports = {
    crearQuiniela,
    componentHandlers: [
        // Prefijos más largos que los de apuestas.js ("apuestas_", "apuestas_modal_"), así que ganan.
        { types: ["button"], prefixes: ["quiniela_"], method: "handleButton", acl: "juegos" },
        { types: ["modal"], prefixes: ["quiniela_modal_"], method: "handleModal", acl: "juegos" },
    ],

    // Desde el botón "Refrescar" se llama con el deporte y la respuesta sustituye al mensaje.
    async run(client, interaction, deporteForzado = null) {
        const deporteSeleccionado = deporteForzado || interaction.options?.getString?.("deporte") || "laliga";
        const responder = (payload) =>
            deporteForzado && interaction.isButton?.() ? interaction.update(payload) : interaction.reply(payload);
        const deporte = DEPORTES[deporteSeleccionado];

        if (!deporte) {
            await interaction.reply({ content: "❌ Deporte no válido.", flags: MessageFlags.Ephemeral });
            return;
        }

        const quiniela = db
            .prepare(
                `
            SELECT * FROM quinielas
            WHERE estado = 'abierta' AND deporte = ?
            ORDER BY id DESC
            LIMIT 1
        `,
            )
            .get(deporteSeleccionado);

        const isAdmin = esAdmin(interaction);

        if (!quiniela) {
            const embed = new EmbedBuilder()
                .setTitle(`🧾 Quiniela ${deporte.name}`)
                .setDescription(
                    "No hay quiniela activa para este deporte.\n\n" +
                        (isAdmin
                            ? "Como admin, puedes crear una jornada con los próximos 10 partidos."
                            : "Pide a un admin que cree la quiniela de la jornada."),
                )
                .setColor(0x95a5a6);

            const components = [];
            if (isAdmin) {
                components.push(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`quiniela_crear_${deporteSeleccionado}`)
                            .setLabel("🛠️ Crear quiniela")
                            .setStyle(ButtonStyle.Primary),
                    ),
                );
            }

            components.push(filaPestanas(interaction.user.id, "apuestas"));
            await responder({ embeds: [embed], components });
            return;
        }

        const partidos = obtenerPartidosQuiniela(quiniela.id);
        const listado = partidos.map((p) => `${p.orden}. ${p.home_team} vs ${p.away_team}`).join("\n");
        const bote =
            db
                .prepare(
                    `
            SELECT COALESCE(SUM(cantidad), 0) AS total FROM quiniela_apuestas WHERE quiniela_id = ?
        `,
                )
                .get(quiniela.id)?.total || 0;

        // Si ya has apostado, tus pronósticos con ✅/❌ en los partidos jugados (antes solo se decía que ya
        // habías apostado, y no había forma de volver a verlos).
        const tuya = misJugadas.quinielaDe(interaction.user.id, quiniela.id);
        const embed = new EmbedBuilder()
            .setTitle(`🧾 ${quiniela.jornada} — ${deporte.name}`)
            .setDescription(
                (tuya ? "" : `Rellena la quiniela partido a partido con botones **1 / X / 2**.\n\n`) +
                    `💰 Bote actual: **${bote}** monedas\n` +
                    `🏆 El 90 % se reparte entre quien más acierte, con **${minimoAciertosQuiniela(partidos.length)}** aciertos ` +
                    `como mínimo (si nadie llega, se devuelve lo apostado).\n\n` +
                    `**Partidos:**\n${listado}`,
            )
            .setColor(0x2ecc71)
            .setFooter({ text: "1 = Local, X = Empate, 2 = Visitante" });
        if (tuya) {
            embed.addFields({ name: `🎟️ Tu quiniela (${tuya.cantidad} 🪙)`, value: lineaQuiniela(tuya.detalle) });
        }

        const row = new ActionRowBuilder().addComponents(
            tuya
                ? new ButtonBuilder()
                      .setCustomId(`misapuestas_activas_${interaction.user.id}`)
                      .setLabel("📋 Mis jugadas")
                      .setStyle(ButtonStyle.Primary)
                : new ButtonBuilder()
                      .setCustomId(`quiniela_apostar_${quiniela.id}`)
                      .setLabel("🎟️ Apostar quiniela")
                      .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`quiniela_refrescar_${deporteSeleccionado}`)
                .setLabel("🔄 Refrescar")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`apuestas_pagina_${deporteSeleccionado}_1`)
                .setLabel("⚽ Partidos")
                .setStyle(ButtonStyle.Secondary),
        );

        await responder({ embeds: [embed], components: [row, filaPestanas(interaction.user.id, "apuestas")] });
    },

    async handleButton(client, interaction) {
        const userId = interaction.user.id;
        const customId = interaction.customId;

        if (customId.startsWith("quiniela_refrescar_")) {
            const deporteSeleccionado = customId.replace("quiniela_refrescar_", "");
            // Antes se pasaba una copia {...interaction}, que no tiene reply/update (son de la clase):
            // el botón fallaba siempre.
            await this.run(client, interaction, deporteSeleccionado);
            return;
        }

        if (customId.startsWith("quiniela_crear_")) {
            const isAdmin = esAdmin(interaction);
            if (!isAdmin) {
                await interaction.reply({ content: "❌ Solo administradores pueden crear quinielas.", flags: MessageFlags.Ephemeral });
                return;
            }
            const r = await crearQuiniela(customId.replace("quiniela_crear_", ""), interaction.user.id);
            await interaction.reply({ content: r.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }

        if (customId.startsWith("quiniela_apostar_")) {
            const quinielaId = parseInt(customId.replace("quiniela_apostar_", ""), 10);
            const quiniela = db.prepare(`SELECT * FROM quinielas WHERE id = ? AND estado = 'abierta'`).get(quinielaId);
            if (!quiniela) {
                await interaction.reply({ content: "❌ La quiniela ya no está disponible.", flags: MessageFlags.Ephemeral });
                return;
            }

            const yaAposto = db.prepare(`SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = ?`).get(quinielaId, userId);
            if (yaAposto) {
                await interaction.reply({ content: "⚠️ Ya has enviado una apuesta para esta quiniela.", flags: MessageFlags.Ephemeral });
                return;
            }

            const partidos = obtenerPartidosQuiniela(quinielaId);
            const sesion = {
                currentIndex: 0,
                pronosticos: new Array(partidos.length).fill(null),
                currentStartTime: partidos[0]?.start_time,
                createdAt: Date.now(),
            };
            sesionesQuiniela.set(getSesionKey(userId, quinielaId), sesion);

            const deporte = DEPORTES[quiniela.deporte] || DEPORTES.laliga;
            const embed = renderQuinielaEditorEmbed(quiniela, deporte, partidos, sesion);
            const rows = renderQuinielaEditorRows(quinielaId, sesion, partidos.length);
            await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
            return;
        }

        if (customId.startsWith("quiniela_pick_")) {
            const parts = customId.split("_");
            const quinielaId = parseInt(parts[2], 10);
            const pick = parts[3];
            const key = getSesionKey(userId, quinielaId);
            const sesion = sesionesQuiniela.get(key);
            const quiniela = db.prepare(`SELECT * FROM quinielas WHERE id = ? AND estado = 'abierta'`).get(quinielaId);
            if (!sesion || !quiniela) {
                await interaction.reply({
                    content: "❌ Sesión no válida o expirada. Pulsa de nuevo en Apostar quiniela.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const partidos = obtenerPartidosQuiniela(quinielaId);
            const actual = partidos[sesion.currentIndex];
            if (!actual) {
                await interaction.reply({ content: "❌ Partido no válido en la quiniela.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (estaBloqueadoPorTiempo(actual.start_time)) {
                await interaction.reply({
                    content: `🔒 Ese partido está bloqueado porque faltan menos de ${QUINIELA_LOCK_MINUTES} minutos para empezar.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            sesion.pronosticos[sesion.currentIndex] = pick;
            if (sesion.currentIndex < partidos.length - 1) sesion.currentIndex += 1;
            sesion.currentStartTime = partidos[sesion.currentIndex]?.start_time;

            await refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion);
            return;
        }

        if (customId.startsWith("quiniela_prev_") || customId.startsWith("quiniela_next_") || customId.startsWith("quiniela_clear_")) {
            const quinielaId = parseInt(customId.split("_")[2], 10);
            const key = getSesionKey(userId, quinielaId);
            const sesion = sesionesQuiniela.get(key);
            const quiniela = db.prepare(`SELECT * FROM quinielas WHERE id = ? AND estado = 'abierta'`).get(quinielaId);
            if (!sesion || !quiniela) {
                await interaction.reply({
                    content: "❌ Sesión no válida o expirada. Pulsa de nuevo en Apostar quiniela.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const partidos = obtenerPartidosQuiniela(quinielaId);
            if (customId.startsWith("quiniela_prev_")) sesion.currentIndex = Math.max(0, sesion.currentIndex - 1);
            else if (customId.startsWith("quiniela_next_")) sesion.currentIndex = Math.min(partidos.length - 1, sesion.currentIndex + 1);
            else sesion.pronosticos[sesion.currentIndex] = null;
            sesion.currentStartTime = partidos[sesion.currentIndex]?.start_time;

            await refrescarEditor(interaction, quiniela, quinielaId, partidos, sesion);
            return;
        }

        if (customId.startsWith("quiniela_cancelar_")) {
            const quinielaId = parseInt(customId.replace("quiniela_cancelar_", ""), 10);
            sesionesQuiniela.delete(getSesionKey(userId, quinielaId));
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("❌ Apuesta cancelada")
                        .setDescription("Se canceló tu sesión de quiniela. Puedes empezar de nuevo cuando quieras.")
                        .setColor(0xe74c3c),
                ],
                components: [],
            });
            return;
        }

        if (customId.startsWith("quiniela_confirmar_")) {
            const quinielaId = parseInt(customId.replace("quiniela_confirmar_", ""), 10);
            const sesion = sesionesQuiniela.get(getSesionKey(userId, quinielaId));
            if (!sesion || !sesion.pronosticos.every(Boolean)) {
                await interaction.reply({ content: "❌ Completa todos los partidos antes de confirmar.", flags: MessageFlags.Ephemeral });
                return;
            }

            const modal = new ModalBuilder().setCustomId(`quiniela_modal_confirmar_${quinielaId}`).setTitle("Confirmar apuesta quiniela");

            const cantidadInput = new TextInputBuilder()
                .setCustomId("cantidad")
                .setLabel(`Cantidad (${MIN_BET_AMOUNT}-${MAX_BET_AMOUNT})`)
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(7)
                .setPlaceholder("Ejemplo: 100")
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(cantidadInput));
            await interaction.showModal(modal);
            return;
        }
    },

    async handleModal(client, interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith("quiniela_modal_confirmar_")) return;

        const quinielaId = parseInt(customId.replace("quiniela_modal_confirmar_", ""), 10);
        const quiniela = db.prepare(`SELECT * FROM quinielas WHERE id = ? AND estado = 'abierta'`).get(quinielaId);
        if (!quiniela) {
            await interaction.reply({ content: "❌ Quiniela no disponible.", flags: MessageFlags.Ephemeral });
            return;
        }

        const partidos = obtenerPartidosQuiniela(quinielaId);
        // El bloqueo antes del primer partido se comprobaba al mostrar el formulario pero no al
        // enviarlo: con un formulario abierto a tiempo se podía apostar con la jornada empezada.
        const primerPartido = partidos.map((p) => p.start_time).sort()[0];
        if (primerPartido && estaBloqueadoPorTiempo(primerPartido)) {
            logInfo(
                `[Quiniela] Apuesta rechazada de ${interaction.user.tag}: quiniela ${quinielaId} ya bloqueada (primer partido ${primerPartido})`,
            );
            await interaction.reply({
                content: `🔒 La quiniela se cerró ${QUINIELA_LOCK_MINUTES} minutos antes del primer partido; ya no se admiten apuestas.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const sesion = sesionesQuiniela.get(getSesionKey(interaction.user.id, quinielaId));
        let pronosticos = "";

        if (sesion) {
            pronosticos = sesion.pronosticos.join("");
        } else {
            try {
                const legacy = interaction.fields.getTextInputValue("pronosticos") || "";
                pronosticos = legacy.trim().toUpperCase().replace(/\s+/g, "");
            } catch (e) {
                logInfo(`[Quiniela] Sesión de pronósticos expirada para ${interaction.user.id} (quiniela ${quinielaId})`);
                await interaction.reply({
                    content: "❌ Sesión expirada. Vuelve a pulsar en Apostar quiniela.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        }

        const cantidadStr = interaction.fields.getTextInputValue("cantidad");
        const cantidad = parseInt(cantidadStr, 10);

        if (pronosticos.length !== partidos.length || /[^12X]/.test(pronosticos) || (sesion && !sesion.pronosticos.every(Boolean))) {
            await interaction.reply({
                content: "❌ Pronósticos incompletos o inválidos. Completa todos los partidos antes de confirmar.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (isNaN(cantidad) || cantidad < MIN_BET_AMOUNT || cantidad > MAX_BET_AMOUNT) {
            await interaction.reply({
                content: `❌ Cantidad inválida. Debe estar entre ${MIN_BET_AMOUNT} y ${MAX_BET_AMOUNT}.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const userId = interaction.user.id;
        // Quien aún no tiene cuenta empieza con el saldo inicial (como en el casino); antes le salía
        // "saldo insuficiente" hasta que usara otro comando que le creara la cuenta.
        // Se apuesta con el 💵 efectivo + 🥷 dinero negro (systems/dinero, F-EC-06b: se gasta igual).
        if (dinero.saldoGastable(userId) < cantidad) {
            await interaction.reply({
                content: "❌ No te llega el efectivo. Saca dinero del banco (💵 Sacar).",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const yaApostado = db.prepare(`SELECT 1 FROM quiniela_apuestas WHERE quiniela_id = ? AND user_id = ?`).get(quinielaId, userId);
        if (yaApostado) {
            await interaction.reply({ content: "⚠️ Ya has apostado esta quiniela.", flags: MessageFlags.Ephemeral });
            return;
        }

        // 🚦 Tope diario del servidor (F-AP-09), que suma partidos y quiniela. Justo antes de cobrar, sin await por medio.
        const limite = limites.comprobar(interaction.guildId, userId, cantidad);
        if (limite) {
            logInfo(`[Quiniela] Apuesta de ${interaction.user.tag} (${cantidad}) rechazada por los límites: ${limite}`);
            await interaction.reply({ content: `🚦 ${limite}`, flags: MessageFlags.Ephemeral });
            return;
        }

        const tx = db.transaction(() => {
            if (!dinero.cobrarCombinado(userId, cantidad)) throw new Error("Sin efectivo");
            db.prepare(
                `
                INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, creada_en)
                VALUES (?, ?, ?, ?, ?)
            `,
            ).run(quinielaId, userId, pronosticos, cantidad, new Date().toISOString());
            dinero.apuntar(userId, "apuestas", "Quiniela: apuesta", -cantidad);
        });
        try {
            tx();
        } catch {
            await interaction.reply({
                content: "❌ No te llega el efectivo. Saca dinero del banco (💵 Sacar).",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        logInfo(`[Quiniela] ${interaction.user.tag} (${userId}) apostó ${cantidad} a la quiniela ${quinielaId}: ${pronosticos}`);
        sesionesQuiniela.delete(getSesionKey(userId, quinielaId));

        const saldoActual = dinero.efectivo(userId);
        await interaction.reply({
            content:
                `✅ Quiniela registrada.\n` +
                `🎟️ Pronósticos: \`${pronosticos}\`\n` +
                `💰 Apostado: \`${cantidad}\`\n` +
                `💵 Efectivo: \`${saldoActual}\``,
            components: [filaTrasApostar(userId, { deporte: quiniela.deporte, quiniela: true })],
            flags: MessageFlags.Ephemeral,
        });
    },
};
