// 🛡️ Pase de batalla (#36): el panel de /pase (solo lo ves tú): resumen, niveles, misiones y top.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const pase = require("../systems/pase/pase");
const { fmtNumero } = require("../core/formato");

const barra = (parte, total) => {
    const llenos = Math.round(10 * Math.min(1, total ? parte / total : 0));
    return `${"█".repeat(llenos)}${"░".repeat(10 - llenos)}`;
};
const dias = (ms) => {
    const d = Math.floor(ms / (86400 * 1000));
    const h = Math.floor((ms % (86400 * 1000)) / 3600000);
    return `${d}d ${h}h`;
};

function filaVistas(actual) {
    const botones = [
        ["pase_vista_resumen", "🛡️ Resumen"],
        ["pase_vista_niveles", "📜 Niveles"],
        ["pase_vista_misiones", "🧩 Misiones"],
        ["pase_vista_top", "🏆 Top"],
    ].map(([id, texto]) =>
        new ButtonBuilder()
            .setCustomId(id)
            .setLabel(texto)
            .setStyle(id.endsWith(actual) ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
    return new ActionRowBuilder().addComponents(botones);
}

/** Vista Niveles: las recompensas de los niveles 1 a 20 (✅ cobrada, 🎁 alcanzada, 🔒 por alcanzar). */
function embedNiveles(e, avisoTxt) {
    const linea = (r) => `${r.cobrada ? "✅" : r.alcanzada ? "🎁" : "🔒"} **Nivel ${r.nivel}** · ${fmtNumero(r.monedas)} 🪙`;
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`📜 Niveles · temporada ${e.temporada + 1}`)
        .setDescription(`${avisoTxt}Cada nivel alcanzado se cobra en 🎁 Reclamar.`)
        .addFields(
            { name: "Niveles 1–10", value: e.recompensas.slice(0, 10).map(linea).join("\n"), inline: true },
            { name: "Niveles 11–20", value: e.recompensas.slice(10).map(linea).join("\n"), inline: true },
        );
}

/** Vista Misiones: las de hoy, con su barra de progreso. */
function embedMisiones(e, avisoTxt) {
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🧩 Misiones de hoy")
        .setDescription(`${avisoTxt}Son 3 al día. Cada una completada da **${pase.MISION_XP}** XP de pase.`)
        .addFields({
            name: "Hoy",
            value: e.misiones
                .map((m) => `${m.completada ? "✅" : "⬜"} ${m.nombre}\n\`${barra(m.progreso, m.meta)}\` ${m.progreso}/${m.meta}`)
                .join("\n\n"),
        });
}

/** Vista Top: los 10 con más XP de pase en el servidor. */
function embedTop(guildId, avisoTxt, ahora) {
    const top = pase.top(guildId, 10, ahora);
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🏆 Top del pase")
        .setDescription(
            `${avisoTxt}${top.length ? top.map((t, i) => `${i + 1}. <@${t.userId}> · nivel **${t.nivel}** (${fmtNumero(t.xp)} XP)`).join("\n") : "Todavía nadie tiene XP de pase."}`,
        );
}

/** Vista Resumen: el nivel con su barra de XP, la próxima recompensa y lo que queda por reclamar. */
function embedResumen(e, avisoTxt, ahora) {
    const siguiente = e.nivel < pase.NIVEL_MAX ? e.recompensas[e.nivel] : null;
    const subtitulo = `Termina en ${dias(e.fin - ahora)}`;
    const bar = e.xpSiguiente ? barra(e.xp - pase.xpParaNivel(e.nivel), e.xpSiguiente - pase.xpParaNivel(e.nivel)) : "██████████";
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🛡️ Pase de batalla · temporada ${e.temporada + 1}`)
        .setDescription(
            `${avisoTxt}${subtitulo}\n\n**Nivel ${e.nivel}** de ${pase.NIVEL_MAX}\n\`${bar}\` ${fmtNumero(e.xp)}` +
                (e.xpSiguiente ? ` / ${fmtNumero(e.xpSiguiente)} XP` : " XP (nivel máximo)"),
        )
        .addFields(
            {
                name: "Próxima recompensa",
                value: siguiente ? `Nivel ${siguiente.nivel}: ${fmtNumero(siguiente.monedas)} 🪙` : "Ya están todas.",
                inline: true,
            },
            {
                name: "Por reclamar",
                value: e.pendientes.length
                    ? `${e.pendientes.length} ${e.pendientes.length === 1 ? "nivel" : "niveles"} · ${fmtNumero(e.pendientes.reduce((t, r) => t + r.monedas, 0))} 🪙`
                    : "Nada todavía.",
                inline: true,
            },
        );
}

/** La pantalla de una vista: "resumen", "niveles", "misiones" o "top". `aviso`: resultado de la última acción. */
function pantallaPase(guildId, userId, vista = "resumen", { aviso = null, ahora = Date.now() } = {}) {
    const e = pase.estado(guildId, userId, ahora);
    const avisoTxt = aviso ? `${aviso}\n\n` : "";
    let embed;
    if (vista === "niveles") embed = embedNiveles(e, avisoTxt);
    else if (vista === "misiones") embed = embedMisiones(e, avisoTxt);
    else if (vista === "top") embed = embedTop(guildId, avisoTxt, ahora);
    else embed = embedResumen(e, avisoTxt, ahora);
    // 🎁 Reclamar, en todas las vistas (en Niveles se ve qué se cobra; el botón sale apagado si no hay nada).
    const reclamar = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("pase_reclamar")
            .setLabel("🎁 Reclamar")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!e.pendientes.length),
    );
    embed.setFooter({ text: "Lo que ves solo lo ves tú. Las recompensas son monedas (🪙), no permisos de Discord." });
    return { content: "", embeds: [embed], components: [reclamar, filaVistas(vista)] };
}

module.exports = { pantallaPase };
