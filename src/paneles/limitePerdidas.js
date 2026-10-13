// 🛡️ La pantalla del límite de pérdidas personal (#319), dentro de 💰 Economía de /perfil: el límite que tienes, lo que llevas perdido
// en el periodo, el cambio pendiente (si subes o quitas el límite tarda 24 h) y los botones para ponerlo, cambiarlo o quitarlo.
// Las reglas están en systems/limitePerdidas; los botones dinero_limite* los atiende src/perfil/dinero.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    RadioGroupBuilder,
} = require("discord.js");
const limitePerdidas = require("../systems/limitePerdidas");
const { fmtNumero } = require("../core/formato");

const POR = { dia: "por día", semana: "por semana" };

/** Qué pasa con el cambio pendiente, en una línea. */
function textoPendiente(pendiente) {
    const cuando = `<t:${Math.floor(pendiente.aplicaEn / 1000)}:R>`;
    return pendiente.limite === 0
        ? `Se quitará el límite ${cuando}.`
        : `Pasará a **${fmtNumero(pendiente.limite)}** 🪙 ${POR[pendiente.periodo]} ${cuando}.`;
}

/**
 * La pantalla del límite. `aviso`: lo que se acaba de hacer (se ve arriba).
 * @returns {object} payload
 */
function buildLimite(userId, aviso = null) {
    const actual = limitePerdidas.estado(userId);
    const embed = new EmbedBuilder()
        .setTitle("🛡️ Límite de pérdidas")
        .setColor(0x3498db)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Pon tú mismo un tope de lo que pierdes en el 🎰 casino y las ⚽ apuestas (pérdidas netas: lo perdido menos lo ganado), " +
                "por día o por semana, en hora de Madrid. Al alcanzarlo no podrás apostar hasta que empiece el periodo siguiente, " +
                "y una apuesta que lo pasaría tampoco se acepta.\n\n" +
                "**Bajarlo** vale al momento. **Subirlo o quitarlo** tarda **24 horas**, para que no lo quites en mitad de una mala racha.",
        );
    if (actual) {
        const perdidas = limitePerdidas.perdidasDelPeriodo(userId, actual.periodo);
        embed.addFields(
            { name: "Tu límite", value: `**${fmtNumero(actual.limite)}** 🪙 ${POR[actual.periodo]}`, inline: true },
            { name: `Perdido ${POR[actual.periodo]}`, value: `**${fmtNumero(perdidas)}** 🪙`, inline: true },
        );
        if (actual.pendiente) embed.addFields({ name: "⏳ Cambio pendiente", value: textoPendiente(actual.pendiente) });
    } else {
        embed.addFields({ name: "Tu límite", value: "Sin límite", inline: true });
    }
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("dinero_limite_editar").setLabel("✏️ Poner o cambiar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("dinero_limite_quitar")
            .setLabel("🗑️ Quitar")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!actual || actual.pendiente?.limite === 0),
        new ButtonBuilder().setCustomId(`perfil_eco_${userId}_${userId}`).setLabel("◀ Economía").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

/** El formulario: cuánto y por qué periodo (con lo que ya tiene puesto, si lo tiene). */
function modalLimite(userId) {
    const actual = limitePerdidas.estado(userId);
    const cantidad = new TextInputBuilder()
        .setCustomId("limite")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setPlaceholder("1000");
    if (actual) cantidad.setValue(String(actual.limite));
    return new ModalBuilder()
        .setCustomId("dinero_modal_limite")
        .setTitle("🛡️ Límite de pérdidas")
        .addLabelComponents(
            new LabelBuilder().setLabel("Cuántas monedas como máximo").setTextInputComponent(cantidad),
            new LabelBuilder().setLabel("Periodo").setRadioGroupComponent(
                new RadioGroupBuilder()
                    .setCustomId("periodo")
                    .setRequired(true)
                    .addOptions(
                        { label: "Por día", value: "dia", default: (actual?.periodo ?? "dia") === "dia" },
                        { label: "Por semana", value: "semana", default: actual?.periodo === "semana" },
                    ),
            ),
        );
}

/** Lo que se le dice a quien pone o cambia el límite. */
function avisoDeFijar(r, limite, periodo) {
    const texto = `**${fmtNumero(limite)}** 🪙 ${POR[periodo]}`;
    if (r.inmediato) return `✅ Límite de pérdidas: ${texto}. Ya está en marcha.`;
    return `⏳ Subir el límite a ${texto} tarda 24 horas: hasta <t:${Math.floor(r.aplicaEn / 1000)}:f> sigue el de ahora.`;
}

module.exports = { buildLimite, modalLimite, avisoDeFijar };
