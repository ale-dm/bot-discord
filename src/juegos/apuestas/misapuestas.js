// Botones de la pestaña 📋 Mis jugadas de /juegos (antes el comando /misapuestas): cambian de vista en el
// mismo mensaje. Stats (de mensajes antiguos) abre la pestaña 📊 Stats, que ya junta casino y apuestas.
// También ↩️ cancelar una apuesta (F-AP-05): se elige en el menú, se confirma y se vuelve a ⏳ En juego.
const { MessageFlags } = require("discord.js");
const { buildMisJugadas, buildConfirmarCancelar } = require("../../paneles/misJugadas");
const { buildStatsJuegos } = require("../../paneles/juegos");
const cancelar = require("../../systems/apuestas/cancelar");

async function soloSuyas(interaction, userId) {
    if (interaction.user.id === userId) return true;
    await interaction.reply({ content: "❌ Solo puedes ver tus propias apuestas.", flags: MessageFlags.Ephemeral });
    return false;
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["misapuestas_"], method: "handleButton", acl: "juegos" },
        { types: ["stringSelect"], prefixes: ["misapuestas_cancelarsel_"], method: "handleSelect", acl: "juegos" },
    ],

    // misapuestas_{vista}_{userId}: solo quien las abrió puede cambiar de vista.
    // misapuestas_cancelarok_{apuestaId}_{userId}: confirma la cancelación.
    async handleButton(client, interaction) {
        const partes = interaction.customId.split("_");
        if (partes[1] === "cancelarok") {
            const [, , apuestaId, userId] = partes;
            if (!(await soloSuyas(interaction, userId))) return;
            const r = cancelar.cancelar(userId, apuestaId);
            await interaction.update(buildMisJugadas(userId, "activas", r.mensaje));
            return;
        }
        const [, vista, userId] = partes;
        if (!(await soloSuyas(interaction, userId))) return;
        await interaction.update(
            vista === "stats" ? { content: "", ...buildStatsJuegos(userId, interaction.user.username) } : buildMisJugadas(userId, vista),
        );
    },

    // misapuestas_cancelarsel_{userId}: la apuesta elegida para cancelar → pantalla de confirmación.
    async handleSelect(client, interaction) {
        const userId = interaction.customId.split("_")[2];
        if (!(await soloSuyas(interaction, userId))) return;
        const a = cancelar.cancelable(userId, interaction.values[0]);
        if (!a) {
            await interaction.update(buildMisJugadas(userId, "activas", "❌ Esa apuesta ya no se puede cancelar: el partido ha empezado."));
            return;
        }
        await interaction.update(buildConfirmarCancelar(userId, a));
    },
};
