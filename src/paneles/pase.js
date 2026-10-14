// 🛡️ Pase de batalla (#36): el panel de /pase (solo lo ves tú): resumen, niveles, misiones, top, topes de hoy (#331) e historial de temporadas
// (#300).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const pase = require("../systems/pase/pase");
const historial = require("../systems/pase/historial");
const { ETIQUETAS, MISION_XP, BONUS_DIA_PERFECTO, RACHA_HITOS } = require("../systems/pase/constantes");
const { ajustes } = require("../systems/pase/ajustes");
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

const VISTAS = [
    ["pase_vista_resumen", "🛡️ Resumen"],
    ["pase_vista_niveles", "📜 Niveles"],
    ["pase_vista_misiones", "🧩 Misiones"],
    ["pase_vista_top", "🏆 Top"],
    ["pase_vista_topes", "📊 Topes"],
    ["pase_vista_historial", "🕰️ Historial"],
];

/** Los botones de las vistas, en dos filas (Discord admite 5 por fila). */
function filasVistas(actual) {
    const boton = ([id, texto]) =>
        new ButtonBuilder()
            .setCustomId(id)
            .setLabel(texto)
            .setStyle(id.endsWith(actual) ? ButtonStyle.Primary : ButtonStyle.Secondary);
    return [
        new ActionRowBuilder().addComponents(VISTAS.slice(0, 5).map(boton)),
        new ActionRowBuilder().addComponents(VISTAS.slice(5).map(boton)),
    ];
}

/** Vista Niveles: las recompensas de los niveles 1 a 20 (✅ cobrada, 🎁 alcanzada, 🔒 por alcanzar), con el objeto si el nivel lo da (#364). */
function embedNiveles(e, avisoTxt) {
    const linea = (r) =>
        `${r.cobrada ? "✅" : r.alcanzada ? "🎁" : "🔒"} **Nivel ${r.nivel}** · ${fmtNumero(r.monedas)} 🪙${r.objeto ? ` + 🎒 ${r.objeto.nombre}` : ""}`;
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`📜 Niveles · temporada ${e.temporada + 1}`)
        .setDescription(`${avisoTxt}Cada nivel alcanzado se cobra en 🎁 Reclamar.`)
        .addFields(
            { name: "Niveles 1–10", value: e.recompensas.slice(0, 10).map(linea).join("\n"), inline: true },
            { name: "Niveles 11–20", value: e.recompensas.slice(10).map(linea).join("\n"), inline: true },
        );
}

/** La línea del día perfecto (#334) y la racha (#335) de las misiones y del resumen. */
function textoDiaPerfecto(e) {
    const hitos = RACHA_HITOS.map((h) => `${h.dias} días: +${h.xp} XP`).join(" · ");
    return (
        `${e.racha.hoyPerfecto ? "✅" : "⬜"} **Día perfecto** (las tres misiones): +${BONUS_DIA_PERFECTO} XP\n` +
        `🔥 **Racha:** ${e.racha.dias} ${e.racha.dias === 1 ? "día" : "días"} seguidos con las tres (${hitos})`
    );
}

/** Vista Misiones: las de hoy, con su barra de progreso y el día perfecto. */
function embedMisiones(e, avisoTxt) {
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🧩 Misiones de hoy")
        .setDescription(`${avisoTxt}Son 3 al día. Cada una completada da **${MISION_XP}** XP de pase.`)
        .addFields(
            {
                name: "Hoy",
                value: e.misiones
                    .map((m) => `${m.completada ? "✅" : "⬜"} ${m.nombre}\n\`${barra(m.progreso, m.meta)}\` ${m.progreso}/${m.meta}`)
                    .join("\n\n"),
            },
            { name: "Día perfecto", value: textoDiaPerfecto(e) },
        );
}

/** Tu posición en el top (#332), si no estás entre los que salen: el puesto y lo que falta para entrar. */
function textoPosicion(p, limite) {
    if (p.puesto === null) return "📍 Tu posición: sin puesto todavía (aún no tienes XP de pase esta temporada).";
    if (p.puesto <= limite) return null;
    return `📍 Tu posición: **#${p.puesto}** · ${fmtNumero(p.xp)} XP. Te faltan **${fmtNumero(p.faltan)}** XP para entrar en el top ${limite}.`;
}

/** Vista Top: los 10 con más XP de pase en el servidor, y tu puesto si no estás entre ellos. */
function embedTop(guildId, userId, avisoTxt, ahora) {
    const top = pase.top(guildId, 10, ahora);
    const lineas = top.length
        ? top.map((t, i) => `${i + 1}. <@${t.userId}> · nivel **${t.nivel}** (${fmtNumero(t.xp)} XP)`).join("\n")
        : "Todavía nadie tiene XP de pase.";
    const posicion = textoPosicion(pase.posicionDe(guildId, userId, 10, ahora), 10);
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🏆 Top del pase")
        .setDescription(`${avisoTxt}${lineas}${posicion ? `\n\n${posicion}` : ""}`);
}

/** Vista Topes (#331): cuánta XP de pase llevas hoy en cada categoría y cuánto te queda hasta su tope diario. */
function embedTopes(guildId, userId, avisoTxt, ahora) {
    const lineas = pase.topesDeHoy(guildId, userId, ahora).map((t) => {
        const resto = t.tope - t.usado;
        return `${t.lleno ? "🔴" : "🟢"} ${ETIQUETAS[t.categoria]}: **${fmtNumero(t.usado)} / ${fmtNumero(t.tope)}** XP${t.lleno ? " · tope alcanzado" : ` · quedan ${fmtNumero(resto)}`}`;
    });
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("📊 Topes de hoy")
        .setDescription(
            `${avisoTxt}La XP de pase de cada categoría tiene un tope diario (se reinicia a medianoche, hora de Madrid). Las misiones y el día perfecto van aparte.\n\n${lineas.join("\n")}`,
        );
}

/** Vista Resumen: el nivel con su barra de XP, la próxima recompensa, lo que queda por reclamar y la racha. */
function embedResumen(e, avisoTxt, ahora) {
    const siguiente = e.nivel < pase.NIVEL_MAX ? e.recompensas[e.nivel] : null;
    const subtitulo = `Termina en ${dias(e.fin - ahora)}`;
    const bar = e.xpSiguiente ? barra(e.xp - e.xpNivelActual, e.xpSiguiente - e.xpNivelActual) : "██████████";
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
            { name: "🔥 Racha", value: `${e.racha.dias} ${e.racha.dias === 1 ? "día" : "días"} con las tres misiones`, inline: true },
        );
}

/** El resumen de una temporada pasada (#300): quién participó, el top, el nivel más alto y lo cobrado. */
function textoTemporadaPasada(r) {
    const top = r.top
        .slice(0, 3)
        .map((t, i) => `${["🥇", "🥈", "🥉"][i]} <@${t.userId}> · nivel ${t.nivel} (${fmtNumero(t.xp)} XP)`)
        .join("\n");
    return (
        `👥 **${r.participantes}** ${r.participantes === 1 ? "participante" : "participantes"} · ${fmtNumero(r.xp_total)} XP en total · nivel más alto: **${r.nivel_max}**\n` +
        `🎁 **${r.reclamados}** ${r.reclamados === 1 ? "recompensa cobrada" : "recompensas cobradas"} (${fmtNumero(r.monedas)} 🪙)\n\n${top || "Nadie sumó XP."}`
    );
}

/** Vista Historial (#300): las temporadas ya cerradas y, con el menú, el resumen de la que elijas (por defecto, la última). */
function pantallaHistorial(guildId, avisoTxt, temporada, ahora) {
    historial.cerrarPasadas(ahora); // por si una temporada acaba de cerrarse y el cron aún no la ha guardado
    const pasadas = historial.temporadasPasadas(guildId);
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("🕰️ Historial de temporadas");
    if (!pasadas.length) {
        embed.setDescription(`${avisoTxt}Todavía no ha acabado ninguna temporada.`);
        return { embed, menu: null };
    }
    const elegida = pasadas.find((p) => p.temporada === Number(temporada)) || pasadas[0];
    embed.setTitle(`🕰️ Temporada ${elegida.temporada + 1}`).setDescription(`${avisoTxt}${textoTemporadaPasada(elegida)}`);
    const menu = new StringSelectMenuBuilder()
        .setCustomId("pase_historial_sel")
        .setPlaceholder("Otra temporada")
        .addOptions(
            pasadas.map((p) => ({
                label: `Temporada ${p.temporada + 1}`,
                value: String(p.temporada),
                default: p.temporada === elegida.temporada,
            })),
        );
    return { embed, menu: new ActionRowBuilder().addComponents(menu) };
}

/** La pantalla de /pase con el pase desactivado (#353): sin datos. */
const pantallaDesactivada = () => ({
    content: "🛡️ El pase de batalla está desactivado en este servidor.",
    embeds: [],
    components: [],
});

/**
 * La pantalla de una vista: "resumen", "niveles", "misiones", "top", "topes" o "historial". `aviso`: resultado de la última acción;
 * `temporada`: la temporada pasada que se enseña en el historial.
 */
function pantallaPase(guildId, userId, vista = "resumen", { aviso = null, ahora = Date.now(), temporada = null } = {}) {
    if (!ajustes(guildId).activo) return pantallaDesactivada();
    const e = pase.estado(guildId, userId, ahora);
    const avisoTxt = aviso ? `${aviso}\n\n` : "";
    let embed;
    let menu = null;
    if (vista === "niveles") embed = embedNiveles(e, avisoTxt);
    else if (vista === "misiones") embed = embedMisiones(e, avisoTxt);
    else if (vista === "top") embed = embedTop(guildId, userId, avisoTxt, ahora);
    else if (vista === "topes") embed = embedTopes(guildId, userId, avisoTxt, ahora);
    else if (vista === "historial") ({ embed, menu } = pantallaHistorial(guildId, avisoTxt, temporada, ahora));
    else embed = embedResumen(e, avisoTxt, ahora);
    // 🎁 Reclamar, en todas las vistas (en Niveles se ve qué se cobra; el botón sale apagado si no hay nada).
    const reclamar = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("pase_reclamar")
            .setLabel("🎁 Reclamar")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!e.pendientes.length),
    );
    embed.setFooter({ text: "Lo que ves solo lo ves tú. Las recompensas son monedas (🪙) y objetos, no permisos de Discord." });
    return { content: "", embeds: [embed], components: [reclamar, ...filasVistas(vista), ...(menu ? [menu] : [])] };
}

module.exports = { pantallaPase, textoTemporadaPasada };
