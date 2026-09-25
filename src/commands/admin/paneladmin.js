const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { createLogger } = require("../../core/logger");

const log = createLogger("PanelAdmin");
const { isAdmin } = require("../../adminPanel/common");
const { buildMainEmbed, buildMainRows } = require("../../adminPanel/views");
const { handleBankButton, handleBankModal, handleBankUserSelect } = require("../../adminPanel/bank");
const {
    handleLevelsButton,
    handleLevelsModal,
    handleRoleSelect: handleLevelsRoleSelect,
    handleStringSelect: handleLevelsStringSelect,
    handleChannelSelect: handleLevelsChannelSelect,
} = require("../../adminPanel/levels");
const { handleSettingsButton, handleSettingsModal } = require("../../adminPanel/settings");
const { handleApuestasButton } = require("../../adminPanel/apuestas");
const { handleCatalogoButton, handleCatalogoModal } = require("../../adminPanel/catalogo");
const { handleSistemaButton, handleSistemaSelect } = require("../../adminPanel/sistema");
const { handleAuditButton } = require("../../adminPanel/audit");
const { handlePlexButton, handlePlexUserSelect, handlePlexModal, handlePlexChannelSelect } = require("../../adminPanel/plex");
const { handleSeerrButton, handleSeerrChannelSelect, handleSeerrModal } = require("../../adminPanel/seerr");
const { handleApodosButton, handleApodosUserSelect, handleApodosModal } = require("../../adminPanel/apodos");
const {
    handlePerfilesButton,
    handlePerfilesUserSelect,
    handlePerfilesModal,
    handlePerfilesStringSelect,
} = require("../../adminPanel/perfilesDuende");

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["paneladmin_"], method: "handleButton" },
        { types: ["modal"], prefixes: ["paneladmin_"], method: "handleModal" },
        {
            types: ["stringSelect"],
            prefixes: ["paneladmin_levels_reward_search_pick_", "paneladmin_perfiles_", "paneladmin_sis_"],
            method: "handleStringSelect",
        },
        {
            types: ["userSelect"],
            prefixes: ["paneladmin_bank_", "paneladmin_plex_", "paneladmin_apodos_", "paneladmin_perfiles_"],
            method: "handleUserSelect",
        },
        { types: ["roleSelect"], prefixes: ["paneladmin_levels_reward_role_"], method: "handleRoleSelect" },
        {
            types: ["channelSelect"],
            ids: [
                "paneladmin_levels_cfg_channel_select",
                "paneladmin_levels_ignored_add_select",
                "paneladmin_plex_novedades_channel_select",
                "paneladmin_plex_channel_add_select",
                "paneladmin_seerr_channel_add_select",
            ],
            method: "handleChannelSelect",
        },
    ],
    data: new SlashCommandBuilder()
        .setName("paneladmin")
        .setDescription("Panel de administración general (solo admins)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async run(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos para usar este comando.", flags: MessageFlags.Ephemeral });
                return;
            }
            await interaction.reply({ embeds: [buildMainEmbed(client)], components: buildMainRows(), flags: MessageFlags.Ephemeral });
        } catch (err) {
            log.error(`run falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al abrir panel admin.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    async handleButton(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (interaction.customId === "paneladmin_home") {
                await interaction.update({ embeds: [buildMainEmbed(client)], components: buildMainRows() });
                return;
            }

            if (await handleAuditButton(interaction)) return;
            if (await handleSettingsButton(interaction)) return;
            if (await handleLevelsButton(interaction)) return;
            if (await handlePlexButton(interaction)) return;
            if (await handleSeerrButton(interaction)) return;
            if (await handleBankButton(interaction)) return;
            if (await handleApodosButton(interaction)) return;
            if (await handlePerfilesButton(interaction)) return;
            if (await handleApuestasButton(interaction)) return;
            if (await handleCatalogoButton(interaction)) return;
            if (await handleSistemaButton(interaction)) return;
        } catch (err) {
            log.error(`handleButton falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al procesar botón.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    async handleModal(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (await handleLevelsModal(interaction)) return;
            if (await handleSettingsModal(interaction)) return;
            if (await handlePlexModal(interaction)) return;
            if (await handleSeerrModal(interaction)) return;
            if (await handleBankModal(interaction)) return;
            if (await handleApodosModal(interaction)) return;
            if (await handlePerfilesModal(interaction)) return;
            if (await handleCatalogoModal(interaction)) return;
        } catch (err) {
            log.error(`handleModal falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al procesar formulario.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    async handleUserSelect(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (await handleBankUserSelect(interaction)) return;
            if (await handlePlexUserSelect(interaction)) return;
            if (await handleApodosUserSelect(interaction)) return;
            if (await handlePerfilesUserSelect(interaction)) return;
        } catch (err) {
            log.error(`handleUserSelect falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al procesar selector.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    async handleRoleSelect(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }
            await handleLevelsRoleSelect(interaction);
        } catch (err) {
            log.error(`handleRoleSelect falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al procesar roles.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    async handleChannelSelect(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (await handleLevelsChannelSelect(interaction)) return;
            if (await handlePlexChannelSelect(interaction)) return;
            if (await handleSeerrChannelSelect(interaction)) return;
        } catch (err) {
            log.error(`handleChannelSelect falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al procesar canales.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },

    async handleStringSelect(client, interaction) {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (await handlePerfilesStringSelect(interaction)) return;
            if (await handleSistemaSelect(interaction)) return;
            await handleLevelsStringSelect(interaction);
        } catch (err) {
            log.error(`handleStringSelect falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: "Error al procesar selector.", flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
