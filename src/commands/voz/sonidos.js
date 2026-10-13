// 🔊 /sonidos: el panel de sonidos del servidor (como el de Discord). Público: cualquiera pulsa un sonido y el bot lo toca.
// Los sonidos se suben y se borran desde /paneladmin → 🔊 Sonidos. Si el bot está en un canal por /conectar, suena ahí.
// Con otro sonido sonando, el pulsado espera en una cola; entre dos sonidos de la misma persona hay un cooldown (salvo admins).
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const sonidos = require("../../systems/sonidos");
const ajustes = require("../../systems/sonidos/ajustes");
const cooldown = require("../../systems/sonidos/cooldown");
const { pantallaSonidos, modalBuscar, limpiarBusqueda, TODAS } = require("../../paneles/sonidos");
const { efimero } = require("../../discord/respuestas");
const { esAdmin } = require("../../core/permisos");

const PAGINA = /^sonido_pagina_(\d+)(?:\|([^|]*)\|([^|]*))?$/;

/** Por qué esta persona no puede pedir el sonido ahora (sin el rol, o en cooldown), o null si puede. */
function motivoNoPuede(interaction, sonido) {
    const acceso = ajustes.puedeUsar(sonido.id, interaction.member);
    if (!acceso.ok) return `🔒 Ese sonido es solo para ${acceso.roles.map((r) => `<@&${r}>`).join(", ")}.`;
    if (esAdmin(interaction)) return null;
    const falta = cooldown.segundosRestantes(interaction.guildId, interaction.user.id);
    return falta > 0 ? cooldown.avisoCooldown(falta) : null;
}

/** Pide un sonido en nombre de quien pulsó: lo toca, o lo deja en cola, y se lo cuenta en privado. */
async function pedirSonido(interaction, sonido) {
    const motivo = motivoNoPuede(interaction, sonido);
    if (motivo) return interaction.reply(efimero(motivo));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const canal = interaction.member?.voice?.channel ?? null;
    const donde = canal ? canal.name : "el canal donde estoy";
    const anotar = () => cooldown.marcar(interaction.guildId, interaction.user.id);
    // La confirmación sale cuando el sonido empieza, no cuando acaba (puede durar minutos).
    const r = await sonidos.reproducir(interaction.guildId, canal, sonido, {
        alEncolar: (puesto) => {
            anotar();
            return interaction.editReply(`📋 **${sonido.nombre}** en cola, puesto ${puesto}.`);
        },
        alEmpezar: () => {
            anotar();
            return interaction.editReply(`🔊 Sonando **${sonido.nombre}** en ${donde}.`);
        },
    });
    if (!r.ok) return interaction.editReply(`❌ ${r.motivo}`);
}

/** Un sonido de los que esta persona puede usar, al azar. */
function sonidoAlAzar(interaction) {
    const usables = sonidos.listar(interaction.guildId).filter((s) => ajustes.puedeUsar(s.id, interaction.member).ok);
    return usables[Math.floor(Math.random() * usables.length)] ?? null;
}

module.exports = {
    componentHandlers: [
        { types: ["button", "stringSelect"], prefixes: ["sonido_"], method: "handleButton", acl: "sonidos" },
        { types: ["modal"], prefixes: ["sonido_modal_"], method: "handleModal", acl: "sonidos" },
    ],
    data: new SlashCommandBuilder().setName("sonidos").setDescription("🔊 Panel de sonidos: pulsa uno y el bot lo reproduce"),

    async run(client, interaction) {
        // El panel es público: cualquiera lo puede pulsar, y lo que pasa al pulsar se ve solo a quien lo pulsa.
        return interaction.reply(pantallaSonidos(interaction.guildId, 0));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        if (interaction.isStringSelectMenu?.()) {
            const elegida = interaction.values[0];
            return interaction.update(pantallaSonidos(interaction.guildId, 0, { categoria: elegida === TODAS ? "" : elegida }));
        }
        const pagina = PAGINA.exec(id);
        if (pagina) {
            return interaction.update(pantallaSonidos(interaction.guildId, Number(pagina[1]), { categoria: pagina[2], texto: pagina[3] }));
        }
        if (id.startsWith("sonido_buscar|")) return interaction.showModal(modalBuscar(id.split("|")[1]));
        if (id.startsWith("sonido_limpiar|"))
            return interaction.update(pantallaSonidos(interaction.guildId, 0, { categoria: id.split("|")[1] }));
        if (id === "sonido_top")
            return interaction.reply(efimero(`🏆 **Los sonidos más usados**\n${ajustes.textoRanking(interaction.guildId)}`));
        if (id === "sonido_azar") {
            const sonido = sonidoAlAzar(interaction);
            return sonido ? pedirSonido(interaction, sonido) : interaction.reply(efimero("Todavía no hay sonidos para elegir."));
        }

        const play = /^sonido_play_(\d+)$/.exec(id);
        if (!play) return;
        const sonido = sonidos.obtener(interaction.guildId, play[1]);
        if (!sonido) return interaction.reply(efimero("Ese sonido ya no existe."));
        return pedirSonido(interaction, sonido);
    },

    async handleModal(client, interaction) {
        if (!interaction.customId.startsWith("sonido_modal_buscar|")) return;
        const categoria = interaction.customId.split("|")[1];
        const texto = limpiarBusqueda(interaction.fields.getTextInputValue("texto"));
        // Desde un modal abierto con un botón del panel, update cambia ese mensaje (como en un botón).
        return interaction.update(pantallaSonidos(interaction.guildId, 0, { categoria, texto }));
    },
};
