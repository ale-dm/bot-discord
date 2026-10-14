// Panel admin → ⚽ Apuestas, pantalla principal: lo que hay en juego (partidos con apuestas pendientes, quinielas
// abiertas y caducados), los límites por jugador, los premios de la liga, los avisos y los botones de acción.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const repo = require("../../repositorios/apuestas");
const guildSettings = require("../../systems/guildSettings");
const { DEPORTES } = require("../../services/oddsApi");
const { trozos } = require("../../paneles/filas");

const nombreDeporte = (d) => DEPORTES[d]?.name || d;

function consultarPendientes() {
    return repo.pendientesPorDeporte();
}

function consultarQuinielas() {
    return repo.quinielasAbiertas();
}

function consultarCaducados() {
    return repo.partidosCaducadosDesde(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
}

function campoPendientes(pendientes) {
    return {
        name: "⏳ Apuestas pendientes",
        value:
            pendientes
                .map((r) => `• ${nombreDeporte(r.deporte)}: **${r.apuestas}** apuestas en ${r.partidos} partidos (${r.importe} 🪙)`)
                .join("\n") || "Ninguna.",
    };
}

function campoQuinielas(quinielas) {
    return {
        name: "🧾 Quinielas abiertas",
        value:
            quinielas
                .map((q) => `• ${nombreDeporte(q.deporte)} · ${q.jornada}: **${q.jugadores}** jugadores, bote ${q.bote} 🪙`)
                .join("\n") || "Ninguna.",
    };
}

function campoLimites(cfg) {
    return {
        name: "🚦 Límites por jugador",
        value:
            `Tope diario (partidos y quiniela): ${cfg.tope_diario ? `**${cfg.tope_diario.toLocaleString("es")}** 🪙` : "sin límite"}\n` +
            `Máximo por partido: ${cfg.max_partido ? `**${cfg.max_partido.toLocaleString("es")}** 🪙` : "sin límite"}`,
    };
}

function campoPremios(guildId) {
    const liga = guildSettings.getSettings(guildId).liga;
    const fmt = (n) => `**${Number(n || 0).toLocaleString("es")}** 🪙`;
    return {
        name: "🏆 Premios de la liga",
        value: `1.º ${fmt(liga.premio_1)} · 2.º ${fmt(liga.premio_2)} · 3.º ${fmt(liga.premio_3)}\nSe pagan al cerrar cada temporada (julio–junio).`,
    };
}

function textoDestacado(cfg) {
    if (!cfg.destacado) return "desactivado";
    if (cfg.canal_resultados) return `cada día desde las 10:00 en <#${cfg.canal_resultados}>`;
    return "activo, pero hace falta el canal de resultados";
}

function campoAvisos(cfg) {
    return {
        name: "📢 Avisos",
        value:
            `Resultados: ${cfg.canal_resultados ? `se publican en <#${cfg.canal_resultados}>` : "no se publican (solo DM a quien cobra)"}\n` +
            `Recordatorio por DM: ${cfg.recordatorio ? `**${cfg.recordatorio_min} min** antes del partido` : "desactivado"}` +
            `${cfg.recordatorio && cfg.recordatorio_quiniela_horas ? ` · quiniela sin enviar: **${cfg.recordatorio_quiniela_horas} h** antes de cerrar` : ""}\n` +
            `⭐ Partido destacado del día: ${textoDestacado(cfg)}`,
    };
}

function filaAcciones() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_apu_liquidar").setLabel("💸 Liquidar ahora").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_apu_premios").setLabel("🏆 Premios de liga").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_apu_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
}

// Una fila admite 5 botones: con más competiciones, varias filas.
function filasCrearQuiniela() {
    return trozos(
        Object.entries(DEPORTES).map(([key, d]) =>
            new ButtonBuilder()
                .setCustomId(`paneladmin_apu_quiniela_${key}`)
                .setLabel(`🧾 Crear quiniela ${d.name}`.slice(0, 80))
                .setStyle(ButtonStyle.Primary),
        ),
    ).map((grupo) => new ActionRowBuilder().addComponents(...grupo));
}

function filaAvisos(cfg) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_apu_canal").setLabel("📢 Canal de resultados").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("paneladmin_apu_canal_quitar")
            .setLabel("🔕 No publicar")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!cfg.canal_resultados),
        new ButtonBuilder().setCustomId("paneladmin_apu_recordatorio").setLabel("⏰ Recordatorio").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_apu_limites").setLabel("🚦 Límites").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("paneladmin_apu_destacado")
            .setLabel(cfg.destacado ? "⭐ Quitar el destacado" : "⭐ Publicar el destacado")
            .setStyle(ButtonStyle.Secondary),
    );
}

function buildApuestasHome(guildId) {
    const cfg = guildSettings.getSettings(guildId).apuestas;
    const pendientes = consultarPendientes();
    const quinielas = consultarQuinielas();
    const caducados = consultarCaducados();
    const embed = new EmbedBuilder()
        .setTitle("⚽ Apuestas")
        .setDescription("Se liquidan solas cada hora (minuto 15). 💸 Liquidar ahora lo fuerza.")
        .addFields(
            campoPendientes(pendientes),
            campoQuinielas(quinielas),
            { name: "↩️ Caducados (7 días)", value: `${caducados} partidos sin resultado (reembolsados)` },
            campoLimites(cfg),
            campoPremios(guildId),
            campoAvisos(cfg),
        )
        .setColor(0x2ecc71)
        .setTimestamp();
    return { content: "", embeds: [embed], components: [filaAcciones(), ...filasCrearQuiniela(), filaAvisos(cfg)] };
}

module.exports = { buildApuestasHome };
