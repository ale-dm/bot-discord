// Pantallas de /perfil: 👤 Perfil (ficha de nivel, racha, dinero y próxima recompensa), 🏅 Logros (con páginas,
// secretos, filtro y reclamar), 🏆 Rankings (nivel, riqueza, casino, logros, TTCL y Plex en una pantalla),
// 🎭 Recompensas de nivel y 🍿 Plex (horas, idiomas y lo que le falta poco; se entra desde 👤 Perfil). La pestaña
// 💰 Economía está en paneles/economia. Antes eran /nivel y /logros.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const xp = require("../systems/xpSystem");
const achievements = require("../systems/achievementsSystem");
const dinero = require("../systems/dinero");
const plexLinks = require("../systems/plexLinks");
const plexTrofeos = require("../systems/plexTrofeos");
const plexIdiomas = require("../systems/plexIdiomas");
const plexRankings = require("../systems/plexRankings");
const rankingApuestas = require("../systems/apuestas/ranking");
const plexResumen = require("../systems/plexResumen");
const { duracion } = require("../systems/plexRankingSemanal");
const { filaPestanasPerfil } = require("./pestanasPerfil");

const MEDALLAS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

function colorByLevel(level) {
    if (level >= 60) return 0x8e44ad;
    if (level >= 40) return 0x2980b9;
    if (level >= 25) return 0xf1c40f;
    if (level >= 10) return 0x2ecc71;
    return 0x4a90e2;
}

function progressBar(current, needed, size = 14) {
    const ratio = needed > 0 ? Math.max(0, Math.min(1, current / needed)) : 0;
    const filled = Math.round(ratio * size);
    return "█".repeat(filled) + "░".repeat(Math.max(0, size - filled));
}

// `opcionesLogros`: qué logros de Plex cuentan en el resumen (plexTrofeos.opcionesPerfil).
async function buildProfileEmbed(guild, userId, opcionesLogros = {}) {
    const profile = xp.getProfile(guild.id, userId);
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    const username = member?.user?.username || member?.user?.tag || `<@${userId}>`;
    const avatarUrl = member?.user?.displayAvatarURL({ size: 256, extension: "png" }) || null;
    const bannerColor = member?.user?.accentColor || null;

    const vozHoras = (profile.voz_segundos || 0) / 3600;
    const rewards = xp.getRewards(guild.id);
    const nextReward = rewards.find((r) => r.nivel > profile.nivel);
    const summary = achievements.getSummary(guild.id, userId, opcionesLogros);
    const currentTitle = profile.title || { title: "SIN RANGO", emoji: "▫️" };
    const xpPct = profile.xp_need > 0 ? Math.floor((profile.xp / profile.xp_need) * 100) : 0;
    const history = xp.getLevelHistory(guild.id, userId, 4);
    const historyText = history.length
        ? history.map((h) => `LVL ${h.nivel} · <t:${Math.floor(Number(h.createdAt) / 1000)}:R>`).join("\n")
        : "Sin subidas registradas aún";
    const streakText = profile.streak >= 2 ? `🔥 ${profile.streak} días (+${profile.streakBonusPct.toFixed(0)}% XP)` : "Sin racha activa";

    const embed = new EmbedBuilder()
        .setAuthor({ name: username, iconURL: avatarUrl || undefined })
        .setTitle(`${currentTitle.emoji || "▫️"} ${currentTitle.title || "SIN RANGO"} · Nivel ${profile.nivel}`)
        .setDescription(`\`${progressBar(profile.xp, profile.xp_need)}\` **${profile.xp} / ${profile.xp_need} XP** (${xpPct}%)`)
        .addFields(
            { name: "🏆 Ranking", value: `#${profile.rank}`, inline: true },
            { name: "✨ XP total", value: `${profile.xp_total}`, inline: true },
            { name: "🎙️ Voz", value: `${vozHoras.toFixed(1)} h`, inline: true },
            { name: "🏅 Logros", value: `${summary.completed}/${summary.total} (${summary.completionPct}%)`, inline: true },
            { name: "🔥 Racha", value: streakText, inline: true },
            {
                name: "🎯 Próxima recompensa",
                value: nextReward
                    ? `LVL ${nextReward.nivel} · <@&${nextReward.roleId}>${nextReward.descripcion ? ` — ${nextReward.descripcion}` : ""}`
                    : "Sin recompensa siguiente",
                inline: false,
            },
            { name: "🕒 Últimos hitos", value: historyText, inline: false },
        )
        .setColor(bannerColor || colorByLevel(profile.nivel))
        .setTimestamp();

    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return embed;
}

async function buildTopEmbed(guild, page = 0) {
    const pageSize = 10;
    const rows = xp.getTop(guild.id, pageSize, page * pageSize);
    const MEDALS = ["🥇", "🥈", "🥉"];

    const lines = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const pos = page * pageSize + i + 1;
        const medal = pos <= 3 ? MEDALS[pos - 1] : `\`${pos}.\``;
        const member = guild.members.cache.get(r.userId) || (await guild.members.fetch(r.userId).catch(() => null));
        const name = member?.user?.username || r.userId;
        const title = xp.titleForLevel(guild.id, r.nivel);
        const rankStr = title?.title ? ` ${title.emoji || ""} ${title.title}` : "";
        lines.push(`${medal} **${name}** · LVL ${r.nivel}${rankStr} — ${r.xp_total.toLocaleString()} XP`);
    }

    const embed = new EmbedBuilder()
        .setTitle("🏆 Clasificación · " + guild.name)
        .setDescription(lines.length ? lines.join("\n") : "Aún no hay datos de nivel.")
        .setColor(0xf1c40f)
        .setFooter({ text: `Página ${page + 1}` })
        .setTimestamp();

    const iconUrl = guild.iconURL({ size: 128, extension: "png" });
    if (iconUrl) embed.setThumbnail(iconUrl);

    return embed;
}

function buildRewardsEmbed(guild) {
    const guildId = guild.id;
    const rewards = xp.getRewards(guildId);

    const rankLines = [];
    const permLines = [];

    for (const r of rewards) {
        // Los roles con descripción son permisos que se desbloquean; el resto, rangos.
        if (r.descripcion) {
            permLines.push(`${r.emoji || "🔓"} **LVL ${r.nivel}** · <@&${r.roleId}> — ${r.descripcion}`);
        } else {
            rankLines.push(`🎖️ **LVL ${r.nivel}** · <@&${r.roleId}>`);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle("🎭 Recompensas de niveles")
        .setDescription("Al alcanzar cada nivel el bot te otorga los roles automáticamente.")
        .setColor(0x9b59b6)
        .setTimestamp();

    if (rankLines.length) embed.addFields({ name: "🏅 Roles de rango", value: rankLines.join("\n"), inline: false });
    if (permLines.length) embed.addFields({ name: "🔑 Permisos desbloqueables", value: permLines.join("\n"), inline: false });
    if (!rankLines.length && !permLines.length)
        embed.addFields({ name: "Sin recompensas", value: "No hay roles configurados aún.", inline: false });

    return embed;
}

function barraLogro(progress, target) {
    const ratio = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0;
    const filled = Math.round(ratio * 10);
    return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${Math.floor(ratio * 100)}%`;
}

// Filtros de 🏅 Logros: por categoría y, dentro de 🍿 Plex, todos los de Plex, solo los trofeos (los de cada serie,
// saga...) o una dificultad. La clave va en los ids de los botones: sin "_". Los de `plex` van en el menú de dentro de
// 🍿 Plex, con su `opcion` como nombre.
const CATEGORIAS = {
    social: "💬 Social",
    xp: "✨ XP y voz",
    casino: "🎰 Casino",
    cripto: "📈 Cripto",
    tienda: "🛒 Tienda",
    plex: "🍿 Plex",
};
const FILTROS_LOGROS = {
    todos: { label: "🏅 Todos los logros", cumple: () => true },
    ...Object.fromEntries(
        Object.entries(CATEGORIAS).map(([c, label]) => [
            `cat-${c}`,
            {
                label,
                categoria: c,
                cumple: (a) => a.category === c,
                ...(c === "plex" ? { plex: true, opcion: "🍿 Todos los de Plex" } : {}),
            },
        ]),
    ),
    trofeos: { label: "🏆 Solo trofeos de Plex", opcion: "🏆 Solo trofeos", plex: true, cumple: (a) => Boolean(a.trofeo) },
    ...Object.fromEntries(
        Object.keys(plexIdiomas.DIFICULTADES).map((d) => [
            `dif-${d}`,
            {
                label: `🍿 Plex: ${plexIdiomas.textoDificultad(d)}`,
                opcion: plexIdiomas.textoDificultad(d),
                plex: true,
                cumple: (a) => a.dificultad === d,
            },
        ]),
    ),
};

/** El filtro al final de los ids ("_cat-plex"); sin filtro ("todos"), los ids de siempre. */
const sufijoFiltro = (filtro) => (filtro && filtro !== "todos" ? `_${filtro}` : "");

/** Menús del filtro: las categorías que tiene y, con 🍿 Plex elegido, otro con lo de dentro (trofeos y dificultades). */
function menusFiltroLogros(ownerId, targetId, filtro, includeHidden, todos) {
    const categorias = new Set(todos.map((a) => a.category));
    const enPlex = Boolean(FILTROS_LOGROS[filtro].plex);
    const categoria = enPlex ? "cat-plex" : filtro;
    const opciones = Object.entries(FILTROS_LOGROS)
        .filter(([k, f]) => k === categoria || k === "todos" || categorias.has(f.categoria))
        .map(([value, f]) => ({
            label: f.label,
            value,
            default: value === categoria,
            ...(value === "cat-plex" ? { description: "Dentro: los trofeos y cada dificultad" } : {}),
        }));
    const secretos = includeHidden ? 1 : 0;
    const filas = [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`perfil_logrosfiltro_${ownerId}_${targetId}_${secretos}`)
                .setPlaceholder("Qué logros ver")
                .addOptions(opciones),
        ),
    ];
    // El de dentro de 🍿 Plex lleva "_plex" al final: sobra al leer el id, pero sin él los dos serían iguales y Discord
    // rechazaría el mensaje.
    if (enPlex) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`perfil_logrosfiltro_${ownerId}_${targetId}_${secretos}_plex`)
                    .setPlaceholder("Qué logros de Plex ver")
                    .addOptions(
                        Object.entries(FILTROS_LOGROS)
                            .filter(([, f]) => f.plex)
                            .map(([value, f]) => ({ label: f.opcion, value, default: value === filtro })),
                    ),
            ),
        );
    }
    return filas;
}

function buildLogros(guildId, ownerId, targetId, page = 0, includeHidden = false, filtro = "todos") {
    const userId = targetId;
    const propio = ownerId === targetId;
    if (!FILTROS_LOGROS[filtro]) filtro = "todos";
    // Quien oculta sus logros de Plex (lo que ve) no los enseña en su perfil a los demás; a quien no tiene Plex
    // vinculado solo le salen los de Plex que ya tenga.
    const plexOculto = plexTrofeos.oculto(guildId, userId);
    const opciones = plexTrofeos.opcionesPerfil(guildId, userId, propio);
    const todos = achievements.listUserAchievements(guildId, userId, { ...opciones, includeHidden });
    const list = todos.filter(FILTROS_LOGROS[filtro].cumple);
    const summary = achievements.getSummary(guildId, userId, opciones);
    const rarezas = list.some((a) => a.category === "plex") ? plexTrofeos.rarezas(guildId) : new Map();
    const pctImportacion = achievements.porcentajeImportacion(guildId);

    const pageSize = 6;
    const maxPage = Math.max(0, Math.ceil(list.length / pageSize) - 1);
    const safePage = Math.max(0, Math.min(maxPage, Number(page) || 0));
    const start = safePage * pageSize;
    const slice = list.slice(start, start + pageSize);

    const desc = slice.length
        ? slice
              .map((a) => {
                  if (a.hidden && !a.completed && !includeHidden) return "❓ **Logro secreto**";
                  const status = a.completed ? (a.claimable ? "🎁" : "✅") : "⏳";
                  const p = Math.min(a.progress, a.target);
                  const rareza = a.category === "plex" && a.completed ? ` · 🏆 ${plexTrofeos.textoRareza(rarezas.get(a.id))}` : "";
                  const dificultad = a.dificultad ? ` · ${plexIdiomas.textoDificultad(a.dificultad)}` : "";
                  // Desbloqueado con lo antiguo (la primera importación de Plex): da menos monedas.
                  const importado =
                      a.claimable && a.importado && pctImportacion < 100 ? ` · 📼 de la importación (${pctImportacion} %)` : "";
                  return `${status} **${a.name}** (${a.category}${dificultad})\n${a.desc}\n${barraLogro(p, a.target)}${rareza}${importado}\n`;
              })
              .join("\n")
        : filtro === "todos"
          ? "No hay logros en esta vista."
          : "No hay logros con este filtro.";

    const embed = new EmbedBuilder()
        .setTitle(`${propio ? "🏅 Tus logros" : "🏅 Logros"}${filtro === "todos" ? "" : ` · ${FILTROS_LOGROS[filtro].label}`}`)
        .setDescription(desc)
        .addFields(
            { name: "Completados", value: `${summary.completed}/${summary.total} (${summary.completionPct}%)`, inline: true },
            { name: "Pendientes de reclamar", value: String(summary.claimable), inline: true },
            { name: "Página", value: `${safePage + 1}/${maxPage + 1}`, inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();
    // Dentro de 🍿 Plex: de cada dificultad, cuántos tiene de los que hay. Como en Completados, los secretos solo cuentan
    // si los tiene; los trofeos de cada serie, saga... también (no se ven hasta conseguirlos).
    const plexPorDificultad = FILTROS_LOGROS[filtro].plex
        ? todos.filter((a) => a.category === "plex" && a.dificultad && (!a.hidden || a.completed))
        : [];
    if (plexPorDificultad.length) {
        embed.addFields({
            name: "🍿 Plex por dificultad",
            value: Object.keys(plexIdiomas.DIFICULTADES)
                .map((d) => {
                    const deEsta = plexPorDificultad.filter((a) => a.dificultad === d);
                    return `${plexIdiomas.textoDificultad(d)}: **${deEsta.filter((a) => a.completed).length}**/${deEsta.length}`;
                })
                .join(" · "),
            inline: false,
        });
    }

    // perfil_logros_{o}_{t}_{página}_{secretos}[_{filtro}]
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_${safePage - 1}_${includeHidden ? 1 : 0}${sufijoFiltro(filtro)}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_${safePage + 1}_${includeHidden ? 1 : 0}${sufijoFiltro(filtro)}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= maxPage),
        new ButtonBuilder()
            .setCustomId(`perfil_logros_${ownerId}_${targetId}_0_${includeHidden ? 0 : 1}${sufijoFiltro(filtro)}`)
            .setLabel(includeHidden ? "🙈 Ocultar secretos" : "👁️ Ver secretos")
            .setStyle(ButtonStyle.Secondary),
    );
    if (propio && summary.claimable > 0) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`perfil_reclamartodo_${ownerId}_${targetId}${sufijoFiltro(filtro)}`)
                .setLabel("🎁 Reclamar todo")
                .setStyle(ButtonStyle.Success),
        );
    }
    // Solo a quien tiene la cuenta de Plex vinculada: que sus logros de Plex no se anuncien ni los vean los demás.
    if (propio && plexLinks.getLinkByDiscordId(guildId, userId)) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`perfil_plexoculto_${ownerId}_${targetId}_${plexOculto ? 0 : 1}`)
                .setLabel(plexOculto ? "🍿 Enseñar mis logros de Plex" : "🍿 Ocultar mis logros de Plex")
                .setStyle(ButtonStyle.Secondary),
        );
    }

    const components = [row];
    const menu = propio ? menuReclamar(guildId, ownerId, targetId, filtro) : null;
    if (menu) components.push(menu);
    components.push(...menusFiltroLogros(ownerId, targetId, filtro, includeHidden, todos));
    components.push(filaPestanasPerfil(ownerId, targetId, "logros"));
    return { content: "", embeds: [embed], components };
}

function menuReclamar(guildId, ownerId, targetId, filtro = "todos") {
    const userId = targetId;
    const pendientes = achievements.listUserAchievements(guildId, userId, { includeHidden: true }).filter((a) => a.claimable);
    if (!pendientes.length) return null;
    const conImportacion = achievements.porcentajeImportacion(guildId) < 100;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`perfil_reclamar_${ownerId}_${targetId}${sufijoFiltro(filtro)}`)
            .setPlaceholder(`🎁 Reclamar un logro (${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"})`)
            .addOptions(
                pendientes.slice(0, 25).map((a) => ({
                    label: a.name.slice(0, 100),
                    description: `+${achievements.rewardCoinsFor(a, guildId).toLocaleString("es")} 🪙${a.importado && conImportacion ? " (📼 de la importación)" : ""}`,
                    value: a.id,
                    emoji: a.emoji || undefined,
                })),
            ),
    );
}

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

const RANKINGS = {
    nivel: "📈 Nivel",
    riqueza: "💰 Riqueza",
    casino: "🎰 Casino",
    logros: "🏅 Logros",
    ttcl: "💎 TTCL",
    plex: "🍿 Plex",
    apuestas: "⚽ Apostadores",
};

/** ⚽ Apostadores (F-AP-03): beneficio en apuestas, % de acierto en partidos y mejor racha de partidos ganados seguidos. */
function embedRankingApuestas() {
    const signo = (n) => `${n >= 0 ? "+" : ""}${n.toLocaleString("es")}`;
    const lineas = rankingApuestas.ranking().map((c, i) => {
        const acierto =
            c.acierto === null ? "sin partidos" : `${c.acierto.toLocaleString("es", { maximumFractionDigits: 1 })} % de acierto`;
        const racha = c.racha >= 2 ? ` · 🔥 ${c.racha} seguidas` : "";
        return `${MEDALLAS[i] || `**${i + 1}.**`} <@${c.userId}> — **${signo(c.beneficio)}** 🪙 · ${acierto}${racha}`;
    });
    return new EmbedBuilder()
        .setTitle("⚽ Ranking de apostadores")
        .setDescription(lineas.join("\n") || `Nadie tiene todavía ${rankingApuestas.MIN_RESUELTAS} apuestas resueltas.`)
        .setFooter({
            text: `Beneficio de partidos y quinielas resueltos · acierto y racha, de los partidos · mín. ${rankingApuestas.MIN_RESUELTAS} apuestas resueltas`,
        })
        .setColor(0x3498db);
}

/** 🍿 Rankings de Plex: más logros, más 🎰 Gordos, más políglota y más horas (este mes y de siempre). */
function embedRankingPlex(guildId) {
    const embed = new EmbedBuilder().setTitle("🍿 Rankings de Plex").setColor(0xe5a00d);
    const r = plexRankings.rankings(guildId);
    if (!r) return embed.setDescription("Nadie tiene la cuenta de Plex vinculada todavía.");
    const lista = (l, formato) =>
        l.map((x, i) => `${MEDALLAS[i]} <@${x.discordUserId}> — **${formato(x.n)}**`).join("\n") || "Nadie todavía.";
    const numero = (n) => n.toLocaleString("es");
    return embed
        .addFields(
            { name: "🏆 Más logros de Plex", value: lista(r.logros, numero), inline: true },
            { name: "🎰 Más Gordos del Plex", value: lista(r.gordos, numero), inline: true },
            { name: "🗣️ Más políglota", value: lista(r.poliglota, (n) => `${numero(n)} de idioma`), inline: true },
            { name: `⏱️ Más horas en ${r.mes}`, value: lista(r.horasMes, duracion), inline: true },
            { name: "⏱️ Más horas de siempre", value: lista(r.horasSiempre, duracion), inline: true },
        )
        .setFooter({ text: "Solo quien tiene Plex vinculado. Quien oculta sus logros de Plex no sale en los de logros." });
}

/** 🏆 Rankings: uno a la vez, elegido en el menú (el de nivel, con páginas). */
async function buildRankings(guild, ownerId, targetId, tipo = "nivel", page = 0) {
    let embed;
    let paginas = null;
    if (tipo === "riqueza") {
        const { lineasRicos } = require("./economia");
        embed = new EmbedBuilder()
            .setTitle("💰 Los más ricos")
            .setDescription(lineasRicos(10).join("\n") || "No hay datos todavía.")
            .setFooter({ text: "Efectivo + banco" })
            .setColor(0xf1c40f);
    } else if (tipo === "casino") {
        embed = require("./casino").buildRanking().embeds[0];
    } else if (tipo === "logros") {
        const top = achievements.getTopUsers(guild.id, 10);
        embed = new EmbedBuilder()
            .setTitle("🏅 Top logros")
            .setDescription(
                top.map((u, i) => `${i + 1}. <@${u.userId}> — **${u.completed}** completados (${u.claimed} reclamados)`).join("\n") ||
                    "Sin datos todavía.",
            )
            .setColor(0xf39c12);
    } else if (tipo === "ttcl") {
        embed = (await require("./cripto").buildTopHolders(guild.id)).embeds[0];
    } else if (tipo === "plex") {
        embed = embedRankingPlex(guild.id);
    } else if (tipo === "apuestas") {
        embed = embedRankingApuestas();
    } else {
        embed = await buildTopEmbed(guild, page);
        paginas = { anterior: page > 0, siguiente: xp.getTop(guild.id, 10, (page + 1) * 10).length > 0 };
    }
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`perfil_ranksel_${ownerId}_${targetId}`)
        .setPlaceholder("Qué ranking")
        .addOptions(Object.entries(RANKINGS).map(([value, label]) => ({ label, value, default: value === tipo })));
    const components = [new ActionRowBuilder().addComponents(menu)];
    if (paginas) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`perfil_rank_${ownerId}_${targetId}_nivel_${page - 1}`)
                    .setLabel("⏮️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!paginas.anterior),
                new ButtonBuilder()
                    .setCustomId(`perfil_rank_${ownerId}_${targetId}_nivel_${page + 1}`)
                    .setLabel("⏭️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!paginas.siguiente),
            ),
        );
    }
    components.push(filaPestanasPerfil(ownerId, targetId, "rankings"));
    return { content: "", embeds: [embed], components };
}

module.exports = { buildPerfil, buildRecompensas, buildLogros, buildRankings, buildProfileEmbed, buildPlex, RANKINGS, FILTROS_LOGROS };
