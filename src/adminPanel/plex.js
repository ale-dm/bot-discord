const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    UserSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const plexLinks = require("../systems/plexLinks");
const plexHistorial = require("../systems/plexHistorial");
const plexFichas = require("../systems/plexFichas");
const plexTrofeos = require("../systems/plexTrofeos");
const tautulliClient = require("../services/tautulliClient");
const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { simpleModal } = require("./common");

function navRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
}

function buildPlexHome(guildId) {
    const links = plexLinks.getLinks(guildId);
    const lines = links.length
        ? links.map((l) => `• <@${l.discordUserId}> → **${l.plexUsername || l.tautulliUserId}**`).join("\n")
        : "Nadie vinculado todavía.";

    const { url } = tautulliClient.getConfig(guildId);
    const { novedades_channel_id } = guildSettings.getSettings(guildId).plex;
    const allowedChannels = tautulliClient.getAllowedChannels(guildId);
    const canalesTexto = allowedChannels.length ? allowedChannels.map((c) => `<#${c.channelId}>`).join(", ") : "todos (sin restricción)";
    const historial = plexHistorial.estado(guildId);

    const embed = new EmbedBuilder()
        .setTitle("🎬 Plex / Tautulli")
        .setDescription(
            `Servidor Tautulli: ${url || "no configurado"}\n` +
                `Canal de novedades: ${novedades_channel_id ? `<#${novedades_channel_id}>` : "desactivado"}\n` +
                `Canales donde se puede preguntar por Plex: ${canalesTexto}\n` +
                `📼 Historial para los logros: **${historial.reproducciones.toLocaleString("es")}** reproducciones · ` +
                `${historial.ultimaSync ? `sincronizado <t:${Math.floor(historial.ultimaSync / 1000)}:R>` : "sin sincronizar todavía"} (cada 30 min)\n\n` +
                `**Vinculados (${links.length})**\n${lines}`,
        )
        .setColor(0xe5a00d)
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_link").setLabel("➕ Vincular").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_plex_unlink").setLabel("🗑️ Quitar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_plex_test").setLabel("🔌 Test conexión").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_trofeos").setLabel("🏆 Trofeos").setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_novedades_channel").setLabel("📢 Canal novedades").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("paneladmin_plex_novedades_clear")
            .setLabel("🚫 Desactivar novedades")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_historial").setLabel("📼 Sincronizar historial").setStyle(ButtonStyle.Primary),
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_channel_add").setLabel("📺 Permitir canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_channel_remove").setLabel("➖ Quitar canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_channel_clear").setLabel("🧹 Sin restricción").setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row1, row2, row3, navRow()] };
}

const NOMBRE_TIPO = {
    temporada: "📺 temporadas",
    serie: "📺 series",
    saga: "🎬 sagas",
    director: "🎥 directores",
    genero: "🎭 géneros",
    decada: "📼 décadas",
    admin: "✍️ de admin",
};

/** 🏆 Trofeos de Plex (fases 2 y 3): fichas, qué es anime, trofeos creados y los de admin. */
function buildPlexTrofeos(guildId) {
    const f = plexFichas.estado(guildId);
    const { porTipo, admin } = plexTrofeos.resumen(guildId);
    const anime = plexFichas.configAnime(guildId);
    const nombres = plexFichas.nombresBibliotecas(guildId);
    const animeTexto = anime.auto
        ? "automático (bibliotecas con «anime» en el nombre y lo que tenga el género Anime)"
        : [...anime.ids].map((id) => `**${nombres.get(id) || `biblioteca ${id}`}**`).join(", ");
    const creados = Object.entries(NOMBRE_TIPO)
        .map(([tipo, nombre]) => `${nombre} **${porTipo[tipo] || 0}**`)
        .join(" · ");
    let lista = admin.length
        ? admin
              .map(
                  (t) =>
                      `• **${t.nombre}** — \`${t.condicion}\` · 🪙 ${t.recompensa.toLocaleString("es")} · lo ${t.completados === 1 ? "tiene 1" : `tienen ${t.completados}`}`,
              )
              .join("\n")
        : "Ninguno todavía. Con ➕ Crear trofeo: nombre, condición y recompensa.";
    if (lista.length > 1500) lista = `${lista.slice(0, 1500)}…`;
    const ayuda = Object.values(plexTrofeos.CONDICIONES)
        .filter((c) => c.ayuda)
        .map((c) => `• ${c.ayuda}`)
        .join("\n");

    const embed = new EmbedBuilder()
        .setTitle("🏆 Trofeos de Plex")
        .setDescription(
            `📚 Fichas: **${f.peliculas.toLocaleString("es")}** películas de la biblioteca · **${f.series.toLocaleString("es")}** series vistas · ` +
                `**${f.pendientes.toLocaleString("es")}** pendientes (se piden poco a poco cada 30 min)\n` +
                `Biblioteca repasada: ${f.bibliotecaRevisada ? `<t:${Math.floor(f.bibliotecaRevisada / 1000)}:R>` : "todavía no"} · ` +
                `"Todas las de…" y sagas: ${f.completa ? "✅ activos" : "⏳ cuando estén todas las fichas de películas"}\n` +
                `🎌 Anime: ${animeTexto}\n\n` +
                `**Creados**: ${creados}\n\n` +
                `**Trofeos de admin (${admin.length})**\n${lista}\n\n**Condiciones**\n${ayuda}`,
        )
        .setColor(0xe5a00d)
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_trofeo_crear").setLabel("➕ Crear trofeo").setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("paneladmin_plex_trofeo_borrar")
            .setLabel("🗑️ Borrar trofeo")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!admin.length),
        new ButtonBuilder().setCustomId("paneladmin_plex_anime").setLabel("🎌 Bibliotecas de anime").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_historial").setLabel("📼 Sincronizar ahora").setStyle(ButtonStyle.Primary),
    );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_trofeos").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_plex_home").setLabel("◀ Plex").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row, nav] };
}

async function handlePlexButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_plex_home") {
        await interaction.update(buildPlexHome(guildId));
        return true;
    }

    if (id === "paneladmin_plex_trofeos") {
        await interaction.update(buildPlexTrofeos(guildId));
        return true;
    }

    if (id === "paneladmin_plex_trofeo_crear") {
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
            ]),
        );
        return true;
    }

    if (id === "paneladmin_plex_trofeo_borrar") {
        const { admin } = plexTrofeos.resumen(guildId);
        if (!admin.length) {
            await interaction.reply({ content: "No hay trofeos de admin.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId("paneladmin_plex_trofeo_borrar_select")
            .setPlaceholder("Qué trofeo borrar")
            .addOptions(
                admin
                    .slice(0, 25)
                    .map((t) => ({ label: t.nombre.slice(0, 100), description: String(t.condicion).slice(0, 100), value: t.id })),
            );
        await interaction.reply({
            content: "¿Qué trofeo borro? Se quita a quien lo tenga (lo ya reclamado no se devuelve).",
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (id === "paneladmin_plex_anime") {
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
    if (id === "paneladmin_plex_historial") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const {
                historial: r,
                fichas,
                logros,
            } = await plexHistorial.sincronizarYCalcular(interaction.guild || { id: guildId }, {
                presupuesto: plexFichas.PRESUPUESTO.boton,
            });
            const desbloqueados = logros.reduce((s, x) => s + x.desbloqueados.length, 0);
            log.info(`${interaction.user.tag} sincronizó el historial de Plex: ${r.nuevas} nuevas, ${desbloqueados} logros`);
            await interaction.editReply({
                content:
                    `📼 Historial sincronizado: **${r.nuevas.toLocaleString("es")}** reproducciones nuevas` +
                    `${r.primera ? " (primera importación)" : ""} · **${plexHistorial.estado(guildId).reproducciones.toLocaleString("es")}** guardadas.\n` +
                    (fichas
                        ? `📚 Fichas: **${fichas.fichas.toLocaleString("es")}** pedidas ahora · **${fichas.pendientes.toLocaleString("es")}** pendientes.\n`
                        : "📚 Fichas: no se pudieron pedir (mira el log).\n") +
                    `🏅 Logros de Plex desbloqueados ahora: **${desbloqueados}** (${logros.length} vinculados).`,
            });
        } catch (e) {
            log.warn(`Error sincronizando el historial de Plex: ${e.message}`);
            await interaction.editReply({ content: `❌ No se pudo sincronizar: ${e.message}` });
        }
        return true;
    }

    if (id === "paneladmin_plex_link") {
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

    if (id === "paneladmin_plex_unlink") {
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

    if (id === "paneladmin_plex_test") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await tautulliClient.testConnection(guildId);
        if (result.ok) {
            await interaction.editReply(`✅ Conexión con Tautulli correcta. ${result.userCount} usuarios visibles.`);
        } else {
            await interaction.editReply(`❌ No se pudo conectar con Tautulli: ${result.error}`);
        }
        return true;
    }

    if (id === "paneladmin_plex_novedades_channel") {
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

    if (id === "paneladmin_plex_novedades_clear") {
        guildSettings.setSetting(guildId, "plex.novedades_channel_id", "");
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.novedades.clear" });
        await interaction.reply({ content: "✅ Novedades automáticas desactivadas.", flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_plex_channel_add") {
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

    if (id === "paneladmin_plex_channel_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_plex_channel_remove_modal", "Quitar canal permitido", [
                { id: "channel_id", label: "ID del canal", placeholder: "123..." },
            ]),
        );
        return true;
    }

    if (id === "paneladmin_plex_channel_clear") {
        tautulliClient.clearAllowedChannels(guildId);
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.channels.clear" });
        await interaction.reply({
            content: "✅ Sin restricción: se puede preguntar por Plex en cualquier canal.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    return false;
}

async function handlePlexChannelSelect(interaction) {
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

async function handlePlexModal(interaction) {
    if (interaction.customId === "paneladmin_plex_trofeo_modal") {
        const campo = (k) => {
            try {
                return interaction.fields.getTextInputValue(k) || "";
            } catch {
                return "";
            }
        };
        const r = plexTrofeos.crearAdmin(
            interaction.guildId,
            { nombre: campo("nombre"), condicion: campo("condicion"), recompensa: campo("recompensa"), descripcion: campo("descripcion") },
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
                `${r.trofeo.descripcion}. Se calcula ya para los vinculados y en cada sincronización.`,
            flags: MessageFlags.Ephemeral,
        });
        // Sin esperar al cron: quien ya lo cumple lo recibe ahora.
        plexHistorial
            .actualizarLogros(interaction.guild || interaction.guildId)
            .catch((e) => log.warn(`No se pudo calcular el trofeo nuevo: ${e.message}`));
        return true;
    }

    if (interaction.customId === "paneladmin_plex_channel_remove_modal") {
        const channelId = interaction.fields.getTextInputValue("channel_id").trim();
        if (!/^\d{17,19}$/.test(channelId)) {
            await interaction.reply({ content: "ID de canal inválido.", flags: MessageFlags.Ephemeral });
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

    if (!interaction.customId.startsWith("paneladmin_plex_link_modal_")) return false;

    const discordUserId = interaction.customId.replace("paneladmin_plex_link_modal_", "");
    const query = interaction.fields.getTextInputValue("plex_username").trim();
    const guildId = interaction.guildId;

    let users;
    try {
        users = await tautulliClient.getUsers(guildId);
    } catch (e) {
        log.warn(`Vincular Plex: no se pudo consultar Tautulli para buscar "${query}":`, e.message);
        await interaction.reply({ content: `❌ No se pudo consultar Tautulli: ${e.message}`, flags: MessageFlags.Ephemeral });
        return true;
    }

    const match = users.find((u) => String(u.username || "").toLowerCase() === query.toLowerCase());
    if (!match) {
        await interaction.reply({
            content: `❌ No encuentro a "${query}" en Tautulli. Usa el nombre exacto de usuario de Plex.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    plexLinks.setLink(guildId, discordUserId, match.user_id, match.username);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "plex.link",
        details: { discordUserId, tautulliUserId: match.user_id, plexUsername: match.username },
    });
    await interaction.reply({ content: `✅ <@${discordUserId}> vinculado a **${match.username}**.`, flags: MessageFlags.Ephemeral });
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

module.exports = {
    buildPlexHome,
    buildPlexTrofeos,
    handlePlexButton,
    handlePlexUserSelect,
    handlePlexModal,
    handlePlexChannelSelect,
    handlePlexStringSelect,
};
