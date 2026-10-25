// 🛡️ Guardia en el panel de /duende (#553): 🛡️ Guardia entra al canal de voz de quien pulsa (o, si no está en ninguno, abre
// un formulario para elegirlo) y 🚪 Dejar la guardia se sale. La lógica está en systems/guardia.js; aquí, el formulario y
// qué contesta cada botón. Quien mueve o deja una guardia activa se comprueba aquí otra vez (no basta con el botón).
const { MessageFlags, ModalBuilder, LabelBuilder, ChannelSelectMenuBuilder, ChannelType } = require("discord.js");
const guardia = require("../systems/guardia");
const { esAdmin } = require("../core/permisos");

const ID_BOTON = "duendepanel_guardia";
const ID_DEJAR = "duendepanel_guardia_dejar";
const ID_MODAL = "duendepanel_modal_guardia";
const CAMPO_CANAL = "canal";

const soloQuienLaPuso = (interaction) =>
    interaction.reply({
        content: "⛔ Solo quien puso la guardia o un admin puede moverla o quitarla.",
        flags: MessageFlags.Ephemeral,
    });

/** La guardia activa tal y como la enseña el panel, o null. */
function estado(interaction) {
    const g = guardia.actual(interaction.guildId);
    if (!g) return null;
    return { ...g, puedeGestionar: guardia.puedeGestionar(interaction.guildId, interaction.user.id, esAdmin(interaction)) };
}

/** El formulario para elegir el canal de voz (cuando quien pulsa no está en ninguno). */
function modalCanal() {
    return new ModalBuilder()
        .setCustomId(ID_MODAL)
        .setTitle("🛡️ Guardia")
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("¿En qué canal de voz me quedo?")
                .setChannelSelectMenuComponent(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(CAMPO_CANAL)
                        .setChannelTypes(ChannelType.GuildVoice)
                        .setMinValues(1)
                        .setMaxValues(1)
                        .setRequired(true)
                        .setPlaceholder("Elige un canal de voz"),
                ),
        );
}

// Pone la guardia y repinta el panel con el resultado (o con el motivo si no se pudo).
async function ponerEn(interaction, canal, vista) {
    const actual = guardia.actual(interaction.guildId);
    if (actual?.canalId === canal.id) return vista(interaction, `🛡️ Ya estoy de guardia en **${actual.canalNombre}**.`);
    const r = await guardia.poner(canal, { porUserId: interaction.user.id });
    if (!r.ok) return vista(interaction, `❌ ${r.motivo}`);
    return vista(interaction, `🛡️ De guardia en **${r.canal}**. Me quedo hasta que pulses 🚪 Dejar la guardia.`);
}

// El panel ya es efímero: se edita el mismo mensaje; si el formulario no sale de él, se contesta en privado.
async function diferir(interaction) {
    if (interaction.isFromMessage?.() || interaction.isButton?.()) return interaction.deferUpdate();
    return interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

/** 🛡️ Guardia y 🚪 Dejar la guardia. `vista(interaction, aviso)` devuelve el panel de inicio con un aviso. */
async function handleButton(interaction, vista) {
    const permitido = guardia.puedeGestionar(interaction.guildId, interaction.user.id, esAdmin(interaction));
    if (interaction.customId === ID_DEJAR) {
        if (!guardia.actual(interaction.guildId)) return interaction.update(vista(interaction, "Ahora mismo no estoy de guardia."));
        if (!permitido) return soloQuienLaPuso(interaction);
        guardia.dejar(interaction.guildId, interaction.user.id);
        return interaction.update(vista(interaction, "🚪 He dejado la guardia y me he salido del canal."));
    }
    if (!permitido) return soloQuienLaPuso(interaction);
    const canal = interaction.member?.voice?.channel;
    if (!canal) return interaction.showModal(modalCanal());
    await diferir(interaction);
    return interaction.editReply(await ponerEn(interaction, canal, vista));
}

/** El formulario: el canal elegido. Si se cierra sin enviarlo, Discord no manda nada y no me conecto. */
async function handleModal(interaction, vista) {
    if (!guardia.puedeGestionar(interaction.guildId, interaction.user.id, esAdmin(interaction))) return soloQuienLaPuso(interaction);
    const elegido = [...(interaction.fields.getSelectedChannels(CAMPO_CANAL)?.keys() ?? [])][0];
    const canal = elegido ? await interaction.guild?.channels.fetch(elegido).catch(() => null) : null;
    await diferir(interaction);
    if (!canal || canal.isVoiceBased?.() === false)
        return interaction.editReply(vista(interaction, "❌ Elige un canal de voz del servidor para la guardia."));
    return interaction.editReply(await ponerEn(interaction, canal, vista));
}

module.exports = { ID_BOTON, ID_DEJAR, ID_MODAL, estado, modalCanal, handleButton, handleModal };
