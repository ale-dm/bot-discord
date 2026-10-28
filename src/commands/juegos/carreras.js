// 🏇 /carreras (#535): la carrera abierta del servidor en privado, para apostar, y las últimas carreras. Los botones del
// mensaje público abren el formulario de la apuesta. Reglas en systems/carreras.js, mensaje en paneles/carrera.js.
const { SlashCommandBuilder } = require("discord.js");
const carreras = require("../../systems/carreras");
const { mensajeCarrera, modalApuesta } = require("../../paneles/carrera");
const { fmtNumero } = require("../../core/formato");
const { efimero } = require("../../discord/respuestas");

const numero = (texto) => Number(String(texto ?? "").replace(/[.\s]/g, ""));

/** Las últimas carreras: quién ganó cada una. */
function textoHistorial(guildId) {
    const lista = carreras.historial(guildId);
    if (!lista.length) return "";
    const lineas = lista.map((c) => {
        const g = c.corredores[c.ganador];
        return `#${c.id} · <t:${Math.floor(c.resuelta_en / 1000)}:R> · ${g.emoji} ${g.nombre} ×${String(g.cuota).replace(".", ",")}`;
    });
    return `**Últimas carreras**\n${lineas.join("\n")}`;
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["carrera_"], method: "handleButton", acl: "carreras" },
        { types: ["modal"], prefixes: ["carrera_modal_"], method: "handleModal", acl: "carreras" },
    ],
    data: new SlashCommandBuilder().setName("carreras").setDescription("🏇 Carreras de caballos con cuotas: la próxima y las últimas"),

    async run(client, interaction) {
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const c = carreras.abierta(interaction.guildId);
        const historial = textoHistorial(interaction.guildId);
        if (!c) {
            return interaction.reply(
                efimero(
                    `🏇 Ahora mismo no hay carreras: un admin tiene que elegir su canal en el panel.${historial ? `\n\n${historial}` : ""}`,
                ),
            );
        }
        return interaction.reply(efimero({ ...mensajeCarrera(c), content: historial }));
    },

    // carrera_apostar_{id}_{caballo}: abre el formulario.
    async handleButton(client, interaction) {
        const [, , id, corredor] = interaction.customId.split("_");
        const c = carreras.obtener(Number(id));
        if (!c || c.estado !== "abierta" || c.empieza <= Date.now()) {
            return interaction.reply(efimero("🏁 Las apuestas de esta carrera ya están cerradas."));
        }
        return interaction.showModal(modalApuesta(c, Number(corredor)));
    },

    // carrera_modal_{id}_{caballo}
    async handleModal(client, interaction) {
        const [, , id, corredor] = interaction.customId.split("_");
        const r = carreras.apostar(
            Number(id),
            interaction.user.id,
            Number(corredor),
            numero(interaction.fields.getTextInputValue("cantidad")),
        );
        if (!r.ok) return interaction.reply(efimero(`❌ ${r.motivo}`));
        const { caballo, cantidad, cuota } = r.apuesta;
        return interaction.reply(
            efimero(
                `🏇 Apuesta hecha: **${fmtNumero(cantidad)}** 🪙 a ${caballo.emoji} **${caballo.nombre}** (×${String(cuota).replace(".", ",")}). Si gana, cobras **${fmtNumero(Math.floor(cantidad * cuota))}** 🪙.`,
            ),
        );
    },
};
