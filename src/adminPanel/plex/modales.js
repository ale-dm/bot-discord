const { MessageFlags } = require("discord.js");
const plexLinks = require("../../systems/plexLinks");
const plexHistorial = require("../../systems/plexHistorial");
const plexTrofeos = require("../../systems/plexTrofeos");
const plexIdiomas = require("../../systems/plexIdiomas");
const achievements = require("../../systems/achievementsSystem");
const tautulliClient = require("../../services/tautulliClient");
const guildSettings = require("../../systems/guildSettings");
const { canalElegido, opcionElegida } = require("../common");
const adminAudit = require("../../systems/adminAudit");
const { log } = require("./vistas");

async function modalImportacion(interaction) {
    const texto = interaction.fields.getTextInputValue("pct").trim().replace(/%$/, "").trim();
    const pct = Number(texto);
    if (!/^\d{1,3}$/.test(texto) || pct > 100) {
        await interaction.reply({ content: "❌ Tiene que ser un número de 0 a 100.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const antes = achievements.porcentajeImportacion(interaction.guildId);
    guildSettings.setSetting(interaction.guildId, "plex.importacion_pct", pct);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "plex.importacion.pct",
        details: { antes, ahora: pct },
    });
    await interaction.reply({
        content:
            `✅ Lo desbloqueado en la primera importación de Plex da ahora el **${pct} %** de las monedas (antes, el ${antes} %). ` +
            "Cuenta al reclamarlo: también para lo que ya está desbloqueado y sin reclamar.",
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function modalTrofeo(interaction) {
    const campo = (k) => {
        try {
            return interaction.fields.getTextInputValue(k) || "";
        } catch {
            return "";
        }
    };
    const r = plexTrofeos.crearAdmin(
        interaction.guildId,
        {
            nombre: campo("nombre"),
            condicion: campo("condicion"),
            recompensa: campo("recompensa"),
            descripcion: campo("descripcion"),
            dificultad: campo("dificultad"),
        },
        interaction.user.id,
    );
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "plex.trofeo.crear",
        details: { id: r.trofeo.id, nombre: r.trofeo.nombre, condicion: r.trofeo.condicion, recompensa: r.trofeo.recompensa },
    });
    await interaction.reply({
        content:
            `✅ Trofeo **${r.trofeo.nombre}** creado (\`${r.trofeo.condicion}\`, 🪙 ${r.trofeo.recompensa.toLocaleString("es")}): ` +
            `${r.trofeo.descripcion} · ${plexIdiomas.textoDificultad(r.trofeo.dificultad)}. Se calcula ya para los vinculados y en cada sincronización.`,
        flags: MessageFlags.Ephemeral,
    });
    // Sin esperar al cron: quien ya lo cumple lo recibe ahora.
    plexHistorial
        .actualizarLogros(interaction.guild || interaction.guildId)
        .catch((e) => log.warn(`No se pudo calcular el trofeo nuevo: ${e.message}`));
    return true;
}

async function modalChannelRemove(interaction) {
    const channelId = canalElegido(interaction.fields, "channel_id");
    if (!channelId) {
        await interaction.reply({ content: "Elige un canal.", flags: MessageFlags.Ephemeral });
        return true;
    }
    tautulliClient.removeAllowedChannel(interaction.guildId, channelId);
    adminAudit.logAdminAction({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: "plex.channels.remove",
        details: { channelId },
    });
    await interaction.reply({ content: "✅ Canal quitado de la lista de Plex.", flags: MessageFlags.Ephemeral });
    return true;
}

// Vincula una cuenta de Plex a una persona de Discord (el modal de 🔗 Vincular).
async function vincularCuentaModal(interaction) {
    const discordUserId = interaction.customId.replace("paneladmin_plex_link_modal_", "");
    const query = (
        opcionElegida(interaction.fields, "plex_username_lista") || interaction.fields.getTextInputValue("plex_username")
    ).trim();
    const guildId = interaction.guildId;

    let users;
    try {
        users = await tautulliClient.getUsers(guildId);
    } catch (e) {
        log.warn(`Vincular Plex: no se pudo consultar Tautulli para buscar "${query}":`, e.message);
        await interaction.reply({ content: `❌ No se pudo consultar Tautulli: ${e.message}`, flags: MessageFlags.Ephemeral });
        return true;
    }

    // Fallback a friendly_name: las cuentas "Managed/Home" de Plex (sin cuenta plex.tv
    // propia) pueden no tener username, o tenerlo distinto al nombre que usa la gente.
    const match = users.find(
        (u) =>
            String(u.username || "").toLowerCase() === query.toLowerCase() ||
            String(u.friendly_name || "").toLowerCase() === query.toLowerCase(),
    );
    if (!match) {
        await interaction.reply({
            content: `❌ No encuentro a "${query}" en Tautulli. Usa el nombre exacto de usuario de Plex.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const nombreVinculo = match.username || match.friendly_name;
    plexLinks.setLink(guildId, discordUserId, match.user_id, nombreVinculo);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "plex.link",
        details: { discordUserId, tautulliUserId: match.user_id, plexUsername: nombreVinculo },
    });
    await interaction.reply({ content: `✅ <@${discordUserId}> vinculado a **${nombreVinculo}**.`, flags: MessageFlags.Ephemeral });
    return true;
}

const ACCIONES_MODAL = new Map([
    ["paneladmin_plex_importacion_modal", modalImportacion],
    ["paneladmin_plex_trofeo_modal", modalTrofeo],
    ["paneladmin_plex_channel_remove_modal", modalChannelRemove],
]);

async function handlePlexModal(interaction) {
    const accion = ACCIONES_MODAL.get(interaction.customId);
    if (accion) return accion(interaction);
    if (!interaction.customId.startsWith("paneladmin_plex_link_modal_")) return false;
    return vincularCuentaModal(interaction);
}

/** 🎰 Roles de Gordos: paneladmin_plex_gordos_rol_{umbral} (sin rol elegido = quitar el de ese umbral). */

module.exports = { handlePlexModal };
