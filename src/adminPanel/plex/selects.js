const { MessageFlags } = require("discord.js");
const plexLinks = require("../../systems/plexLinks");
const plexTrofeos = require("../../systems/plexTrofeos");
const plexGordos = require("../../systems/plexGordos");
const tautulliClient = require("../../services/tautulliClient");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal } = require("../common");
const { log, buildRolesGordos, buildRankingSemanal } = require("./vistas");

async function handlePlexChannelSelect(interaction) {
    if (interaction.customId === "paneladmin_plex_ranking_canal_select") {
        const channelId = interaction.values[0];
        guildSettings.setSetting(interaction.guildId, "plex.ranking_canal", channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.ranking.canal",
            details: { channelId },
        });
        // Al editar el mensaje (ya privado) no se vuelve a mandar la marca de privado.
        // eslint-disable-next-line no-unused-vars
        const { flags, ...vista } = buildRankingSemanal(interaction.guildId);
        await interaction.update(vista);
        return true;
    }

    if (interaction.customId === "paneladmin_plex_novedades_channel_select") {
        const channelId = interaction.values[0];
        guildSettings.setSetting(interaction.guildId, "plex.novedades_channel_id", channelId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.novedades.set",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Canal de novedades: <#${channelId}>`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === "paneladmin_plex_channel_add_select") {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        tautulliClient.addAllowedChannel(interaction.guildId, channelId, channel?.name || "");
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.channels.add",
            details: { channelId },
        });
        await interaction.reply({ content: `✅ Plex permitido en <#${channelId}>.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function handlePlexUserSelect(interaction) {
    if (interaction.customId === "paneladmin_plex_link_select") {
        const discordUserId = interaction.values[0];
        await interaction.showModal(
            simpleModal(`paneladmin_plex_link_modal_${discordUserId}`, "Vincular con Plex", [
                { id: "plex_username", label: "Usuario de Tautulli/Plex (exacto)", placeholder: "SrAaleeeo" },
            ]),
        );
        return true;
    }

    if (interaction.customId === "paneladmin_plex_unlink_select") {
        const discordUserId = interaction.values[0];
        plexLinks.removeLink(interaction.guildId, discordUserId);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.unlink",
            details: { discordUserId },
        });
        await interaction.reply({ content: `✅ <@${discordUserId}> desvinculado de Plex.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function handlePlexRoleSelect(interaction) {
    const m = /^paneladmin_plex_gordos_rol_(\d+)$/.exec(interaction.customId);
    if (!m || !plexGordos.UMBRALES.includes(Number(m[1]))) return false;
    const umbral = Number(m[1]);
    const roleId = interaction.values[0] || "";
    guildSettings.setSetting(interaction.guildId, `plex.rol_gordos_${umbral}`, roleId);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "plex.gordos.rol",
        details: { umbral, roleId: roleId || null },
    });
    // Al editar el mensaje (ya privado) no se vuelve a mandar la marca de privado.
    // eslint-disable-next-line no-unused-vars
    const { flags, ...vista } = buildRolesGordos(interaction.guildId);
    await interaction.update(vista);
    // Quien ya llega lo recibe ahora, sin esperar a la siguiente sincronización.
    if (roleId && interaction.guild) {
        plexGordos.repartir(interaction.guild).catch((e) => log.warn(`No se pudieron dar los roles de Gordos del Plex: ${e.message}`));
    }
    return true;
}

async function handlePlexStringSelect(interaction) {
    if (interaction.customId === "paneladmin_plex_trofeo_borrar_select") {
        const id = interaction.values[0];
        const ok = plexTrofeos.borrar(interaction.guildId, id);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.trofeo.borrar",
            details: { id },
        });
        await interaction.update({ content: ok ? "✅ Trofeo borrado." : "Ese trofeo ya no existía.", components: [] });
        return true;
    }

    if (interaction.customId === "paneladmin_plex_anime_select") {
        const valores = interaction.values.filter((v) => v !== "auto");
        const valor = interaction.values.includes("auto") ? "" : valores.join(",");
        guildSettings.setSetting(interaction.guildId, "plex.bibliotecas_anime", valor);
        adminAudit.logAdminAction({
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: "plex.anime.bibliotecas",
            details: { bibliotecas: valor || "auto" },
        });
        await interaction.update({
            content: valor
                ? `✅ Cuentan como anime ${valores.length === 1 ? "esa biblioteca" : `esas ${valores.length} bibliotecas`}. Se nota en la próxima sincronización.`
                : "✅ Anime automático: las bibliotecas con «anime» en el nombre y lo que tenga el género Anime.",
            components: [],
        });
        return true;
    }

    return false;
}

module.exports = { handlePlexChannelSelect, handlePlexUserSelect, handlePlexRoleSelect, handlePlexStringSelect };
