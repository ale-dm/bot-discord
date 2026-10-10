// Pestañas 👤 Perfil, 🍿 Plex y 🎭 Recompensas: lo que se ve de cada persona (ficha, idiomas, lo que le falta poco).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const dinero = require("../../systems/dinero");
const plexLinks = require("../../systems/plexLinks");
const plexTrofeos = require("../../systems/plexTrofeos");
const plexIdiomas = require("../../systems/plexIdiomas");
const plexResumen = require("../../systems/plexResumen");
const { filaPestanasPerfil } = require("../pestanasPerfil");
const { buildProfileEmbed, buildRewardsEmbed } = require("./embeds");

/** 👤 Perfil: la ficha de nivel con el dinero, y los botones de las recompensas de nivel y de 🍿 Plex. */
async function buildPerfil(guild, ownerId, targetId) {
    const propio = ownerId === targetId;
    const embed = await buildProfileEmbed(guild, targetId, plexTrofeos.opcionesPerfil(guild.id, targetId, propio));
    const c = dinero.cuenta(targetId);
    embed.addFields({
        name: "💰 Dinero",
        value: `💵 ${c.efectivo.toLocaleString("es")} · 🏦 ${c.banco.toLocaleString("es")}`,
        inline: true,
    });
    const extra = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`perfil_recompensas_${ownerId}_${targetId}`)
            .setLabel("🎭 Recompensas de nivel")
            .setStyle(ButtonStyle.Secondary),
    );
    // 🍿 Plex: a quien tiene la cuenta vinculada (y, en el perfil de otro, si no la ha ocultado).
    if (plexLinks.getLinkByDiscordId(guild.id, targetId) && (propio || !plexTrofeos.oculto(guild.id, targetId))) {
        extra.addComponents(
            new ButtonBuilder().setCustomId(`perfil_plex_${ownerId}_${targetId}`).setLabel("🍿 Plex").setStyle(ButtonStyle.Secondary),
        );
    }
    return { content: "", embeds: [embed], components: [extra, filaPestanasPerfil(ownerId, targetId, "perfil")] };
}

/** "🇬🇧 Inglés **55 %** (📝 VOSE 40 % · 🎧 sin subtítulos 10 %)": una línea por idioma del audio. */
function lineasIdiomas({ total, pendientes, lista }) {
    const SUBS = { es: "subtítulos en castellano", en: "subtítulos en inglés", no: "sin subtítulos" };
    const lineas = lista.map((x) => {
        let detalle = "";
        if (x.audio === "en") {
            const partes = [];
            if (x.subs.es) partes.push(`📝 VOSE ${x.subs.es} %`);
            if (x.subs.no) partes.push(`🎧 sin subtítulos ${x.subs.no} %`);
            detalle = partes.length ? ` (${partes.join(" · ")})` : "";
        } else if (x.audio === "ja") {
            const partes = ["es", "en", "no"].filter((s) => x.subs[s]).map((s) => `${SUBS[s]} ${x.subs[s]} %`);
            detalle = partes.length ? ` (${partes.join(" · ")})` : "";
        }
        return `${x.emoji} ${x.nombre} **${x.pct} %**${detalle}`;
    });
    if (!total) lineas.push("Todavía sin datos de idioma.");
    if (pendientes) lineas.push(`⏳ ${pendientes.toLocaleString("es")} reproducciones por revisar (se revisan poco a poco)`);
    return lineas.join("\n");
}

/** "Lo que te falta poco": series a medias y logros de Plex casi conseguidos. */
function lineasCasi(r) {
    const lineas = r.aMedias.map((s) => {
        const modo = s.modo ? plexIdiomas.MODOS[s.modo] : null;
        const version = modo ? ` ${modo.emoji} ${modo.texto}` : "";
        return `${s.anime ? "🎌" : "📺"} ${plexResumen.textoFalta(s.faltan, ["episodio", "episodios"])} para terminar *${s.titulo}*${version} (${s.vistos}/${s.total})`;
    });
    for (const a of r.casi) {
        const progreso = Math.floor(a.progreso);
        lineas.push(
            `${a.emoji || "🏅"} ${plexResumen.textoFalta(a.objetivo - progreso, a.unidad)} para **${a.nombre}** (${progreso}/${a.objetivo})`,
        );
    }
    return lineas.length ? lineas.join("\n") : "Nada a medias ahora mismo.";
}

const recortar = (texto) => (texto.length > 1024 ? `${texto.slice(0, 1021)}…` : texto);

/** 🍿 Plex: horas, series terminadas, idiomas, 🎰 Gordos y lo que le falta poco. Se entra desde 👤 Perfil. */
function buildPlex(guild, ownerId, targetId) {
    const propio = ownerId === targetId;
    const embed = new EmbedBuilder()
        .setTitle(propio ? "🍿 Tu Plex" : "🍿 Plex")
        .setColor(0xe5a00d)
        .setTimestamp();
    const filas = [];
    const r = !propio && plexTrofeos.oculto(guild.id, targetId) ? "oculto" : plexResumen.resumen(guild.id, targetId);
    if (r === "oculto") {
        embed.setDescription(`<@${targetId}> ha ocultado sus logros de Plex. 🙈`);
    } else if (!r) {
        embed.setDescription(
            `${propio ? "No tienes" : `<@${targetId}> no tiene`} la cuenta de Plex vinculada. La vincula un admin en /paneladmin → Plex.`,
        );
    } else {
        const s = r.stats;
        const rol = r.siguienteRol ? ` · el rol <@&${r.siguienteRol.roleId}> a los ${r.siguienteRol.umbral}` : "";
        embed.setDescription(`<@${targetId}> · cuenta de Plex **${r.plexUsername || "?"}**`).addFields(
            {
                name: "⏱️ Visto",
                value: `**${s.horas.toLocaleString("es")} h** · ${s.peliculas.toLocaleString("es")} películas · ${s.episodios.toLocaleString("es")} episodios de ${s.series.toLocaleString("es")} series`,
                inline: false,
            },
            {
                name: "📺 Series terminadas",
                value: `**${r.terminadas}**${r.animeTerminadas ? ` (🎌 ${r.animeTerminadas} de anime)` : ""}`,
                inline: true,
            },
            { name: "🏅 Logros de Plex", value: `**${r.logros.completados}**/${r.logros.total}`, inline: true },
            { name: "🎰 Gordos del Plex", value: `**${r.gordos}**${rol}`, inline: true },
            {
                name: "🔥 Récords",
                value: `${s.maratonHoras} h en un día · ${s.atracon} episodios de una serie en un día · ${s.noches} noches de madrugada`,
                inline: false,
            },
            { name: "🗣️ Idiomas", value: recortar(lineasIdiomas(r.idiomas)), inline: false },
            { name: "🎯 Te falta poco", value: recortar(lineasCasi(r)), inline: false },
        );
        filas.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`perfil_logros_${ownerId}_${targetId}_0_0_cat-plex`)
                    .setLabel("🏅 Logros de Plex")
                    .setStyle(ButtonStyle.Secondary),
            ),
        );
    }
    filas.push(filaPestanasPerfil(ownerId, targetId, "perfil"));
    return { content: "", embeds: [embed], components: filas };
}

function buildRecompensas(guild, ownerId, targetId) {
    return { content: "", embeds: [buildRewardsEmbed(guild)], components: [filaPestanasPerfil(ownerId, targetId, "perfil")] };
}

module.exports = { buildPerfil, lineasIdiomas, lineasCasi, recortar, buildPlex, buildRecompensas };
