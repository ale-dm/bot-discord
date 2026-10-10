// Pestaña "⚔️ Retos" de /juegos: lo que te han retado, lo que esperas, lo que está en juego y los últimos cerrados.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const retos = require("../systems/retos");
const dinero = require("../systems/dinero");
const { filaPestanas } = require("./pestanasJuegos");
const { fmtNumero } = require("../core/formato");
const { campo, corto, persona } = require("./retosComun");

/** Enlace al mensaje del reto (o su número, si no se sabe dónde está). */
function enlace(reto) {
    return reto.guildId && reto.channelId && reto.messageId
        ? `[#${reto.id}](https://discord.com/channels/${reto.guildId}/${reto.channelId}/${reto.messageId})`
        : `#${reto.id}`;
}

/** Una línea con lo esencial de un reto, para las listas de la pestaña. */
function resumenCorto(reto) {
    if (reto.tipo === "partido") {
        const p = retos.partidoDe(reto.match_id);
        const partido = p ? `${p.home_team} vs ${p.away_team}` : "partido";
        return `⚽ ${partido} · ${persona(reto.creador)} vs ${persona(reto.rival)} · ${fmtNumero(reto.cantidad)} 🪙`;
    }
    if (reto.tipo === "duelo") {
        const j = retos.JUEGOS[reto.juego];
        return `${j.emoji} ${j.nombre} · ${persona(reto.creador)} vs ${persona(reto.rival)} · ${fmtNumero(reto.cantidad)} 🪙`;
    }
    return `🗳️ ${corto(reto.pregunta, 50)} · ${fmtNumero(reto.cantidad)} 🪙 · ${reto.participantes.length} dentro`;
}

/** Cómo le fue a `userId` en un reto cerrado. */
function resultadoPara(reto, userId) {
    const p = reto.participantes.find((x) => x.userId === String(userId));
    if (!p) return "";
    if (reto.estado === "devuelto") return "↩️ devuelto";
    if (p.premio > p.cantidad) return `🏆 +${fmtNumero(p.premio - p.cantidad)}`;
    if (p.premio === p.cantidad) return "🤝 ±0";
    return `❌ −${fmtNumero(p.cantidad)}`;
}

// ─── Pestaña ⚔️ Retos ────────────────────────────────────────────────────────

function buildRetos(userId, aviso = null) {
    const { recibidos, enviados, enJuego, cerrados } = retos.deUsuario(userId);
    const lista = (rs, vacio, extra = () => "") => campo(rs.map((r) => `${enlace(r)} ${resumenCorto(r)}${extra(r)}`).join("\n") || vacio);
    const c = dinero.cuenta(userId);
    const embed = new EmbedBuilder()
        .setTitle("⚔️ Retos")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Apuesta contra otras personas. El dinero se guarda hasta que se resuelve y el ganador se lo lleva todo.\n" +
                "• ⚽ **Partido**: «te apuesto 500 a que gana el Betis»; el otro va con lo contrario.\n" +
                "• 🎲 **Duelo**: piedra, papel o tijera, dados o blackjack contra alguien.\n" +
                "• 🗳️ **Porra**: una pregunta con opciones; entra quien quiera y un admin decide qué pasó.\n\n" +
                `💵 Efectivo: **${fmtNumero(c.efectivo)}** 🪙 · 🏦 Banco: **${fmtNumero(c.banco)}** 🪙`,
        )
        .addFields(
            { name: `📨 Te han retado (${recibidos.length})`, value: lista(recibidos, "Nadie, de momento.") },
            { name: `⏳ Esperando respuesta (${enviados.length})`, value: lista(enviados, "Ningún reto sin contestar.") },
            { name: `⚔️ En juego (${enJuego.length})`, value: lista(enJuego, "Nada en juego.") },
            { name: "📜 Últimos", value: lista(cerrados, "Ninguno todavía.", (r) => ` · ${resultadoPara(r, userId)}`) },
        )
        .setFooter({ text: "Los botones de cada reto están en su mensaje (pulsa su número)" })
        .setColor(0xe67e22);
    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("retos_nuevo_partido").setLabel("⚽ Retar a un partido").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("retos_nuevo_duelo").setLabel("🎲 Duelo").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("retos_nuevo_porra").setLabel("🗳️ Porra").setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [acciones, filaPestanas(userId, "retos")] };
}

module.exports = { buildRetos };
