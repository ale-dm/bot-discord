// 🔒 Autoexclusión del casino (#463): desde el resumen del casino, elegir el periodo y confirmarlo (no se puede deshacer
// antes de tiempo). Solo construye mensajes; las reglas están en systems/casinoAutoexclusion.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const autoexclusion = require("../systems/casinoAutoexclusion");

const volver = () => new ButtonBuilder().setCustomId("casino_home").setLabel("◄ Casino").setStyle(ButtonStyle.Secondary);

/** Paso 1: los periodos, o la fecha de fin si ya está autoexcluido. */
function buildAutoexclusion(userId) {
    const hasta = autoexclusion.hastaDe(userId);
    const embed = new EmbedBuilder().setTitle("🔒 Autoexclusión del casino").setColor(0x7f8c8d);
    if (hasta) {
        embed.setDescription(
            `Estás autoexcluido del casino hasta ${autoexclusion.textoHasta(hasta)}.\nNo se puede levantar antes: al acabar, el casino vuelve solo.`,
        );
        return { embeds: [embed], components: [new ActionRowBuilder().addComponents(volver())] };
    }
    embed.setDescription(
        "Si notas que juegas de más, puedes bloquearte el casino durante un tiempo. Mientras dure, ningún juego te cobrará " +
            "apuestas, y **no se puede levantar antes de la fecha de fin**. Al acabar, vuelve a funcionar sin hacer nada.\n\n" +
            "Elige cuánto tiempo:",
    );
    const botones = Object.entries(autoexclusion.PERIODOS).map(([id, p]) =>
        new ButtonBuilder().setCustomId(`casino_autoex_${id}`).setLabel(p.nombre).setStyle(ButtonStyle.Danger),
    );
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...botones, volver())] };
}

/** Paso 2: confirmar el periodo elegido. */
function buildConfirmarAutoexclusion(userId, periodo) {
    const p = autoexclusion.PERIODOS[periodo];
    if (!p) return buildAutoexclusion(userId);
    const embed = new EmbedBuilder()
        .setTitle("🔒 ¿Seguro?")
        .setColor(0xe74c3c)
        .setDescription(`Te vas a bloquear el casino **${p.nombre}**. No podrás deshacerlo antes de que pase ese tiempo.`);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`casino_autoex_ok_${periodo}`).setLabel("Sí, bloquearme").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("casino_autoex").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [fila] };
}

/** Tras confirmar: lo que dice la pantalla (la fecha de fin, o por qué no se pudo). */
function buildAutoexclusionActivada(userId, periodo) {
    const r = autoexclusion.activar(userId, periodo);
    if (!r.ok)
        return { embeds: [new EmbedBuilder().setTitle("🔒 Autoexclusión").setDescription(r.mensaje).setColor(0x7f8c8d)], components: [] };
    const embed = new EmbedBuilder()
        .setTitle("🔒 Autoexclusión activada")
        .setColor(0x7f8c8d)
        .setDescription(`Casino bloqueado hasta ${autoexclusion.textoHasta(r.hasta)}. Cuídate.`);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(volver())] };
}

module.exports = { buildAutoexclusion, buildConfirmarAutoexclusion, buildAutoexclusionActivada };
