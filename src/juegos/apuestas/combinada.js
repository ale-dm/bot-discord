// 🧩 Combinadas (#1): los botones y formularios del boleto. El boleto se arma en un mensaje efímero (solo lo ve quien lo
// arma): ⚽ Apuestas → 🧩 Combinada lo abre, y 🧩 Sumar a mi combinada (en un partido) añade una pata.
const { EmbedBuilder, ModalBuilder, MessageFlags } = require("discord.js");
const combinadas = require("../../systems/apuestas/combinadas");
const { pantallaCombinada } = require("../../paneles/combinada");
const { efimero } = require("../../core/respuestas");
const { filasImporte, importeElegido } = require("../../paneles/importes");

module.exports = {
    componentHandlers: [
        { types: ["button"], ids: ["combinada_abrir"], method: "handleAbrir", acl: "juegos" },
        { types: ["button"], prefixes: ["combinada_"], method: "handleButton", acl: "juegos" },
        { types: ["stringSelect"], prefixes: ["combinada_sumar_"], method: "handleSumar", acl: "juegos" },
        { types: ["modal"], prefixes: ["combinada_modal_"], method: "handleModal", acl: "juegos" },
    ],

    /** 🧩 Combinada, desde el panel de Apuestas: abre el boleto (efímero). */
    async handleAbrir(client, interaction) {
        return interaction.reply(efimero(pantallaCombinada(interaction.user.id)));
    },

    async handleSumar(client, interaction) {
        const matchId = interaction.customId.replace("combinada_sumar_", "");
        const r = combinadas.sumar(interaction.user.id, matchId, interaction.values[0]);
        return interaction.reply(efimero(pantallaCombinada(interaction.user.id, r.mensaje)));
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const userId = interaction.user.id;
        if (id === "combinada_ver") return interaction.update(pantallaCombinada(userId));
        if (id === "combinada_vaciar") {
            combinadas.vaciar(userId);
            return interaction.update(pantallaCombinada(userId, "🗑️ Boleto vaciado."));
        }
        if (id.startsWith("combinada_quitar_")) {
            const quitada = combinadas.quitar(userId, id.replace("combinada_quitar_", ""));
            return interaction.update(
                pantallaCombinada(userId, quitada ? "✖ Partido quitado." : "Ese partido ya no está en tu combinada."),
            );
        }
        if (id === "combinada_apostar") {
            const modal = new ModalBuilder()
                .setCustomId("combinada_modal_apostar")
                .setTitle("🧩 Apostar combinada")
                .addComponents(
                    ...filasImporte({
                        textoEtiqueta: `Otra cantidad (${combinadas.MIN_APUESTA}-${combinadas.MAX_APUESTA})`,
                        placeholder: "Ejemplo: 100",
                    }),
                );
            return interaction.showModal(modal);
        }
    },

    async handleModal(client, interaction) {
        if (interaction.customId !== "combinada_modal_apostar") return;
        const userId = interaction.user.id;
        const cantidad = importeElegido(interaction.fields);
        const r = combinadas.apostar(interaction.guildId, userId, cantidad);
        if (!r.ok) return interaction.reply(efimero(pantallaCombinada(userId, r.mensaje)));
        const embed = new EmbedBuilder()
            .setTitle("✅ ¡Combinada registrada!")
            .setDescription(
                `**Importe:** \`${cantidad}\` monedas · **Cuota total:** \`${r.cuota}\`\n` +
                    `**Si aciertas todos:** \`${r.premio}\` monedas.\n\nSe liquida a medida que se juegan sus partidos. ¡Suerte!`,
            )
            .setColor(0x27ae60);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
