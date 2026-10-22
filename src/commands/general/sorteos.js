// 🎁 /sorteos (#541): lista los sorteos activos del servidor y atiende el botón de entrar/salir de cada
// mensaje. Los sorteos los crea un admin desde Panel admin; el cierre y el reparto, systems/sorteos.
const { SlashCommandBuilder } = require("discord.js");
const sorteos = require("../../systems/sorteos");
const xpSystem = require("../../systems/xpSystem");
const { buildSorteo, buildLista } = require("../../paneles/sorteo");
const { efimero } = require("../../discord/respuestas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Sorteos");

/** Motivo por el que alguien no puede entrar, o null si cumple los requisitos. */
function requisitoIncumplido(interaction, sorteo) {
    if (sorteo.rolId && !interaction.member?.roles?.cache?.has(sorteo.rolId)) {
        return `Necesitas el rol <@&${sorteo.rolId}> para entrar en este sorteo.`;
    }
    if (sorteo.nivel > 0 && (xpSystem.getProfile(interaction.guildId, interaction.user.id).nivel || 0) < sorteo.nivel) {
        return `Necesitas nivel **${sorteo.nivel}** o más para entrar en este sorteo.`;
    }
    return null;
}

async function alternar(interaction, sorteoId) {
    const sorteo = sorteos.porId(sorteoId);
    if (!sorteo || sorteo.guildId !== interaction.guildId) {
        return interaction.reply(efimero("❌ Ese sorteo no existe en este servidor."));
    }
    if (sorteo.estado !== "activo" || sorteo.fin <= Date.now()) {
        return interaction.reply(efimero("⏳ Este sorteo ya ha terminado."));
    }
    const incumple = requisitoIncumplido(interaction, sorteo);
    if (incumple) return interaction.reply(efimero(`❌ ${incumple}`));

    const r = sorteos.participar(sorteo.id, interaction.user.id);
    if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
    log.info(`${interaction.user.tag} ${r.dentro ? "entró en" : "salió de"} el sorteo #${sorteo.id}`);
    await interaction.reply(
        efimero(r.dentro ? "🎟️ Estás dentro del sorteo. ¡Suerte!" : "👋 Has salido del sorteo. Puedes volver a entrar."),
    );
    // El mensaje público lleva el contador de participantes: se repinta sin bloquear la respuesta.
    await interaction.message
        ?.edit(buildSorteo(sorteo, { participantes: sorteos.cuentaParticipantes(sorteo.id) }))
        .catch((e) => log.debug(`No pude repintar el sorteo #${sorteo.id}: ${e.message}`));
}

module.exports = {
    data: new SlashCommandBuilder().setName("sorteos").setDescription("🎁 Los sorteos activos del servidor"),

    componentHandlers: [{ types: ["button"], prefixes: ["sorteo_entrar_"], method: "handleButton", acl: "sorteos" }],

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        return interaction.reply(efimero(buildLista(sorteos.activos(interaction.guildId))));
    },

    async handleButton(client, interaction) {
        if (!interaction.customId.startsWith("sorteo_entrar_")) return;
        return alternar(interaction, interaction.customId.replace("sorteo_entrar_", ""));
    },
};
