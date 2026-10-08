// 🔊 Sonidos en /paneladmin: subir un sonido (nombre + archivo mp3/ogg/wav de hasta 1 MB, en un formulario) y borrar
// alguno. Lo que suena lo mira /sonidos (systems/sonidos.js).
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    FileUploadBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
} = require("discord.js");
const sonidos = require("../systems/sonidos");
const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin").child("Sonidos");

function buildSonidosHome(guildId) {
    const lista = sonidos.listar(guildId);
    const lleno = lista.length >= sonidos.MAX_SONIDOS;
    const embed = new EmbedBuilder()
        .setTitle("🔊 Sonidos")
        .setColor(0x3498db)
        .setDescription(
            `Sonidos del servidor: **${lista.length}** de ${sonidos.MAX_SONIDOS}.\n` +
                "Los reproduce **/sonidos** (con el botón de cada uno). Formatos: mp3, ogg o wav, hasta 1 MB.\n\n" +
                (lista.length ? lista.map((s) => `🔊 ${s.nombre}`).join("\n") : "Todavía no hay ninguno."),
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("paneladmin_sonidos_subir")
            .setLabel("➕ Subir sonido")
            .setStyle(ButtonStyle.Success)
            .setDisabled(lleno),
        new ButtonBuilder()
            .setCustomId("paneladmin_sonidos_borrar")
            .setLabel("🗑️ Borrar sonido")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!lista.length),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

function buildBorrar(guildId) {
    const lista = sonidos.listar(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🗑️ Borrar un sonido")
        .setColor(0xe74c3c)
        .setDescription("Elige cuál borrar. Se quita del panel y del disco.");
    const menu = new StringSelectMenuBuilder()
        .setCustomId("paneladmin_sonidos_borrar_select")
        .setPlaceholder("Qué sonido borrar")
        .addOptions(lista.slice(0, 25).map((s) => ({ label: s.nombre.slice(0, 100), value: String(s.id) })));
    const volver = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sonidos_home").setLabel("◀ Volver a sonidos").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), volver] };
}

function modalSubir() {
    return new ModalBuilder()
        .setCustomId("paneladmin_sonidos_modal_subir")
        .setTitle("➕ Subir sonido")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("Cómo se llama")
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId("nombre")
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(32)
                        .setPlaceholder("Risa de Ana")
                        .setRequired(true),
                ),
            new LabelBuilder()
                .setLabel("Archivo (mp3, ogg o wav, 1 MB)")
                .setFileUploadComponent(new FileUploadBuilder().setCustomId("archivo").setMinValues(1).setMaxValues(1).setRequired(true)),
        );
}

/** Los botones del panel de sonidos. Devuelve true si era de este panel. */
async function handleSonidosButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith("paneladmin_sonidos_")) return false;
    const guildId = interaction.guildId;
    if (id === "paneladmin_sonidos_home") await interaction.update(buildSonidosHome(guildId));
    else if (id === "paneladmin_sonidos_subir") await interaction.showModal(modalSubir());
    else if (id === "paneladmin_sonidos_borrar") await interaction.update(buildBorrar(guildId));
    else return false;
    return true;
}

/** El formulario de subir. Devuelve true si era de este panel. */
async function handleSonidosModal(interaction) {
    if (interaction.customId !== "paneladmin_sonidos_modal_subir") return false;
    const nombre = interaction.fields.getTextInputValue("nombre");
    const archivo = interaction.fields.getUploadedFiles("archivo")?.first?.() || null;
    if (!archivo) {
        await interaction.reply({ content: "❌ No llegó ningún archivo.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const r = await sonidos.guardar(interaction.guildId, {
        nombre,
        archivo: { nombreArchivo: archivo.name, url: archivo.url, tamano: archivo.size },
        userId: interaction.user.id,
    });
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.motivo}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    log.info(`${interaction.user.tag} añadió el sonido «${r.sonido.nombre}» en ${interaction.guildId}`);
    await interaction.reply({ content: `✅ Sonido **${r.sonido.nombre}** añadido. Ya sale en /sonidos.`, flags: MessageFlags.Ephemeral });
    return true;
}

/** El menú de borrar. Devuelve true si era de este panel. */
async function handleSonidosStringSelect(interaction) {
    if (interaction.customId !== "paneladmin_sonidos_borrar_select") return false;
    const guildId = interaction.guildId;
    const id = interaction.values[0];
    const sonido = sonidos.obtener(guildId, id);
    if (sonido) {
        sonidos.borrar(guildId, id);
        log.info(`${interaction.user.tag} borró el sonido «${sonido.nombre}» en ${guildId}`);
    }
    await interaction.update({
        ...buildSonidosHome(guildId),
        content: sonido ? `🗑️ Borrado **${sonido.nombre}**.` : "Ese sonido ya no existe.",
    });
    return true;
}

module.exports = { buildSonidosHome, buildBorrar, modalSubir, handleSonidosButton, handleSonidosModal, handleSonidosStringSelect };
