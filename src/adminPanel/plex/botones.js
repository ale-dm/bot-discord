const {
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const plexLinks = require("../../systems/plexLinks");
const plexHistorial = require("../../systems/plexHistorial");
const plexFichas = require("../../systems/plexFichas");
const plexTrofeos = require("../../systems/plexTrofeos");
const plexRankingSemanal = require("../../systems/plexRankingSemanal");
const achievements = require("../../systems/achievementsSystem");
const tautulliClient = require("../../services/tautulliClient");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal } = require("../common");
const { log, buildPlexHome, buildPlexTrofeos, buildRolesGordos, buildDiagnosticoIdiomas, buildRankingSemanal } = require("./vistas");

async function accionHome(interaction, id, guildId) {
    await interaction.update(buildPlexHome(guildId));
    return true;
}

async function accionRanking(interaction, id, guildId) {
    await interaction.reply(buildRankingSemanal(guildId));
    return true;
}

// Publica ya el de la semana pasada (y cuenta como el de esta semana: el lunes no se repite).
async function accionRankingPublicar(interaction, id, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const r = await plexRankingSemanal.publicar(interaction.guild);
        adminAudit.logAdminAction({
            guildId,
            actorId: interaction.user.id,
            action: "plex.ranking.publicar",
            details: { semana: r.semana.lunes, ok: r.ok },
        });
        await interaction.editReply({ content: r.ok ? "✅ Ranking semanal publicado." : `❌ ${r.motivo}` });
    } catch (e) {
        log.warn(`No se pudo publicar el ranking semanal de Plex: ${e.message}`);
        await interaction.editReply({ content: `❌ No se pudo publicar: ${e.message}` });
    }
    return true;
}

async function accionTrofeos(interaction, id, guildId) {
    await interaction.update(buildPlexTrofeos(guildId));
    return true;
}

async function accionImportacion(interaction, id, guildId) {
    await interaction.showModal(
        simpleModal("paneladmin_plex_importacion_modal", "Monedas de la primera importación", [
            {
                id: "pct",
                label: "% de las monedas (0 = nada, 100 = todas)",
                placeholder: "50",
                value: String(achievements.porcentajeImportacion(guildId)),
                maxLength: 3,
            },
        ]),
    );
    return true;
}

async function accionGordos(interaction, id, guildId) {
    await interaction.reply(buildRolesGordos(guildId));
    return true;
}

async function accionIdiomas(interaction, id, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(await buildDiagnosticoIdiomas(guildId));
    return true;
}

async function accionTrofeoCrear(interaction, id, guildId) {
    await interaction.showModal(
        simpleModal("paneladmin_plex_trofeo_modal", "Nuevo trofeo de Plex", [
            { id: "nombre", label: "Nombre", placeholder: "Maratón Nolan", maxLength: 60 },
            { id: "condicion", label: "Condición", placeholder: "director:Christopher Nolan · genero:Terror 20", maxLength: 100 },
            { id: "recompensa", label: "Recompensa (monedas)", placeholder: "1000", maxLength: 7 },
            {
                id: "descripcion",
                label: "Descripción (opcional)",
                placeholder: "Se pone sola según la condición",
                required: false,
                maxLength: 200,
            },
            {
                id: "dificultad",
                label: "Dificultad: fácil, normal o gordo (opcional)",
                placeholder: "normal",
                required: false,
                maxLength: 20,
            },
        ]),
    );
    return true;
}

async function accionTrofeoBorrar(interaction, id, guildId) {
    const { admin } = plexTrofeos.resumen(guildId);
    if (!admin.length) {
        await interaction.reply({ content: "No hay trofeos de admin.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const menu = new StringSelectMenuBuilder()
        .setCustomId("paneladmin_plex_trofeo_borrar_select")
        .setPlaceholder("Qué trofeo borrar")
        .addOptions(
            admin.slice(0, 25).map((t) => ({ label: t.nombre.slice(0, 100), description: String(t.condicion).slice(0, 100), value: t.id })),
        );
    await interaction.reply({
        content: "¿Qué trofeo borro? Se quita a quien lo tenga (lo ya reclamado no se devuelve).",
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function accionAnime(interaction, id, guildId) {
    let libs;
    try {
        libs = (await plexFichas.bibliotecas(guildId)).filter((l) => l.tipo === "movie" || l.tipo === "show");
    } catch (e) {
        await interaction.reply({ content: `❌ No se pudo consultar Tautulli: ${e.message}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    const cfg = plexFichas.configAnime(guildId);
    const opciones = [
        {
            label: "🤖 Automático",
            description: "Las que tienen «anime» en el nombre y el género Anime",
            value: "auto",
            default: cfg.auto,
        },
        ...libs.slice(0, 24).map((l) => ({
            label: l.nombre.slice(0, 100) || l.id,
            description: `${l.tipo === "movie" ? "Películas" : "Series"} · ${l.items.toLocaleString("es")}`,
            value: l.id,
            default: !cfg.auto && cfg.ids.has(l.id),
        })),
    ];
    const menu = new StringSelectMenuBuilder()
        .setCustomId("paneladmin_plex_anime_select")
        .setPlaceholder("Bibliotecas que son anime")
        .setMinValues(1)
        .setMaxValues(opciones.length)
        .addOptions(opciones);
    await interaction.reply({
        content: "¿Qué bibliotecas son de anime (series y películas)? Con 🤖 Automático, las que tienen «anime» en el nombre.",
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

// Copia ya lo nuevo del historial, pide más fichas de las que se piden cada 30 min y recalcula los logros de Plex.
async function accionHistorial(interaction, id, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const {
            historial: r,
            fichas,
            idiomas,
            logros,
        } = await plexHistorial.sincronizarYCalcular(interaction.guild || { id: guildId }, { boton: true });
        const desbloqueados = logros.reduce((s, x) => s + x.desbloqueados.length, 0);
        log.info(`${interaction.user.tag} sincronizó el historial de Plex: ${r.nuevas} nuevas, ${desbloqueados} logros`);
        await interaction.editReply({
            content:
                `📼 Historial sincronizado: **${r.nuevas.toLocaleString("es")}** reproducciones nuevas` +
                `${r.primera ? " (primera importación)" : ""} · **${plexHistorial.estado(guildId).reproducciones.toLocaleString("es")}** guardadas.\n` +
                (fichas
                    ? `📚 Fichas: **${fichas.fichas.toLocaleString("es")}** pedidas ahora · **${fichas.pendientes.toLocaleString("es")}** pendientes.\n`
                    : achievements.categoriaActiva(guildId, "plex")
                      ? "📚 Fichas: no se pudieron pedir (mira el log).\n"
                      : "📚 Fichas: no se piden con los logros de Plex desactivados (Config Global → Logros).\n") +
                (idiomas
                    ? `🗣️ Idiomas: **${idiomas.revisadas.toLocaleString("es")}** reproducciones revisadas ahora · **${idiomas.pendientes.toLocaleString("es")}** pendientes.\n`
                    : "") +
                `🏅 Logros de Plex desbloqueados ahora: **${desbloqueados}** (${logros.length} vinculados).`,
        });
    } catch (e) {
        log.warn(`Error sincronizando el historial de Plex: ${e.message}`);
        await interaction.editReply({ content: `❌ No se pudo sincronizar: ${e.message}` });
    }
    return true;
}

async function accionLink(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("paneladmin_plex_link_select")
            .setPlaceholder("Selecciona el usuario de Discord")
            .setMinValues(1)
            .setMaxValues(1),
    );
    await interaction.reply({ content: "¿A quién quieres vincular con Plex?", components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

async function accionUnlink(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("paneladmin_plex_unlink_select")
            .setPlaceholder("Selecciona el usuario a desvincular")
            .setMinValues(1)
            .setMaxValues(1),
    );
    await interaction.reply({ content: "¿A quién quieres desvincular de Plex?", components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

async function accionTest(interaction, id, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await tautulliClient.testConnection(guildId);
    if (result.ok) {
        await interaction.editReply(`✅ Conexión con Tautulli correcta. ${result.userCount} usuarios visibles.`);
    } else {
        await interaction.editReply(`❌ No se pudo conectar con Tautulli: ${result.error}`);
    }
    return true;
}

async function accionResync(interaction, id, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let users;
    try {
        users = await tautulliClient.getUsers(guildId);
    } catch (e) {
        await interaction.editReply(`❌ No se pudo consultar Tautulli: ${e.message}`);
        return true;
    }
    const { total, actualizados, noEncontrados } = plexLinks.relinkAll(guildId, users);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "plex.relink_all",
        details: { actualizados, noEncontrados },
    });
    const lineas = [`🔄 Revisados ${total} vínculos contra Tautulli (${users.length} usuarios).`];
    lineas.push(actualizados.length ? `✅ Actualizados: ${actualizados.join(", ")}` : "✅ Nada que actualizar, todo seguía correcto.");
    if (noEncontrados.length) lineas.push(`⚠️ No encontrados en Tautulli (revísalos a mano): ${noEncontrados.join(", ")}`);
    await interaction.editReply(lineas.join("\n"));
    return true;
}

async function accionNovedadesChannel(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId("paneladmin_plex_novedades_channel_select")
            .setPlaceholder("Selecciona el canal de novedades")
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
    await interaction.reply({
        content: "¿En qué canal se anuncian las novedades de Plex?",
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function accionNovedadesClear(interaction, id, guildId) {
    guildSettings.setSetting(guildId, "plex.novedades_channel_id", "");
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.novedades.clear" });
    await interaction.reply({ content: "✅ Novedades automáticas desactivadas.", flags: MessageFlags.Ephemeral });
    return true;
}

async function accionChannelAdd(interaction, id, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId("paneladmin_plex_channel_add_select")
            .setPlaceholder("Selecciona un canal donde permitir preguntar por Plex")
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
    await interaction.reply({
        content: "¿En qué canal se puede preguntar por Plex? (en cuanto añadas el primero, el resto de canales dejan de poder)",
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function accionChannelRemove(interaction, id, guildId) {
    await interaction.showModal(
        simpleModal("paneladmin_plex_channel_remove_modal", "Quitar canal permitido", [
            { id: "channel_id", label: "ID del canal", placeholder: "123..." },
        ]),
    );
    return true;
}

async function accionChannelClear(interaction, id, guildId) {
    tautulliClient.clearAllowedChannels(guildId);
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.channels.clear" });
    await interaction.reply({
        content: "✅ Sin restricción: se puede preguntar por Plex en cualquier canal.",
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

const ACCIONES_BOTON = new Map([
    ["paneladmin_plex_home", accionHome],
    ["paneladmin_plex_ranking", accionRanking],
    ["paneladmin_plex_ranking_publicar", accionRankingPublicar],
    ["paneladmin_plex_trofeos", accionTrofeos],
    ["paneladmin_plex_importacion", accionImportacion],
    ["paneladmin_plex_gordos", accionGordos],
    ["paneladmin_plex_idiomas", accionIdiomas],
    ["paneladmin_plex_trofeo_crear", accionTrofeoCrear],
    ["paneladmin_plex_trofeo_borrar", accionTrofeoBorrar],
    ["paneladmin_plex_anime", accionAnime],
    ["paneladmin_plex_historial", accionHistorial],
    ["paneladmin_plex_link", accionLink],
    ["paneladmin_plex_unlink", accionUnlink],
    ["paneladmin_plex_test", accionTest],
    ["paneladmin_plex_resync", accionResync],
    ["paneladmin_plex_novedades_channel", accionNovedadesChannel],
    ["paneladmin_plex_novedades_clear", accionNovedadesClear],
    ["paneladmin_plex_channel_add", accionChannelAdd],
    ["paneladmin_plex_channel_remove", accionChannelRemove],
    ["paneladmin_plex_channel_clear", accionChannelClear],
]);

async function handlePlexButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    const accion = ACCIONES_BOTON.get(id);
    if (accion) return accion(interaction, id, guildId);
    return false;
}

module.exports = { handlePlexButton };
