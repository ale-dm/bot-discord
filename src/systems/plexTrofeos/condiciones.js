// 🍿 Trofeos de admin: sus condiciones (género, director, fechas…), cómo se escriben y cómo se evalúan.
const plexIdiomas = require("../plexIdiomas");
const { canonico, normalizar } = require("./base");

// ─── Trofeos de admin (condición en texto) ──────────────────────────────────
const CONDICIONES = {
    genero: { valor: true, n: true, ayuda: "`genero:Terror 20` → 20 películas de ese género" },
    director: {
        valor: true,
        n: "opcional",
        ayuda: "`director:Christopher Nolan` → todas las suyas que hay en Plex (o `director:Nolan 5`)",
    },
    decada: { valor: "anio", n: true, ayuda: "`decada:1980 10` → 10 películas de los 80" },
    saga: { valor: true, ayuda: "`saga:Harry Potter` → todas las películas de esa colección" },
    serie: { valor: true, ayuda: "`serie:Breaking Bad` → terminarla entera" },
    pelicula: { valor: true, ayuda: "`pelicula:Titanic` → verla" },
    peliculas: { n: true, ayuda: "`peliculas 50` · `episodios 500` · `horas 200`" },
    episodios: { n: true },
    horas: { n: true },
    "series-completas": { n: true, ayuda: "`series-completas 10` → terminar 10 series (sin anime)" },
    "anime-peliculas": { n: true, ayuda: "`anime-peliculas 10` · `anime-series 5` · `anime-episodios 300` · `anime-completas 3`" },
    "anime-series": { n: true },
    "anime-episodios": { n: true },
    "anime-completas": { n: true },
    // Por idioma: la versión va como valor (ingles, vose, ingles-sin-subs, castellano, anime-castellano, anime-jap-sub-es,
    // anime-ingles, anime-jap-sub-en, anime-jap-sin-subs).
    "idioma-episodios": {
        valor: "modo",
        n: true,
        ayuda: "`idioma-episodios:ingles 50` · `idioma-peliculas:castellano 20` · `idioma-series:anime-jap-sub-es 3`",
    },
    "idioma-peliculas": { valor: "modo", n: true },
    "idioma-series": { valor: "modo", n: true },
};
const TIPO_IDIOMA = { "idioma-episodios": "eps", "idioma-peliculas": "pelis", "idioma-series": "series" };
/** Trofeos con fecha (F-PX-11): cualquier condición puede llevar `desde:` y `hasta:` (días en hora de Madrid, incluidos):
 * solo cuenta lo que se empezó a ver entre esas fechas. Para eventos de temporada (Halloween, Navidad...). */
const AYUDA_FECHAS = "`genero:Terror 5 desde:2026-10-01 hasta:2026-10-31` → 🎃 con fechas: solo cuenta lo visto entre esos días";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Unix (s) del comienzo de un día (AAAA-MM-DD) en hora de Madrid (a medianoche es UTC+1 o UTC+2). */
function inicioDia(dia) {
    const [y, m, d] = dia.split("-").map(Number);
    const { momento } = require("../plexHistorial");
    for (const horas of [1, 2]) {
        const t = Date.UTC(y, m - 1, d, -horas) / 1000;
        const x = momento(t);
        if (x.dia === dia && x.hora === 0) return t;
    }
    return Date.UTC(y, m - 1, d) / 1000;
}
const diaSiguiente = (dia) => new Date(Date.parse(`${dia}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const diaValido = (dia) => {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(dia) ? Date.parse(`${dia}T00:00:00Z`) : NaN;
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === dia;
};
/** El rango en unix (s) de una condición con fechas ({ desde, hasta } con hasta sin incluir), o null si no tiene. */
function rangoDe(cond) {
    if (!cond.desde && !cond.hasta) return null;
    return {
        desde: cond.desde ? inicioDia(cond.desde) : 0,
        hasta: cond.hasta ? inicioDia(diaSiguiente(cond.hasta)) : Number.MAX_SAFE_INTEGER,
    };
}
function textoFechas({ desde, hasta }) {
    const f = (dia) => {
        const [y, m, d] = dia.split("-").map(Number);
        return `${d} de ${MESES[m - 1]} de ${y}`;
    };
    if (desde && hasta) return `del ${f(desde)} al ${f(hasta)}`;
    return desde ? `desde el ${f(desde)}` : `hasta el ${f(hasta)}`;
}
/** Lee una condición escrita por un admin ("genero:Terror 20", con `desde:`/`hasta:` si tiene fechas).
 * @returns {{ ok: true, cond, texto } | { ok: false, error }} */
function parsearCondicion(texto) {
    const fechas = {};
    let resto = String(texto || "");
    for (const [, clave, dia] of [...resto.matchAll(/\s+(desde|hasta):\s*(\S+)/gi)]) {
        if (!diaValido(dia))
            return { ok: false, error: `La fecha de "${clave.toLowerCase()}" va como AAAA-MM-DD: \`${clave.toLowerCase()}:2026-10-31\`.` };
        fechas[clave.toLowerCase()] = dia;
    }
    resto = resto.replace(/\s+(desde|hasta):\s*\S+/gi, "");
    if (fechas.desde && fechas.hasta && fechas.hasta < fechas.desde)
        return { ok: false, error: 'La fecha de "hasta" es anterior a la de "desde".' };
    const r = parsearSinFechas(resto);
    if (!r.ok) return r;
    const sufijo = `${fechas.desde ? ` desde:${fechas.desde}` : ""}${fechas.hasta ? ` hasta:${fechas.hasta}` : ""}`;
    return { ok: true, cond: { ...r.cond, ...fechas }, texto: r.texto + sufijo };
}
function parsearSinFechas(texto) {
    const m = /^\s*([a-z-]+)\s*(?::\s*(.+?))?(?:\s+(\d+))?\s*$/i.exec(String(texto || ""));
    if (!m)
        return {
            ok: false,
            error: "No entiendo la condición: va como `tipo:valor número`, por ejemplo `genero:Terror 20` o `peliculas 50`.",
        };
    const tipo = m[1].toLowerCase();
    const def = CONDICIONES[tipo];
    if (!def) return { ok: false, error: `No conozco el tipo "${tipo}".` };
    let valor = (m[2] || "").trim();
    let n = m[3] ? Number(m[3]) : null;
    // En títulos el número es parte del nombre ("pelicula:Blade Runner 2049").
    if (["serie", "saga", "pelicula"].includes(tipo) && n !== null) {
        valor = `${valor} ${n}`.trim();
        n = null;
    }
    if (def.valor && !valor) return { ok: false, error: `Falta el valor: ${def.ayuda || tipo}` };
    if (!def.valor && valor) return { ok: false, error: `"${tipo}" no lleva valor después de los dos puntos.` };
    if (def.valor === "anio") {
        if (!/^\d{4}$/.test(valor)) return { ok: false, error: "La década va con el año: `decada:1980 10`." };
        valor = String(Math.floor(Number(valor) / 10) * 10);
    }
    if (def.valor === "modo") {
        const modo = plexIdiomas.modoPorSlug(valor);
        if (!modo) {
            const lista = Object.values(plexIdiomas.MODOS)
                .map((x) => `\`${x.slug}\``)
                .join(", ");
            return { ok: false, error: `No conozco la versión "${valor}". Hay: ${lista}.` };
        }
        valor = plexIdiomas.MODOS[modo].slug;
    }
    if (def.n === true && !(n > 0)) return { ok: false, error: `Falta cuántos: ${def.ayuda || `\`${tipo} 10\``}` };
    if (def.n === undefined && n !== null) n = null;
    const texto2 = `${tipo}${valor ? `:${valor}` : ""}${n ? ` ${n}` : ""}`;
    return { ok: true, cond: { tipo, valor, n }, texto: texto2 };
}
/** Busca por nombre en un mapa { slug → { nombre } }: igual o, si no, el único que lo contiene. */
function buscarPorNombre(mapa, valor) {
    const v = normalizar(valor);
    const lista = [...mapa.values()];
    const exacto = lista.find((x) => normalizar(x.nombre) === v);
    if (exacto) return exacto;
    const parecidos = lista.filter((x) => normalizar(x.nombre).includes(v));
    return parecidos.length === 1 ? parecidos[0] : null;
}
/**
 * Progreso de alguien en un trofeo de admin y su objetivo. null si todavía no se puede saber (p. ej. "todas las de un
 * director" sin la biblioteca entera).
 */
function evaluarCondicion(cond, datos, ctx, stats = {}) {
    const { tipo, valor, n } = cond;
    switch (tipo) {
        case "genero":
            return { progreso: datos.porGenero.get(canonico(valor))?.n || 0, objetivo: n };
        case "decada":
            return { progreso: datos.porDecada.get(Number(valor)) || 0, objetivo: n };
        case "director":
        case "saga": {
            if (!ctx.completa) return null;
            const x = buscarPorNombre(tipo === "director" ? ctx.directores : ctx.sagas, valor);
            if (!x) return { progreso: 0, objetivo: n || 1 };
            const pelis = [...x.peliculas.keys()];
            return { progreso: pelis.filter((p) => datos.vistas.has(p)).length, objetivo: n || pelis.length };
        }
        case "serie": {
            const lista = new Map(datos.series.map((s) => [s.ficha.rating_key, s]));
            const ficha =
                ctx.seriesPorTitulo.get(normalizar(valor)) ||
                buscarPorNombre(new Map([...ctx.seriesPorKey.values()].map((s) => [s.rating_key, { ...s, nombre: s.titulo }])), valor);
            if (!ficha) return { progreso: 0, objetivo: 1 };
            const s = lista.get(ficha.rating_key);
            const total = Object.entries(ficha.temporadas || {})
                .filter(([t]) => Number(t) > 0)
                .reduce((sum, [, eps]) => sum + eps.length, 0);
            return { progreso: s ? s.vistosEnFicha : 0, objetivo: Math.max(1, total) };
        }
        case "pelicula": {
            const v = normalizar(valor);
            const vista = [...datos.vistas].some((k) => k.split("|")[0] === v);
            return { progreso: vista ? 1 : 0, objetivo: 1 };
        }
        case "peliculas":
            return { progreso: stats.peliculas || 0, objetivo: n };
        case "episodios":
            return { progreso: stats.episodios || 0, objetivo: n };
        case "horas":
            return { progreso: stats.horas || 0, objetivo: n };
        case "series-completas":
            return { progreso: datos.cuentas.seriesCompletas, objetivo: n };
        case "idioma-episodios":
        case "idioma-peliculas":
        case "idioma-series":
            return { progreso: datos.cuentas.idioma[plexIdiomas.modoPorSlug(valor)][TIPO_IDIOMA[tipo]], objetivo: n };
        case "anime-peliculas":
            return { progreso: datos.cuentas.animePeliculas, objetivo: n };
        case "anime-series":
            return { progreso: datos.cuentas.animeSeries, objetivo: n };
        case "anime-episodios":
            return { progreso: datos.cuentas.animeEpisodios, objetivo: n };
        case "anime-completas":
            return { progreso: datos.cuentas.animeCompletas, objetivo: n };
        default:
            return null;
    }
}
function describirCondicion(cond) {
    const { tipo, valor, n } = cond;
    const textos = {
        genero: `Ve ${n} películas de ${valor}`,
        decada: `Ve ${n} películas de los años ${String(valor).slice(2)}`,
        director: n ? `Ve ${n} películas de ${valor}` : `Ve todas las películas de ${valor} que hay en Plex`,
        saga: `Ve todas las películas de la saga ${valor}`,
        serie: `Termina ${valor} entera`,
        pelicula: `Ve ${valor}`,
        peliculas: `Ve ${n} películas distintas`,
        episodios: `Ve ${n} episodios distintos`,
        horas: `Ve ${n} horas en Plex`,
        "series-completas": `Termina ${n} series (sin contar anime)`,
        "anime-peliculas": `Ve ${n} películas de anime`,
        "anime-series": `Ve episodios de ${n} series de anime`,
        "anime-episodios": `Ve ${n} episodios de anime`,
        "anime-completas": `Termina ${n} series de anime`,
    };
    let texto = textos[tipo] || tipo;
    if (TIPO_IDIOMA[tipo]) {
        const modo = plexIdiomas.MODOS[plexIdiomas.modoPorSlug(valor)];
        const de = modo.anime ? "de anime " : "";
        const que = { eps: `${n} episodios ${de}`, pelis: `${n} películas ${de}`, series: `${n} series ${de}enteras ` }[TIPO_IDIOMA[tipo]];
        texto = `${TIPO_IDIOMA[tipo] === "series" ? "Termina" : "Ve"} ${que}${modo.texto}`;
    }
    return cond.desde || cond.hasta ? `${texto} (${textoFechas(cond)})` : texto;
}
const ORDEN_TIPO = ["serie", "idioma", "saga", "director", "temporada", "admin", "genero", "pais", "decada"];

module.exports = {
    CONDICIONES,

    AYUDA_FECHAS,
    MESES,

    rangoDe,

    parsearCondicion,

    evaluarCondicion,
    describirCondicion,
    ORDEN_TIPO,
};
