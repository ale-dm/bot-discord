const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const plexLinks = require("../../systems/plexLinks");
const plexHistorial = require("../../systems/plexHistorial");
const plexFichas = require("../../systems/plexFichas");
const plexTrofeos = require("../../systems/plexTrofeos");
const plexIdiomas = require("../../systems/plexIdiomas");
const plexRankingSemanal = require("../../systems/plexRankingSemanal");
const plexImportacion = require("../../systems/plexImportacion");
const plexGordos = require("../../systems/plexGordos");
const plexDiagnostico = require("../../systems/plexDiagnostico");
const achievements = require("../../systems/achievementsSystem");
const tautulliClient = require("../../services/tautulliClient");
const { createLogger } = require("../../core/logger");
const guildSettings = require("../../systems/guildSettings");

const log = createLogger("PanelAdmin");

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
        new ButtonBuilder().setCustomId("paneladmin_plex_resync").setLabel("🔄 Resincronizar IDs").setStyle(ButtonStyle.Secondary),
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

function textoAnime(guildId) {
    const anime = plexFichas.configAnime(guildId);
    const nombres = plexFichas.nombresBibliotecas(guildId);
    if (anime.auto) return "automático (bibliotecas con «anime» en el nombre y lo que tenga el género Anime)";
    return [...anime.ids].map((id) => `**${nombres.get(id) || `biblioteca ${id}`}**`).join(", ");
}

function textoTrofeosAdmin(admin) {
    const lista = admin.length
        ? admin
              .map(
                  (t) =>
                      `• ${plexIdiomas.DIFICULTADES[t.dificultad].emoji} **${t.nombre}** — \`${t.condicion}\` · 🪙 ${t.recompensa.toLocaleString("es")} · lo ${t.completados === 1 ? "tiene 1" : `tienen ${t.completados}`}`,
              )
              .join("\n")
        : "Ninguno todavía. Con ➕ Crear trofeo: nombre, condición, recompensa y dificultad.";
    return lista.length > 1500 ? `${lista.slice(0, 1500)}…` : lista;
}

function filaTrofeosAdmin(admin) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_plex_trofeo_crear").setLabel("➕ Crear trofeo").setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("paneladmin_plex_trofeo_borrar")
            .setLabel("🗑️ Borrar trofeo")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!admin.length),
        new ButtonBuilder().setCustomId("paneladmin_plex_anime").setLabel("🎌 Bibliotecas de anime").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_plex_historial").setLabel("📼 Sincronizar ahora").setStyle(ButtonStyle.Primary),
    );
}

function buildPlexTrofeos(guildId) {
    const f = plexFichas.estado(guildId);
    const idiomas = plexIdiomas.estado(guildId);
    const { porTipo, porDificultad, admin } = plexTrofeos.resumen(guildId);
    const creados = Object.entries(NOMBRE_TIPO)
        .map(([tipo, nombre]) => `${nombre} **${porTipo[tipo] || 0}**`)
        .join(" · ");
    const dificultades = Object.keys(plexIdiomas.DIFICULTADES)
        .map((d) => `${plexIdiomas.textoDificultad(d)} **${porDificultad[d]}**`)
        .join(" · ");
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
                `🎌 Anime: ${textoAnime(guildId)}\n` +
                `📼 Importación: lo que se desbloquea con lo antiguo da el **${achievements.porcentajeImportacion(guildId)} %** de las ` +
                `monedas · ${importando === 1 ? "**1** vinculado importando" : `**${importando}** vinculados importando`} ahora\n` +
                `🎰 Roles de Gordos del Plex: ${textoRolesGordos(guildId)}\n\n` +
                `**Creados**: ${creados}\n**Por dificultad**: ${dificultades}\n\n` +
                `**Trofeos de admin (${admin.length})**\n${textoTrofeosAdmin(admin)}\n\n**Condiciones**\n${ayuda}`,
        )
        .setColor(0xe5a00d)
        .setTimestamp();
    const row = filaTrofeosAdmin(admin);
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

module.exports = {
    log,
    navRow,
    buildPlexHome,

    buildPlexTrofeos,
    buildRolesGordos,
    buildDiagnosticoIdiomas,
    buildRankingSemanal,
};
