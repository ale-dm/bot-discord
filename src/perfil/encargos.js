// 📋 Botones de los encargos semanales (#523) en /perfil → 💰 Economía: abrir la pantalla y cobrar un encargo completado.
// Solo los usa quien abrió el panel. Reglas en systems/encargos.js, pantalla en paneles/encargos.js.
const encargos = require("../systems/encargos");
const { pantallaEncargos } = require("../paneles/encargos");
const { fmtNumero } = require("../core/formato");
const { efimero } = require("../discord/respuestas");

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["encargos_"], method: "handleButton", acl: "perfil" }],

    async handleButton(client, interaction) {
        const ownerId = interaction.message?.interaction?.user?.id || interaction.message?.interactionMetadata?.user?.id;
        if (ownerId && ownerId !== interaction.user.id)
            return interaction.reply(efimero("Este panel no es tuyo: abre el tuyo con /perfil."));
        if (!interaction.guildId) return interaction.reply(efimero("Esto solo funciona en un servidor."));
        const { guildId, user } = interaction;
        const cobrar = /^encargos_cobrar_(\d)$/.exec(interaction.customId);
        if (!cobrar) return interaction.update(pantallaEncargos(guildId, user.id));
        const r = encargos.reclamar(guildId, user.id, Number(cobrar[1]));
        const aviso = r.ok ? `🎁 ¡Cobrado! **+${fmtNumero(r.encargo.recompensa)}** 🪙 por «${r.encargo.texto}».` : `❌ ${r.motivo}`;
        return interaction.update(pantallaEncargos(guildId, user.id, aviso));
    },
};
