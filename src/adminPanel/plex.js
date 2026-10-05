const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    UserSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const plexLinks = require("../systems/plexLinks");
const plexHistorial = require("../systems/plexHistorial");
const plexFichas = require("../systems/plexFichas");
const plexTrofeos = require("../systems/plexTrofeos");
const plexIdiomas = require("../systems/plexIdiomas");
const plexRankingSemanal = require("../systems/plexRankingSemanal");
const plexImportacion = require("../systems/plexImportacion");
const plexGordos = require("../systems/plexGordos");
const plexDiagnostico = require("../systems/plexDiagnostico");
const achievements = require("../systems/achievementsSystem");
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
    const { novedades_channel_id, ranking_canal } = guildSettings.getSettings(guildId).plex;
    const allowedChannels = tautulliClient.getAllowedChannels(guildId);
    const canalesTexto = allowedChannels.length ? allowedChannels.map((c) => `<#${c.channelId}>`).join(", ") : "todos (sin restricción)";
    const historial = plexHistorial.estado(guildId);

    const embed = new EmbedBuilder()
        .setTitle("🎬 Plex / Tautulli")
        .setDescription(
            `Servidor Tautulli: ${url || "no configurado"}\n` +
                `Canal de novedades: ${novedades_channel_id ? `<#${novedades_channel_id}>` : "desactivado"}\n` +
                `📣 Ranking semanal: ${ranking_canal ? `<#${ranking_canal}> (los lunes a las ${plexRankingSemanal.HORA}:00)` : "sin canal"}\n` +
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
        new ButtonBuilder().setCustomId("paneladmin_plex_ranking").setLabel("📣 Ranking semanal").setStyle(ButtonStyle.Secondary),
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
    idioma: "🗣️ por idioma",
    admin: "✍️ de admin",
};

/** "1 → @rol · 5 → sin rol · 10 → sin rol": los roles de 🎰 Gordos del Plex. */
function textoRolesGordos(guildId) {
    const roles = new Map(plexGordos.roles(guildId).map((r) => [r.umbral, r.roleId]));
    return plexGordos.UMBRALES.map((u) => `${u} → ${roles.has(u) ? `<@&${roles.get(u)}>` : "sin rol"}`).join(" · ");
}

/** 🏆 Trofeos de Plex: fichas e idiomas, qué es anime, la importación, los roles de Gordos, trofeos creados (por tipo y
 * dificultad) y los de admin. */
function buildPlexTrofeos(guildId) {
    const f = plexFichas.estado(guildId);
    const idiomas = plexIdiomas.estado(guildId);
    const { porTipo, porDificultad, admin } = plexTrofeos.resumen(guildId);
    const anime = plexFichas.configAnime(guildId);
    const nombres = plexFichas.nombresBibliotecas(guildId);
    const animeTexto = anime.auto
        ? "automático (bibliotecas con «anime» en el nombre y lo que tenga el género Anime)"
        : [...anime.ids].map((id) => `**${nombres.get(id) || `biblioteca ${id}`}**`).join(", ");
    const creados = Object.entries(NOMBRE_TIPO)
        .map(([tipo, nombre]) => `${nombre} **${porTipo[tipo] || 0}**`)
        .join(" · ");
    const dificultades = Object.keys(plexIdiomas.DIFICULTADES)
        .map((d) => `${plexIdiomas.textoDificultad(d)} **${porDificultad[d]}**`)
        .join(" · ");
    let lista = admin.length
        ? admin
              .map(
                  (t) =>
                      `• ${plexIdiomas.DIFICULTADES[t.dificultad].emoji} **${t.nombre}** — \`${t.condicion}\` · 🪙 ${t.recompensa.toLocaleString("es")} · lo ${t.completados === 1 ? "tiene 1" : `tienen ${t.completados}`}`,
              )
              .join("\n")
        : "Ninguno todavía. Con ➕ Crear trofeo: nombre, condición, recompensa y dificultad.";
    if (lista.length > 1500) lista = `${lista.slice(0, 1500)}…`;
    const ayuda = [...Object.values(plexTrofeos.CONDICIONES).filter((c) => c.ayuda), { ayuda: plexTrofeos.AYUDA_FECHAS }]
        .map((c) => `• ${c.ayuda}`)
        .join("\n");
    const importando = plexImportacion.cuantosImportando(guildId);

    const embed = new EmbedBuilder()
        .setTitle("🏆 Trofeos de Plex")
        .setDescription(
            `📚 Fichas: **${f.peliculas.toLocaleString("es")}** películas de la biblioteca · **${f.series.toLocaleString("es")}** series vistas · ` +
                `**${f.pendientes.toLocaleString("es")}** pendientes (se piden poco a poco cada 30 min)\n` +
                `Biblioteca repasada: ${f.bibliotecaRevisada ? `<t:${Math.floor(f.bibliotecaRevisada / 1000)}:R>` : "todavía no"} · ` +
                `"Todas las de…" y sagas: ${f.completa ? "✅ activos" : "⏳ cuando estén todas las fichas de películas"}\n` +
                `🗣️ Idiomas: **${idiomas.revisadas.toLocaleString("es")}** reproducciones revisadas · ` +
                `**${idiomas.pendientes.toLocaleString("es")}** pendientes\n` +
                `🎌 Anime: ${animeTexto}\n` +
                `📼 Importación: lo que se desbloquea con lo antiguo da el **${achievements.porcentajeImportacion(guildId)} %** de las ` +
                `monedas · ${importando === 1 ? "**1** vinculado importando" : `**${importando}** vinculados importando`} ahora\n` +
                `🎰 Roles de Gordos del Plex: ${textoRolesGordos(guildId)}\n\n` +
                `**Creados**: ${creados}\n**Por dificultad**: ${dificultades}\n\n` +
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
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_importacion").setLabel("🪙 % de la importación").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_gordos").setLabel("🎰 Roles de Gordos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_idiomas").setLabel("🔍 Idiomas").setStyle(ButtonStyle.Secondary),
    );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_trofeos").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_plex_home").setLabel("◀ Plex").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row, row2, nav] };
}

/** 🎰 Roles de Gordos del Plex: un menú de roles por umbral (vacío = sin rol). */
function buildRolesGordos(guildId) {
    const roles = new Map(plexGordos.roles(guildId).map((r) => [r.umbral, r.roleId]));
    return {
        content:
            `🎰 Roles por 🎰 Gordos del Plex (logros de Plex de la dificultad más alta): ${textoRolesGordos(guildId)}.\n` +
            "Se dan en cada sincronización (cada 30 min) a quien llega, y no se quitan. Para quitar el rol de un umbral, deja su menú vacío.",
        components: plexGordos.UMBRALES.map((u) => {
            const menu = new RoleSelectMenuBuilder()
                .setCustomId(`paneladmin_plex_gordos_rol_${u}`)
                .setPlaceholder(`Rol al llegar a ${u} 🎰`)
                .setMinValues(0)
                .setMaxValues(1);
            if (roles.has(u)) menu.setDefaultRoles(roles.get(u));
            return new ActionRowBuilder().addComponents(menu);
        }),
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
    };
}

/** 🔍 Idiomas: lo que se ha detectado de cada audio y subtítulo, y los nombres que no se reconocen (pregunta a Tautulli
 * por unas cuantas). Para ajustar plexIdiomas.codigoIdioma si hiciera falta. */
async function buildDiagnosticoIdiomas(guildId) {
    const g = plexDiagnostico.idiomasGuardados(guildId);
    const total = Object.values(g.audio).reduce((s, n) => s + n, 0);
    const pct = (n) => (total ? `${Math.round((n / total) * 100)} %` : "—");
    const AUDIO = { es: "🇪🇸 castellano", lat: "🌎 latino", en: "🇬🇧 inglés", ja: "🇯🇵 japonés", otro: "❓ otro" };
    const SUBS = { no: "sin subtítulos", es: "en castellano", en: "en inglés", otro: "❓ otro" };
    const lineas = (mapa, nombres) =>
        Object.entries(mapa)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${nombres[k] || k}: **${n.toLocaleString("es")}** (${pct(n)})`)
            .join("\n") || "Nada todavía.";
    let raros;
    try {
        const r = await plexDiagnostico.noReconocidos(guildId);
        const nombres = [
            ...[...r.audio].map(([k, n]) => `audio "${k}" (${n})`),
            ...[...r.subs].map(([k, n]) => `subtítulos "${k}" (${n})`),
        ];
        raros = r.revisadas
            ? nombres.join("\n") || "Todos reconocidos."
            : r.errores
              ? "No se pudo preguntar a Tautulli."
              : 'Ninguna reproducción con un idioma "otro".';
    } catch (e) {
        raros = `No se pudo preguntar a Tautulli: ${e.message}`;
    }
    const embed = new EmbedBuilder()
        .setTitle("🔍 Idiomas detectados en Plex")
        .setDescription(
            `De lo visto por los vinculados: **${g.revisadas.toLocaleString("es")}** revisadas · **${g.pendientes.toLocaleString("es")}** ` +
                `pendientes · **${g.sinDato.toLocaleString("es")}** sin dato (Tautulli no lo tiene: normal en lo muy antiguo).`,
        )
        .addFields(
            { name: "🔊 Audio", value: lineas(g.audio, AUDIO), inline: true },
            { name: "💬 Subtítulos", value: lineas(g.subs, SUBS), inline: true },
            { name: "❓ Nombres que no se reconocen (últimas 15)", value: raros.slice(0, 1024), inline: false },
        )
        .setFooter({ text: "Si sale algo raro: plexIdiomas.codigoIdioma. El latino no cuenta como castellano." })
        .setColor(0xe5a00d);
    return { embeds: [embed] };
}

/** 📣 Ranking semanal: el canal, cómo queda el de la semana pasada (sin avisar a nadie), cambiar el canal y publicarlo ya. */
function buildRankingSemanal(guildId) {
    const semana = plexRankingSemanal.semanaAnterior();
    const { ranking_canal } = guildSettings.getSettings(guildId).plex;
    const vista = plexRankingSemanal.mensaje(plexRankingSemanal.ranking(guildId, semana), semana).content;
    return {
        content:
            `📣 El ranking de Plex se publica cada lunes a las ${plexRankingSemanal.HORA}:00 en ` +
            `${ranking_canal ? `<#${ranking_canal}>` : "**ningún canal** (elige uno abajo)"}. Así queda el de la semana pasada:\n\n${vista}`,
        components: [
            new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId("paneladmin_plex_ranking_canal_select")
                    .setPlaceholder("Canal del ranking semanal")
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("paneladmin_plex_ranking_publicar")
                    .setLabel("📣 Publicar ahora en el canal")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!ranking_canal),
            ),
        ],
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
    };
}

async function handlePlexButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_plex_home") {
        await interaction.update(buildPlexHome(guildId));
        return true;
    }

    if (id === "paneladmin_plex_ranking") {
        await interaction.reply(buildRankingSemanal(guildId));
        return true;
    }

    // Publica ya el de la semana pasada (y cuenta como el de esta semana: el lunes no se repite).
    if (id === "paneladmin_plex_ranking_publicar") {
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

    if (id === "paneladmin_plex_trofeos") {
        await interaction.update(buildPlexTrofeos(guildId));
        return true;
    }

    if (id === "paneladmin_plex_importacion") {
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

    if (id === "paneladmin_plex_gordos") {
        await interaction.reply(buildRolesGordos(guildId));
        return true;
    }

    if (id === "paneladmin_plex_idiomas") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply(await buildDiagnosticoIdiomas(guildId));
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

async function handlePlexModal(interaction) {
    if (interaction.customId === "paneladmin_plex_importacion_modal") {
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

/** 🎰 Roles de Gordos: paneladmin_plex_gordos_rol_{umbral} (sin rol elegido = quitar el de ese umbral). */
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

module.exports = {
    buildPlexHome,
    buildPlexTrofeos,
    buildRolesGordos,
    buildDiagnosticoIdiomas,
    handlePlexButton,
    handlePlexUserSelect,
    handlePlexModal,
    handlePlexChannelSelect,
    handlePlexStringSelect,
    handlePlexRoleSelect,
};
