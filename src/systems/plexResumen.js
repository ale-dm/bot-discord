// 🍿 Lo de Plex de cada uno, para la pantalla 🍿 Plex de /perfil (F-PX-09): horas, películas, episodios y series
// terminadas, en qué idiomas lo ve ("60 % en VOSE"), y lo que le falta poco: series a medias ("3 episodios para
// terminar Dark en inglés") y logros de Plex casi conseguidos ("2 películas para Cineclub"). Con lo que ya calculan
// plexHistorial.estadisticas y plexTrofeos.datosUsuario.
const db = require("../core/db");
const plexLinks = require("./plexLinks");
const plexHistorial = require("./plexHistorial");
const plexTrofeos = require("./plexTrofeos");
const plexGordos = require("./plexGordos");
const achievements = require("./achievementsSystem");

const MAX_LISTA = 5;

// La versión que se dice de una serie a medias si todo lo visto es en una: la más concreta primero (VOSE antes que
// inglés).
const PREFERENCIA = [
    "vose",
    "ingles_sin_subs",
    "ingles",
    "castellano",
    "anime_jap_sub_es",
    "anime_jap_sub_en",
    "anime_jap_sin_subs",
    "anime_castellano",
    "anime_ingles",
];

const IDIOMAS = {
    es: { emoji: "🇪🇸", nombre: "Castellano" },
    lat: { emoji: "🌎", nombre: "Latino" },
    en: { emoji: "🇬🇧", nombre: "Inglés" },
    ja: { emoji: "🇯🇵", nombre: "Japonés" },
    otro: { emoji: "🌐", nombre: "Otros" },
};

/** La unidad de cada contador de logros ("películas", "episodios"...), en plural y en singular. */
function unidad(event) {
    const e = String(event || "");
    if (e.startsWith("plex_idioma_eps_")) return ["episodio", "episodios"];
    if (e.startsWith("plex_idioma_pelis_")) return ["película", "películas"];
    if (e.startsWith("plex_idioma_series_")) return ["serie", "series"];
    return (
        {
            plex_horas: ["hora", "horas"],
            plex_peliculas: ["película", "películas"],
            plex_episodios: ["episodio", "episodios"],
            plex_series: ["serie", "series"],
            plex_maraton: ["hora en un día", "horas en un día"],
            plex_atracon: ["episodio en un día", "episodios en un día"],
            plex_noctambulo: ["noche", "noches"],
            plex_series_completas: ["serie", "series"],
            plex_anime_peliculas: ["película", "películas"],
            plex_anime_series: ["serie", "series"],
            plex_anime_episodios: ["episodio", "episodios"],
            plex_anime_completas: ["serie", "series"],
            plex_cine_compartido: ["película", "películas"],
            plex_sin_spoilers: ["estreno", "estrenos"],
            plex_primero: ["estreno", "estrenos"],
        }[e] || null
    );
}

/** Cuánto de lo visto (con el idioma ya revisado) es en cada idioma, y del inglés y el japonés, con qué subtítulos. */
function repartoIdiomas(guildId, tautulliUserId) {
    const filas = db
        .prepare(
            `SELECT audio, subs, COUNT(*) AS n FROM plex_reproducciones
             WHERE guildId = ? AND tautulliUserId = ? AND visto = 1 AND idioma_revisado = 1 AND audio IS NOT NULL
             GROUP BY audio, subs`,
        )
        .all(guildId, String(tautulliUserId));
    const total = filas.reduce((s, f) => s + f.n, 0);
    const pendientes = db
        .prepare("SELECT COUNT(*) FROM plex_reproducciones WHERE guildId = ? AND tautulliUserId = ? AND visto = 1 AND idioma_revisado = 0")
        .pluck()
        .get(guildId, String(tautulliUserId));
    const audios = new Map();
    for (const f of filas) {
        const a = IDIOMAS[f.audio] ? f.audio : "otro";
        if (!audios.has(a)) audios.set(a, { n: 0, subs: {} });
        const x = audios.get(a);
        x.n += f.n;
        x.subs[f.subs || "no"] = (x.subs[f.subs || "no"] || 0) + f.n;
    }
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const lista = [...audios.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .map(([audio, x]) => ({
            audio,
            ...IDIOMAS[audio],
            pct: pct(x.n),
            subs: Object.fromEntries(Object.entries(x.subs).map(([s, n]) => [s, pct(n)])),
        }));
    return { total, pendientes, lista };
}

/** Series empezadas y sin terminar, las que menos les faltan primero, y en qué versión van si es todo en una. */
function seriesAMedias(datos) {
    const enFicha = (s, set) => s.temporadas.reduce((n, t) => n + t.episodios.filter((e) => set.has(`${t.n}:${e}`)).length, 0);
    return datos.series
        .filter((s) => !s.completa && s.total >= 2 && s.vistosEnFicha > 0)
        .map((s) => {
            const modo = PREFERENCIA.find((m) => s.porModo?.has(m) && enFicha(s, s.porModo.get(m)) === s.vistosEnFicha) || null;
            return {
                titulo: s.ficha.titulo,
                anime: s.anime,
                faltan: s.total - s.vistosEnFicha,
                vistos: s.vistosEnFicha,
                total: s.total,
                modo,
            };
        })
        .sort((a, b) => a.faltan - b.faltan || b.vistos / b.total - a.vistos / a.total)
        .slice(0, MAX_LISTA);
}

/** Los logros de Plex sin conseguir más avanzados (con algo de progreso), los más cerca primero. */
function casiConseguidos(guildId, discordUserId) {
    return achievements
        .listUserAchievements(guildId, discordUserId)
        .filter((a) => a.category === "plex" && !a.completed && a.progress > 0 && a.progress < a.target)
        .map((a) => ({
            id: a.id,
            nombre: a.name,
            emoji: a.emoji || null,
            progreso: a.progress,
            objetivo: a.target,
            unidad: unidad(a.event),
        }))
        .sort((a, b) => b.progreso / b.objetivo - a.progreso / a.objetivo || a.objetivo - a.progreso - (b.objetivo - b.progreso))
        .slice(0, MAX_LISTA);
}

/**
 * Todo lo de la pantalla 🍿 Plex de alguien. null si no tiene la cuenta de Plex vinculada.
 */
function resumen(guildId, discordUserId) {
    const link = plexLinks.getLinkByDiscordId(guildId, discordUserId);
    if (!link) return null;
    const stats = plexHistorial.estadisticas(guildId, link.tautulliUserId);
    const datos = plexTrofeos.datosUsuario(guildId, link.tautulliUserId, plexTrofeos.contexto(guildId));
    const logros = achievements.listUserAchievements(guildId, discordUserId).filter((a) => a.category === "plex");
    const gordos = plexGordos.contar(guildId, [discordUserId]).get(discordUserId) || 0;
    return {
        plexUsername: link.plexUsername,
        stats,
        terminadas: datos.cuentas.seriesCompletas + datos.cuentas.animeCompletas,
        animeTerminadas: datos.cuentas.animeCompletas,
        idiomas: repartoIdiomas(guildId, link.tautulliUserId),
        aMedias: seriesAMedias(datos),
        casi: casiConseguidos(guildId, discordUserId),
        logros: { completados: logros.filter((a) => a.completed).length, total: logros.length },
        gordos,
        siguienteRol: plexGordos.siguiente(guildId, gordos),
    };
}

/** "3 episodios" / "1 película": cuánto falta con su unidad. */
function textoFalta(n, u) {
    if (!u) return `${n} más`;
    return `${n} ${n === 1 ? u[0] : u[1]}`;
}

module.exports = { resumen, seriesAMedias, unidad, textoFalta };
