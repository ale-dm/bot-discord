// 📋 La pantalla de los encargos semanales (#523), desde /perfil → 💰 Economía: los tres de la semana con su barra de
// progreso, la recompensa, cuándo caducan y un botón para cobrar cada uno al completarlo. Solo payloads; las reglas están en
// systems/encargos.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const encargos = require("../systems/encargos");
const { fmtNumero } = require("../core/formato");

const COLOR = 0x8e44ad;
const ANCHO = 10;

function barra(progreso, meta) {
    const llenos = Math.round((Math.min(progreso, meta) / meta) * ANCHO);
    return `${"█".repeat(llenos)}${"░".repeat(ANCHO - llenos)} ${fmtNumero(progreso)}/${fmtNumero(meta)}`;
}

function estado(e) {
    if (e.reclamado_en) return "✅ cobrado";
    if (e.completado_en) return "🎁 ¡listo para cobrar!";
    return "⏳ en marcha";
}

/** Los encargos de esta semana de `userId`. */
function pantallaEncargos(guildId, userId, aviso = "") {
    const { fin, encargos: lista } = encargos.deLaSemana(guildId, userId);
    const embed = new EmbedBuilder()
        .setTitle("📋 Encargos de la semana")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `Tres retos nuevos cada lunes, con lo que haces de verdad en el servidor. Caducan <t:${Math.floor(fin / 1000)}:R>, sin penalización.`,
        )
        .addFields(
            lista.map((e) => ({
                name: `${e.nombreDificultad} · ${e.texto} · ${fmtNumero(e.recompensa)} 🪙`,
                value: `${barra(e.progreso, e.meta)} · ${estado(e)}`,
            })),
        );
    const fila = new ActionRowBuilder().addComponents(
        ...lista.map((e) =>
            new ButtonBuilder()
                .setCustomId(`encargos_cobrar_${e.slot}`)
                .setLabel(`🎁 Cobrar ${e.nombreDificultad.toLowerCase()}`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(!e.completado_en || Boolean(e.reclamado_en)),
        ),
        new ButtonBuilder().setCustomId(`perfil_eco_${userId}_${userId}`).setLabel("◀ Economía").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

module.exports = { pantallaEncargos, barra };
