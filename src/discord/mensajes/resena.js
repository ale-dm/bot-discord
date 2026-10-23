// ⭐ El DM de las reseñas (#566): 10 botones de media estrella, «Ahora no» y el formulario de la nota y la opinión.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    LabelBuilder,
    RadioGroupBuilder,
    TextInputBuilder,
    TextInputStyle,
    CheckboxBuilder,
} = require("discord.js");
const { estrellasTexto } = require("../../systems/plexResenas");

const NOTAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** La fila de ✏️ / 🗑️ que queda en el DM después de reseñar. */
function filaEditar(pedido) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`plex_resena_editar_${pedido.id}`).setLabel("✏️ Cambiar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`plex_resena_borrar_${pedido.id}`).setLabel("🗑️ Borrar").setStyle(ButtonStyle.Danger),
    );
}

/** El DM: título, año y las 10 medias estrellas en dos filas, más «Ahora no». */
function mensajeResena(pedido) {
    const embed = new EmbedBuilder()
        .setTitle("🍿 ¿Qué te ha parecido?")
        .setDescription(
            `Has terminado **${pedido.titulo}**${pedido.anio ? ` (${pedido.anio})` : ""}.\n\n` +
                "Elige tu nota: de ½ a ★★★★★. Después puedes escribir tu opinión.",
        )
        .setColor(0xe5a00d);
    const filas = [];
    for (let i = 0; i < NOTAS.length; i += 5) {
        filas.push(
            new ActionRowBuilder().addComponents(
                NOTAS.slice(i, i + 5).map((n) =>
                    new ButtonBuilder()
                        .setCustomId(`plex_resena_nota_${pedido.id}_${n}`)
                        .setLabel(estrellasTexto(n))
                        .setStyle(ButtonStyle.Secondary),
                ),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`plex_resena_no_${pedido.id}`).setLabel("⏭️ Ahora no").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** El formulario: la nota ya marcada (la de la estrella pulsada o la que tuviera), la opinión, spoilers y me gusta. */
function formularioResena(pedido, resena = null, notaElegida = null, customId = null) {
    const nota = Number(notaElegida || resena?.nota || 6);
    const radio = new RadioGroupBuilder()
        .setCustomId("nota")
        .setRequired(true)
        .addOptions(NOTAS.map((n) => ({ label: estrellasTexto(n), value: String(n), default: n === nota })));
    const texto = new TextInputBuilder().setCustomId("texto").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false);
    if (resena?.texto) texto.setValue(resena.texto.slice(0, 500));

    return new ModalBuilder()
        .setCustomId(customId || `plex_modal_resena_${pedido.id}`)
        .setTitle(`⭐ ${pedido.titulo}`.slice(0, 45))
        .addComponents(
            new LabelBuilder().setLabel("Tu nota").setRadioGroupComponent(radio),
            new LabelBuilder().setLabel("Tu opinión (opcional)").setTextInputComponent(texto),
            new LabelBuilder()
                .setLabel("Contiene spoilers")
                .setCheckboxComponent(new CheckboxBuilder().setCustomId("spoilers").setDefault(Boolean(resena?.spoilers))),
            new LabelBuilder()
                .setLabel("❤️ Me gusta")
                .setCheckboxComponent(new CheckboxBuilder().setCustomId("megusta").setDefault(Boolean(resena?.meGusta))),
        );
}

module.exports = { NOTAS, mensajeResena, formularioResena, filaEditar };
