// 🔔 El botón «Avisarme» de las respuestas de cooldown de /trabajar y /robar (#434): customId
// cooldown_avisar_{comando}_{segundo unix en que acaba el cooldown}. Al pulsarlo se apunta el aviso y el botón pasa a «Te avisaré».
// Las reglas están en systems/avisosCooldown.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const avisosCooldown = require("../systems/avisosCooldown");
const { efimero } = require("../core/respuestas");

const PREFIJO = "cooldown_avisar_";

/** La fila con el botón, para un cooldown al que le quedan `segundos`. */
function filaAvisar(comando, segundos, ahora = Date.now()) {
    const cuando = Math.floor(avisosCooldown.momentoDeAviso(segundos, ahora) / 1000);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}${comando}_${cuando}`).setLabel("🔔 Avisarme").setStyle(ButtonStyle.Secondary),
    );
}

/** El mismo botón ya pulsado: desactivado y con «Te avisaré». */
function filaAvisado(customId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(customId).setLabel("🔔 Te avisaré").setStyle(ButtonStyle.Success).setDisabled(true),
    );
}

module.exports = {
    filaAvisar,
    filaAvisado,
    componentHandlers: [{ types: ["button"], prefixes: [PREFIJO], method: "handleButton" }],

    async handleButton(client, interaction) {
        // Solo avisa a quien usó el comando: la respuesta de /trabajar es pública.
        const dueno = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (dueno && dueno !== interaction.user.id) return interaction.reply(efimero("⛔ Este aviso es de quien usó el comando."));
        const [comando, segundos] = interaction.customId.slice(PREFIJO.length).split("_");
        const r = avisosCooldown.programar(interaction.user.id, comando, interaction.guildId, Number(segundos) * 1000);
        if (!r.ok) return interaction.reply(efimero(r.mensaje));
        return interaction.update({ components: [filaAvisado(interaction.customId)] });
    },
};
