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
const { handleApuestasButton, handleApuestasChannelSelect, handleApuestasModal } = require("../../adminPanel/apuestas");
const { handleCatalogoButton, handleCatalogoModal } = require("../../adminPanel/catalogo");
const { handleSistemaButton, handleSistemaSelect, handleSistemaModal } = require("../../adminPanel/sistema");
const { handleAuditButton } = require("../../adminPanel/audit");
const {
    handlePlexButton,
    handlePlexUserSelect,
    handlePlexModal,
    handlePlexChannelSelect,
    handlePlexStringSelect,
    handlePlexRoleSelect,
} = require("../../adminPanel/plex");
const { handleSeerrButton, handleSeerrChannelSelect, handleSeerrModal } = require("../../adminPanel/seerr");
const { handleApodosButton, handleApodosUserSelect, handleApodosModal } = require("../../adminPanel/apodos");
const {
    handlePerfilesButton,
    handlePerfilesUserSelect,
    handlePerfilesModal,
    handlePerfilesStringSelect,
} = require("../../adminPanel/perfilesDuende");
const { handleImpuestosButton, handleImpuestosModal } = require("../../adminPanel/impuestos");
const { handleSonidosButton, handleSonidosModal, handleSonidosStringSelect } = require("../../adminPanel/sonidos");
const { handleClasificacionButton, handleClasificacionChannelSelect, handleClasificacionModal } = require("../../adminPanel/clasificacion");

/**
 * Un manejador de componentes del panel. Solo para admins. Si `antes` devuelve true, ya está resuelto. Si no, prueba
 * los pasos en orden y el primero que reconoce la interacción (devuelve true) gana. Un error se avisa en privado.
 */
function manejador(nombre, mensajeError, pasos, antes = null) {
    return async (client, interaction) => {
        try {
            if (!isAdmin(interaction)) {
                await interaction.reply({ content: "No tienes permisos.", flags: MessageFlags.Ephemeral });
                return;
            }
            if (antes && (await antes(client, interaction))) return;
            for (const paso of pasos) {
                if (await paso(interaction)) return;
            }
        } catch (err) {
            log.error(`${nombre} falló (${interaction.customId || "/paneladmin"}):`, err);
            try {
                await interaction.reply({ content: mensajeError, flags: MessageFlags.Ephemeral });
            } catch (e) {
                log.debug(`No se pudo avisar del error: ${e.message}`);
            }
        }
    };
}

module.exports = {
    componentHandlers: [
        { types: ["button"], prefixes: ["paneladmin_"], method: "handleButton" },
        { types: ["modal"], prefixes: ["paneladmin_"], method: "handleModal" },
        {
            types: ["stringSelect"],
            prefixes: [
                "paneladmin_levels_reward_search_pick_",
                "paneladmin_perfiles_",
                "paneladmin_sis_",
                "paneladmin_plex_",
                "paneladmin_sonidos_",
            ],
            method: "handleStringSelect",
        },
        {
            types: ["userSelect"],
            prefixes: ["paneladmin_bank_", "paneladmin_plex_", "paneladmin_apodos_", "paneladmin_perfiles_"],
            method: "handleUserSelect",
        },
        { types: ["roleSelect"], prefixes: ["paneladmin_levels_reward_role_", "paneladmin_plex_gordos_rol_"], method: "handleRoleSelect" },
        {
            types: ["channelSelect"],
            ids: [
                "paneladmin_levels_cfg_channel_select",
                "paneladmin_levels_ignored_add_select",
                "paneladmin_plex_novedades_channel_select",
                "paneladmin_plex_channel_add_select",
                "paneladmin_plex_ranking_canal_select",
                "paneladmin_seerr_channel_add_select",
                "paneladmin_apu_canal_select",
                "paneladmin_semanal_canal_select",
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

    handleButton: manejador(
        "handleButton",
        "Error al procesar botón.",
        [
            handleAuditButton,
            handleSettingsButton,
            handleLevelsButton,
            handlePlexButton,
            handleSeerrButton,
            handleBankButton,
            handleApodosButton,
            handlePerfilesButton,
            handleApuestasButton,
            handleCatalogoButton,
            handleSistemaButton,
            handleImpuestosButton,
            handleClasificacionButton,
            handleSonidosButton,
        ],
        async (client, interaction) => {
            if (interaction.customId !== "paneladmin_home") return false;
            await interaction.update({ embeds: [buildMainEmbed(client)], components: buildMainRows() });
            return true;
        },
    ),

    handleModal: manejador("handleModal", "Error al procesar formulario.", [
        handleLevelsModal,
        handleSettingsModal,
        handlePlexModal,
        handleSonidosModal,
        handleSeerrModal,
        handleBankModal,
        handleApodosModal,
        handlePerfilesModal,
        handleCatalogoModal,
        handleApuestasModal,
        handleSistemaModal,
        handleImpuestosModal,
        handleClasificacionModal,
    ]),

    handleUserSelect: manejador("handleUserSelect", "Error al procesar selector.", [
        handleBankUserSelect,
        handlePlexUserSelect,
        handleApodosUserSelect,
        handlePerfilesUserSelect,
    ]),

    // El último de cada selector no mira si reconoce la interacción: es el de respaldo.
    handleRoleSelect: manejador("handleRoleSelect", "Error al procesar roles.", [handlePlexRoleSelect, handleLevelsRoleSelect]),

    handleChannelSelect: manejador("handleChannelSelect", "Error al procesar canales.", [
        handleLevelsChannelSelect,
        handlePlexChannelSelect,
        handleSeerrChannelSelect,
        handleApuestasChannelSelect,
        handleClasificacionChannelSelect,
    ]),

    handleStringSelect: manejador("handleStringSelect", "Error al procesar selector.", [
        handlePerfilesStringSelect,
        handleSistemaSelect,
        handlePlexStringSelect,
        handleSonidosStringSelect,
        handleLevelsStringSelect,
    ]),
};
