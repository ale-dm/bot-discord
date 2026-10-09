// 🔍 Diagnóstico de Plex: comprobar con datos reales los supuestos de los logros de Plex (docs/SIGUIENTES_PASOS.md §3).
//   - Panel admin → Plex → 🏆 Trofeos → 🔍 Idiomas (F-PX-07): cuántas reproducciones hay de cada audio y subtítulo, y
//     qué nombres de idioma no se reconocen (los "otro", preguntando a Tautulli por unos cuantos).
//   - npm run plex:check (F-PX-06, scripts/plex-check.js): todo lo de la tabla de supuestos contra el Tautulli de
//     verdad, sin tocar la BD.
// Solo lee: ni guarda nada ni llama a nada que cambie Tautulli.
const db = require("../core/db");
const tautulli = require("../services/tautulliClient");
const plexLinks = require("./plexLinks");
const plexFichas = require("./plexFichas");
const plexIdiomas = require("./plexIdiomas");

const TIPOS = new Set(["movie", "episode"]);

/** Cuántas reproducciones vistas de los vinculados hay de cada audio y de cada subtítulo, y cuántas sin revisar. */
function idiomasGuardados(guildId) {
    const usuarios = plexLinks.getLinks(guildId).map((l) => String(l.tautulliUserId));
    const vacio = { revisadas: 0, pendientes: 0, sinDato: 0, audio: {}, subs: {} };
    if (!usuarios.length) return vacio;
    const filas = db
        .prepare(
            `SELECT idioma_revisado AS revisado, audio, subs, COUNT(*) AS n FROM plex_reproducciones
             WHERE guildId = ? AND visto = 1 AND tautulliUserId IN (${usuarios.map(() => "?").join(",")})
             GROUP BY idioma_revisado, audio, subs`,
        )
        .all(guildId, ...usuarios);
    const r = vacio;
    for (const f of filas) {
        if (!f.revisado) {
            r.pendientes += f.n;
            continue;
        }
        r.revisadas += f.n;
        if (!f.audio) {
            r.sinDato += f.n;
            continue;
        }
        r.audio[f.audio] = (r.audio[f.audio] || 0) + f.n;
        r.subs[f.subs || "no"] = (r.subs[f.subs || "no"] || 0) + f.n;
    }
    return r;
}

/** Los nombres tal cual los da Tautulli de una reproducción: audio (código y nombre) y subtítulos. */
function nombresCrudos(datos) {
    return {
        audio: [datos?.stream_audio_language_code || datos?.audio_language_code, datos?.stream_audio_language || datos?.audio_language]
            .filter(Boolean)
            .join(" / "),
        subs: Number(datos?.subtitles) === 1 ? datos?.stream_subtitle_language || datos?.subtitle_language || "(sin nombre)" : "",
    };
}

/**
 * Los nombres de idioma que no se reconocen: pregunta a Tautulli por las últimas `maximo` reproducciones guardadas como
 * "otro" (en el audio o en los subtítulos). @returns {Promise<{ revisadas, audio: Map<nombre, n>, subs: Map<nombre, n>, errores }>}
 */
async function noReconocidos(guildId, { maximo = 15 } = {}) {
    const usuarios = plexLinks.getLinks(guildId).map((l) => String(l.tautulliUserId));
    const r = { revisadas: 0, audio: new Map(), subs: new Map(), errores: 0 };
    if (!usuarios.length) return r;
    const ids = db
        .prepare(
            `SELECT id FROM plex_reproducciones
             WHERE guildId = ? AND idioma_revisado = 1 AND (audio = 'otro' OR subs = 'otro') AND tautulliUserId IN (${usuarios.map(() => "?").join(",")})
             ORDER BY inicio DESC LIMIT ?`,
        )
        .pluck()
        .all(guildId, ...usuarios, maximo);
    for (const id of ids) {
        let datos;
        try {
            datos = await tautulli.getStreamData(guildId, id);
        } catch {
            r.errores++;
            continue;
        }
        r.revisadas++;
        const { audio, subs } = plexIdiomas.idiomaDe(datos);
        const crudos = nombresCrudos(datos);
        if (audio === "otro") r.audio.set(crudos.audio || "(vacío)", (r.audio.get(crudos.audio || "(vacío)") || 0) + 1);
        if (subs === "otro") r.subs.set(crudos.subs, (r.subs.get(crudos.subs) || 0) + 1);
    }
    return r;
}

// ─── Comprobación completa (npm run plex:check) ──────────────────────────────
/**
 * Comprueba cada supuesto contra Tautulli. `guildId` puede ser null (se usa la configuración del .env). Cada paso falla
 * por separado. @returns {Promise<Array<{ paso, ok: boolean | null, lineas: string[] }>>} ok null = aviso
 */
async function pasoConexion(ctx) {
    const { guildId } = ctx;
    const users = await tautulli.getUsers(guildId);
    return { ok: true, lineas: [`${users.length} usuarios en Tautulli`] };
}

async function pasoBibliotecas(ctx) {
    const { guildId, anime, ids } = ctx;
    ctx.libs = await plexFichas.bibliotecas(guildId);
    const video = ctx.libs.filter((l) => l.tipo === "movie" || l.tipo === "show");
    const lineas = video.map((l) => {
        const esAnime = plexFichas.esAnime({ section_id: l.id, biblioteca: l.nombre, generos: [] }, anime);
        return `${esAnime ? "🎌" : "  "} ${l.nombre} (${l.tipo === "movie" ? "películas" : "series"}, ${l.items}) · id ${l.id}`;
    });
    const hayAnime = video.some((l) => plexFichas.esAnime({ section_id: l.id, biblioteca: l.nombre, generos: [] }, anime));
    lineas.push(
        anime.auto
            ? "Anime: automático (por el nombre de la biblioteca; además, lo que tenga el género Anime)"
            : `Anime: las bibliotecas ${ids.join(", ")}`,
    );
    if (!hayAnime) lineas.push("Ninguna biblioteca cuenta como anime: elegirlas en Panel admin → Plex → 🏆 Trofeos → 🎌");
    return { ok: hayAnime ? true : null, lineas };
}

async function pasoPaginacion(ctx) {
    const { guildId } = ctx;
    const lib = ctx.libs.find((l) => l.tipo === "movie" && l.items >= 4);
    if (!lib) return { ok: null, lineas: ["No hay una biblioteca de películas con al menos 4 para probar"] };
    const n = Math.min(50, Math.floor(lib.items / 2));
    const a = await tautulli.getLibraryMediaInfo(guildId, lib.id, { start: 0, length: n });
    const b = await tautulli.getLibraryMediaInfo(guildId, lib.id, { start: n, length: n });
    const keysA = new Set(a.filas.map((f) => String(f.rating_key)));
    const repetidas = b.filas.filter((f) => keysA.has(String(f.rating_key))).length;
    const ok = a.filas.length === n && b.filas.length > 0 && repetidas === 0;
    return {
        ok,
        lineas: [
            `${lib.nombre}: página 1 con ${a.filas.length}, página 2 con ${b.filas.length} (${repetidas} repetidas) · total ${a.total} de ${lib.items}`,
            ok ? "Pagina bien con start/length" : "No pagina como se espera: mirar revisarBiblioteca en plexFichas.js",
        ],
    };
}

async function pasoIdiomas(ctx) {
    const { guildId, muestra } = ctx;
    ctx.historial = (await tautulli.getHistoryPage(guildId, { start: 0, length: Math.max(muestra * 3, 50) })).filter((r) =>
        TIPOS.has(r.media_type),
    );
    const cuenta = new Map();
    const raros = new Map();
    let sinDatos = 0;
    let latino = 0;
    let noReconocidas = 0; // reproducciones con el audio o los subtítulos sin reconocer (una vez aunque sean los dos)
    for (const r of ctx.historial.slice(0, muestra)) {
        const datos = await tautulli.getStreamData(guildId, r.row_id ?? r.id);
        if (!datos) {
            sinDatos++;
            continue;
        }
        const { audio, subs } = plexIdiomas.idiomaDe(datos);
        const k = `audio ${audio || "sin dato"} · subtítulos ${subs || "?"}`;
        cuenta.set(k, (cuenta.get(k) || 0) + 1);
        if (audio === "lat") latino++;
        if (audio === "otro" || !audio || subs === "otro") noReconocidas++;
        const crudos = nombresCrudos(datos);
        if (audio === "otro" || !audio)
            raros.set(`audio "${crudos.audio || "(vacío)"}"`, (raros.get(`audio "${crudos.audio || "(vacío)"}"`) || 0) + 1);
        if (subs === "otro") raros.set(`subtítulos "${crudos.subs}"`, (raros.get(`subtítulos "${crudos.subs}"`) || 0) + 1);
    }
    const revisadas = Math.min(muestra, ctx.historial.length);
    const lineas = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k}`);
    if (sinDatos) lineas.push(`${sinDatos} sin datos de Tautulli (normal en lo muy antiguo)`);
    if (latino) lineas.push(`${latino} en latino (no cuenta como castellano)`);
    for (const [k, n] of raros) lineas.push(`No reconocido: ${k} (${n})`);
    const reconocidas = revisadas - sinDatos - noReconocidas;
    return { ok: revisadas ? reconocidas / revisadas >= 0.8 : null, lineas };
}

async function pasoFichaSerie(ctx) {
    const { guildId } = ctx;
    const ep = ctx.historial.find((r) => r.media_type === "episode" && r.grandparent_rating_key);
    if (!ep) return { ok: null, lineas: ["No hay episodios en el historial reciente"] };
    const temporadas = await tautulli.getChildrenMetadata(guildId, ep.grandparent_rating_key, "show");
    const lineas = [`${ep.grandparent_title}: ${temporadas.length} temporadas`];
    let encontrado = false;
    let conAlta = 0;
    let total = 0;
    for (const t of temporadas.filter((x) => Number(x.media_index) > 0)) {
        const eps = await tautulli.getChildrenMetadata(guildId, t.rating_key, "season");
        total += eps.length;
        conAlta += eps.filter((e) => Number(e.added_at) > 0).length;
        const numeros = eps.map((e) => Number(e.media_index)).filter((n) => n > 0);
        lineas.push(
            `  temporada ${t.media_index}: ${numeros.length} episodios (${numeros.slice(0, 3).join(", ")}${numeros.length > 3 ? "…" : ""})`,
        );
        if (Number(t.media_index) === Number(ep.parent_media_index) && numeros.includes(Number(ep.media_index))) encontrado = true;
    }
    lineas.push(
        encontrado
            ? `El episodio del historial (T${ep.parent_media_index}E${ep.media_index}) está en su temporada: cuadra`
            : `El episodio del historial (T${ep.parent_media_index}E${ep.media_index}) NO está en la ficha: mirar fichaSerie en plexFichas.js`,
    );
    lineas.push(`Fecha de llegada a Plex (added_at) en ${conAlta} de ${total} episodios (para "Sin spoilers" y "Primero del servidor")`);
    return { ok: encontrado && conAlta > 0, lineas };
}

async function pasoHoras(ctx) {
    const { guildId } = ctx;
    const desde = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const filas = [];
    for (let start = 0; start < 20000; start += 1000) {
        const pagina = await tautulli.getHistoryPage(guildId, { start, length: 1000, after: desde });
        filas.push(...pagina);
        if (pagina.length < 1000) break;
    }
    const porUsuario = new Map();
    for (const r of filas.filter((x) => TIPOS.has(x.media_type)))
        porUsuario.set(r.user_id, (porUsuario.get(r.user_id) || 0) + (Number(r.play_duration ?? r.duration) || 0));
    const [user, segundos] = [...porUsuario.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (!user) return { ok: null, lineas: ["Nadie ha visto nada en los últimos 7 días"] };
    const stats = await tautulli.getUserWatchTimeStats(guildId, user, "7");
    const deTautulli = Number(stats.find((s) => Number(s.query_days) === 7)?.total_time) || 0;
    const diferencia = deTautulli ? Math.abs(segundos - deTautulli) / deTautulli : 1;
    const nombre = filas.find((r) => r.user_id === user)?.friendly_name || user;
    return {
        ok: diferencia <= 0.15,
        lineas: [
            `${nombre}: ${(segundos / 3600).toFixed(1)} h sumando el historial · ${(deTautulli / 3600).toFixed(1)} h según Tautulli (${Math.round(diferencia * 100)} % de diferencia)`,
            "El ranking semanal suma el historial (empezado entre el lunes y el domingo); Tautulli cuenta 7 días hacia atrás desde ahora.",
        ],
    };
}

async function comprobar(guildId, { muestra = 40, bibliotecasAnime = "" } = {}) {
    const ids = String(bibliotecasAnime || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const ctx = { guildId, muestra, ids, anime: { ids: new Set(ids), auto: !ids.length }, libs: [], historial: [] };
    const pasos = [];
    const paso = async (nombre, fn) => {
        try {
            pasos.push({ paso: nombre, ...(await fn()) });
        } catch (e) {
            pasos.push({ paso: nombre, ok: false, lineas: [`Error: ${e.message}`] });
        }
    };

    await paso("Conexión", () => pasoConexion(ctx));
    await paso("Bibliotecas y anime", () => pasoBibliotecas(ctx));
    await paso("Paginación de las bibliotecas de películas", () => pasoPaginacion(ctx));
    await paso(`Idiomas (las últimas ${muestra} reproducciones)`, () => pasoIdiomas(ctx));
    await paso("Ficha de una serie (temporadas y episodios)", () => pasoFichaSerie(ctx));
    await paso("Horas: historial contra las estadísticas de Tautulli (últimos 7 días)", () => pasoHoras(ctx));

    return pasos;
}

module.exports = { idiomasGuardados, noReconocidos, comprobar };
