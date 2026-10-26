// 🗳️ Los pasos privados de votar (elegir candidato y luego 🔒 secreto o 📢 público) y el formulario del programa electoral.
// Solo construye mensajes y modales; los responde el comando /elecciones.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { candidatos: reglas } = require("../../systems/elecciones");

const COLOR = 0x9b59b6;

const nombreDe = (nombres, userId) => String(nombres.get(userId) || userId).slice(0, 100);

/**
 * Paso 1: el desplegable con la papeleta. `voto`: el que ya tiene en esta fase (sale marcado), o null.
 * @param {Map<string, string>} nombres userId → nombre visible
 */
function pasoElegir(eleccion, papeleta, nombres, voto = null) {
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(eleccion.estado === "generales" ? "🏛️ Elecciones generales" : "🗳️ Primarias")
        .setDescription(
            (voto
                ? `Ahora mismo votas a <@${voto.candidatoId}> (${voto.publico ? "📢 público" : "🔒 secreto"}). Puedes cambiarlo.\n\n`
                : "") + "Elige a tu candidato. Después decides si tu voto es secreto o público.",
        );
    const select = new StringSelectMenuBuilder()
        .setCustomId(`elec_elegir_${eleccion.id}`)
        .setPlaceholder("Elige a tu candidato")
        .addOptions(
            papeleta.slice(0, reglas.MAX_CANDIDATOS).map((c) => ({
                label: nombreDe(nombres, c.userId),
                ...(c.partido ? { description: `${c.partido} — «${c.eslogan}»`.slice(0, 100) } : {}),
                value: c.userId,
                default: voto?.candidatoId === c.userId,
            })),
        );
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], allowedMentions: { parse: [] } };
}

/** Paso 2: ¿secreto o público? */
function pasoModo(eleccion, candidatoId) {
    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle("¿Cómo quieres votar?")
        .setDescription(
            `Vas a votar a <@${candidatoId}>.\n\n` +
                "🔒 **Secreto**: solo suma en el recuento; nadie sabe a quién has votado.\n" +
                "📢 **Público**: sale en el panel de las elecciones que has votado a esta persona.",
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`elec_modo_${eleccion.id}_${candidatoId}_s`).setLabel("🔒 Secreto").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`elec_modo_${eleccion.id}_${candidatoId}_p`).setLabel("📢 Público").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`elec_votar_${eleccion.id}`).setLabel("↩️ Elegir otro").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

/** Paso 3: confirmación (sustituye a los pasos anteriores). */
function votoHecho(r, candidatoId) {
    const modo = r.publico ? "📢 público" : "🔒 secreto";
    const texto = r.antes
        ? `🔄 Has cambiado tu voto: ahora votas a <@${candidatoId}> (${modo}).`
        : `✅ Has votado a <@${candidatoId}> (${modo}).`;
    return { content: texto, embeds: [], components: [], allowedMentions: { parse: [] } };
}

/** El formulario del programa electoral (partido, eslogan, título y texto), con lo que ya hubiera escrito. */
function modalPrograma(eleccionId, candidato = null) {
    const partido = new TextInputBuilder()
        .setCustomId("partido")
        .setLabel("Nombre de tu partido político")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(reglas.PARTIDO_MAX)
        .setRequired(true)
        .setValue(candidato?.partido || "");
    const eslogan = new TextInputBuilder()
        .setCustomId("eslogan")
        .setLabel("Eslogan del partido")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(reglas.ESLOGAN_MAX)
        .setRequired(true)
        .setValue(candidato?.eslogan || "");
    const titulo = new TextInputBuilder()
        .setCustomId("titulo")
        .setLabel("Título del programa")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(reglas.TITULO_MAX)
        .setRequired(true)
        .setValue(candidato?.programa_titulo || "");
    const texto = new TextInputBuilder()
        .setCustomId("texto")
        .setLabel("Tu programa: qué harás como presidente")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(reglas.TEXTO_MAX)
        .setRequired(true)
        .setValue(candidato?.programa_texto || "");
    return new ModalBuilder()
        .setCustomId(`elec_programamodal_${eleccionId}`)
        .setTitle("📜 Programa electoral")
        .addComponents(
            new ActionRowBuilder().addComponents(partido),
            new ActionRowBuilder().addComponents(eslogan),
            new ActionRowBuilder().addComponents(titulo),
            new ActionRowBuilder().addComponents(texto),
        );
}

module.exports = { pasoElegir, pasoModo, votoHecho, modalPrograma };
