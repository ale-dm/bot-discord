// 📺 Lo que alguien ha terminado en las series, para reseñarlo (#572): cada temporada completa y la serie entera. Sale de
// lo que calcula el sistema de trofeos (plexTrofeos.datosUsuario), así que un episodio suelto nunca cuenta. Sin backfill:
// solo lo visto desde `desde`.
const { contexto, datosUsuario } = require("../plexTrofeos/datosVistos");
const { claveSerie } = require("./base");

const SIN_FIN = Number.MAX_SAFE_INTEGER;

/**
 * Las temporadas y series terminadas de una persona desde `desde` (unix en segundos).
 * `deps` (contexto, datosUsuario) se inyecta en los tests.
 * @returns {Array<{ titulo, anio, temporada, clave }>} `temporada` es null para la serie entera
 */
function terminadasDe(guildId, tautulliUserId, { desde = 0, deps = {} } = {}) {
    const ctx = (deps.contexto || contexto)(guildId);
    const { series } = (deps.datosUsuario || datosUsuario)(guildId, tautulliUserId, ctx, { desde, hasta: SIN_FIN });
    const salida = [];
    for (const s of series) {
        const titulo = s.ficha.titulo;
        const anio = s.ficha.anio ?? null;
        for (const t of s.terminadas) salida.push({ titulo, anio, temporada: t.n, clave: claveSerie(titulo, t.n) });
        if (s.completa) salida.push({ titulo, anio, temporada: null, clave: claveSerie(titulo) });
    }
    return salida;
}

/** ¿Ha terminado esa persona esa temporada (o la serie entera, sin `temporada`)? Cuenta todo lo visto, no desde una fecha. */
function haTerminado(guildId, tautulliUserId, { titulo, temporada = null }, deps = {}) {
    const clave = claveSerie(titulo, temporada);
    return terminadasDe(guildId, tautulliUserId, { deps }).some((t) => t.clave === clave);
}

module.exports = { terminadasDe, haTerminado };
