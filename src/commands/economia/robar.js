// /robar: intenta quitarle efectivo a alguien (cooldown global de 2h). Lógica en systems/robar.js.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { robar, MIN_VICTIMA } = require("../../systems/robar");
const { createLogger } = require("../../core/logger");

const log = createLogger("Robar");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("robar")
        .setDescription("Intenta robarle efectivo a alguien. Puede salir mal (cooldown global de 2h).")
        .addUserOption((o) => o.setName("persona").setDescription("A quién intentas robar").setRequired(true)),
    async run(client, interaction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: "Esto solo funciona en un servidor.", flags: MessageFlags.Ephemeral });
            return;
        }

        const victima = interaction.options.getUser("persona", true);
        if (victima.bot) {
            await interaction.reply({ content: "❌ No puedes robarle a un bot.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (victima.id === interaction.user.id) {
            await interaction.reply({ content: "❌ No puedes robarte a ti mismo.", flags: MessageFlags.Ephemeral });
            return;
        }

        const r = robar(interaction.guildId, interaction.user.id, victima.id);

        if (!r.ok) {
            if (r.reason === "cooldown") {
                const minutos = Math.ceil(r.retrySeconds / 60);
                await interaction.reply({
                    content: `⏳ Todavía no puedes volver a robar. Espera ${minutos} min más.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.reply({
                content: `❌ ${victima.username} no tiene ni ${MIN_VICTIMA} 🪙 en efectivo: no merece la pena robarle.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (r.exito) {
            await interaction.reply(
                `🥷 Le has robado **${r.cantidad.toLocaleString("es")}** 🪙 a ${victima.username}. Dinero negro: lo puedes gastar, pero no meterlo en el banco hasta blanquearlo.`,
            );
        } else {
            await interaction.reply(
                r.multa > 0
                    ? `🚨 Te han pillado intentando robar a ${victima.username}. Pagas una multa de **${r.multa.toLocaleString("es")}** 🪙.`
                    : `🚨 Te han pillado intentando robar a ${victima.username}, pero no tenías ni para la multa.`,
            );
        }
        log.info(
            `${interaction.user.tag} usó /robar contra ${victima.tag}: ${r.exito ? `+${r.cantidad} (negro)` : `falló, multa ${r.multa}`}`,
        );
    },
};
