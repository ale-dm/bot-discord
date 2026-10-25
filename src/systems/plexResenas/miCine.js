// 📊 Mi cine (#574): las estadísticas personales de /plex → ⭐ Reseñas. Tus reseñas (cuántas, la media que das, la mejor
// y la peor película), lo que más ves (género y década, de las fichas de Plex), tu racha de días seguidos frente a la media
// del servidor y el resumen del año en curso (con la imagen del Plex Wrapped). Todo sale de la BD: reseñas, historial
// (plex_reproducciones) y fichas. Sin Discord; las dependencias se inyectan en los tests (`deps`).
const plexLinks = require("../plexLinks");
const plexHistorial = require("../plexHistorial");
const plexWrapped = require("../plexWrapped");
const { contexto, datosUsuario, mejorRacha, diasVistos, rachaMasLarga } = require("../plexTrofeos/datosVistos");
const { canonico } = require("../plexTrofeos/base");
const trofeosGestion = require("../plexTrofeos/gestion");
const { deUsuario, mediaPublica } = require("./consultas");

const TODAS = Number.MAX_SAFE_INTEGER;
const DIA_MS = 86400000;

const REALES = {
    deUsuario,
    mediaPublica,
    getLinkByDiscordId: plexLinks.getLinkByDiscordId,
    getLinks: plexLinks.getLinks,
    logrosOcultos: trofeosGestion.oculto,
    contexto,
    datosUsuario,
    diasVistos,
    mejorRacha,
    resumenPersonal: plexWrapped.resumenPersonal,
    graficoPersonal: plexWrapped.graficoPersonal,
};

/** Media en estrellas (0–5, un decimal) de notas en medias estrellas (1–10), o null si no hay. */
function mediaEstrellas(notas) {
    if (!notas.length) return null;
    return Math.round((notas.reduce((s, n) => s + n, 0) / notas.length / 2) * 10) / 10;
}

const reciente = (a, b) => (b.actualizado_en || 0) - (a.actualizado_en || 0);
const resenaCorta = (r) => (r ? { titulo: r.titulo, anio: r.anio ?? null, nota: r.nota, meGusta: Boolean(r.meGusta) } : null);

/**
 * Cuántas reseñas, la media que das y la película mejor y peor valorada (con empate, la que te gusta ❤️ y la más
 * reciente). La peor solo sale si tiene menos nota que la mejor: con todas iguales no hay peor.
 */
function resumenResenas(resenas) {
    const pelis = resenas.filter((r) => r.tipo === "movie");
    const mejor = [...pelis].sort((a, b) => b.nota - a.nota || Number(b.meGusta) - Number(a.meGusta) || reciente(a, b))[0] || null;
    const peor = [...pelis].sort((a, b) => a.nota - b.nota || reciente(a, b))[0] || null;
    return {
        total: resenas.length,
        peliculas: pelis.length,
        series: resenas.length - pelis.length,
        media: mediaEstrellas(resenas.map((r) => r.nota)),
        mejor: resenaCorta(mejor),
        peor: peor && mejor && peor.nota < mejor.nota ? resenaCorta(peor) : null,
    };
}

const diaAntes = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) - n * DIA_MS).toISOString().slice(0, 10);

/** Los días seguidos hasta hoy (o hasta ayer, si hoy todavía no has visto nada) en los que has visto algo. */
function rachaActual(dias, hoy) {
    const vistos = new Set(dias);
    const fin = vistos.has(hoy) ? hoy : diaAntes(hoy, 1);
    let n = 0;
    while (vistos.has(diaAntes(fin, n))) n++;
    return n;
}

/** El que tiene la `n` más alta; con empate, el primero según `desempate`. */
function elMayor(entradas, desempate) {
    return [...entradas].sort((a, b) => b.n - a.n || desempate(a, b))[0] || null;
}

/**
 * El género y la década que más ves: las películas vistas (como los trofeos, una vez por película) y las series de las
 * que has visto algún episodio (una vez por serie), con sus fichas de Plex.
 * @returns {{ genero: { nombre, n } | null, decada: { decada, n } | null }}
 */
function loQueMasVes({ porGenero, porDecada, series }) {
    const generos = new Map([...porGenero].map(([k, g]) => [k, { ...g }]));
    const decadas = new Map(porDecada);
    for (const { ficha } of series) {
        for (const [k, g] of new Map((ficha.generos || []).map((nombre) => [canonico(nombre), nombre]))) {
            if (!generos.has(k)) generos.set(k, { nombre: g, n: 0 });
            generos.get(k).n++;
        }
        if (ficha.anio) {
            const d = Math.floor(ficha.anio / 10) * 10;
            decadas.set(d, (decadas.get(d) || 0) + 1);
        }
    }
    const genero = elMayor(generos.values(), (a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const decada = elMayor(
        [...decadas].map(([d, n]) => ({ decada: d, n })),
        (a, b) => b.decada - a.decada,
    );
    return { genero: genero ? { nombre: genero.nombre, n: genero.n } : null, decada };
}

/**
 * La media de la mejor racha de días seguidos de las personas vinculadas que han visto algo. No cuenta a quien oculta
 * sus logros de Plex (plex_preferencias.ocultar).
 * @returns {{ media: number | null, personas: number }}
 */
function rachaServidor(guildId, d) {
    const rachas = d
        .getLinks(guildId)
        .filter((l) => !d.logrosOcultos(guildId, String(l.discordUserId)))
        .map((l) => d.mejorRacha(guildId, l.tautulliUserId))
        .filter((n) => n > 0);
    if (!rachas.length) return { media: null, personas: 0 };
    return { media: Math.round((rachas.reduce((s, n) => s + n, 0) / rachas.length) * 10) / 10, personas: rachas.length };
}

/** El año en curso (hora de Madrid) como periodo del Plex Wrapped: del 1 de enero a hoy. */
function anioEnCurso(ahora = Date.now()) {
    const { dia: hoy } = plexHistorial.momento(Math.floor(ahora / 1000));
    const anio = hoy.slice(0, 4);
    return { hoy, anio, periodo: { mes: anio, inicio: `${anio}-01-01`, fin: hoy, etiqueta: `${anio} (hasta hoy)`, anual: true } };
}

/** Las reseñas que has escrito este año (por la fecha en que las escribiste, en hora de Madrid). */
function resenasDelAnio(resenas, anio) {
    const delAnio = resenas.filter((r) => plexHistorial.momento(r.creado_en).dia.startsWith(`${anio}-`));
    const { total, media, mejor } = resumenResenas(delAnio);
    return { anio, resenas: total, media, mejor };
}

/**
 * Todas las cifras de 📊 Mi cine de una persona. Sin cuenta de Plex vinculada solo salen sus reseñas.
 * `ahora` (ms) fija el año en curso; `deps` sustituye las consultas en los tests.
 */
function calcular(guildId, userId, { ahora = Date.now(), deps = {} } = {}) {
    const d = { ...REALES, ...deps };
    const resenas = d.deUsuario(guildId, String(userId), { limite: TODAS });
    const { hoy, anio, periodo } = anioEnCurso(ahora);
    const base = { resenas: resumenResenas(resenas), servidor: d.mediaPublica(guildId), anio: resenasDelAnio(resenas, anio) };
    const link = d.getLinkByDiscordId(guildId, String(userId));
    if (!link) return { ...base, vinculado: false, gustos: null, racha: null };

    const datos = d.datosUsuario(guildId, link.tautulliUserId, d.contexto(guildId));
    const dias = d.diasVistos(guildId, link.tautulliUserId);
    const wrapped = d.resumenPersonal(guildId, link.tautulliUserId, periodo);
    return {
        ...base,
        vinculado: true,
        gustos: loQueMasVes(datos),
        racha: { mejor: rachaMasLarga(dias), actual: rachaActual(dias, hoy), servidor: rachaServidor(guildId, d) },
        anio: {
            ...base.anio,
            horas: wrapped.horas,
            peliculas: wrapped.peliculas,
            episodios: wrapped.episodios,
            series: wrapped.series,
            racha: rachaMasLarga(dias.filter((dia) => dia.startsWith(`${anio}-`))),
        },
    };
}

/**
 * La imagen del Plex Wrapped del año en curso (tus series más vistas), la misma que la del Wrapped mensual.
 * @returns {{ ok: true, png: Buffer } | { ok: false, motivo: string }}
 */
function imagenDelAnio(guildId, userId, { ahora = Date.now(), deps = {} } = {}) {
    const d = { ...REALES, ...deps };
    const link = d.getLinkByDiscordId(guildId, String(userId));
    if (!link) return { ok: false, motivo: "Tu cuenta de Plex no está vinculada: la imagen sale de tu historial de Plex." };
    const png = d.graficoPersonal(d.resumenPersonal(guildId, link.tautulliUserId, anioEnCurso(ahora).periodo));
    if (!png) return { ok: false, motivo: "Este año todavía no has visto series: la imagen del Wrapped es de tus series más vistas." };
    return { ok: true, png };
}

module.exports = { calcular, imagenDelAnio, resumenResenas, rachaActual, loQueMasVes, rachaServidor, anioEnCurso, mediaEstrellas };
