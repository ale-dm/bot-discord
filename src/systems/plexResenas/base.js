// 🍿 Reseñas de Plex: claves estables, notas en medias estrellas y texto. La lógica está en systems/plexResenas/.
const { normalizar, clavePelicula } = require("../plexFichas");

const MAX_TEXTO = 500;
const NOTA_MIN = 1;
const NOTA_MAX = 10;
const TIPOS = new Set(["movie", "show"]);

/** 1..10 medias estrellas → "½", "★", "★½" … "★★★★★". */
function estrellasTexto(nota) {
    const n = Math.max(0, Math.min(NOTA_MAX, Number(nota) || 0));
    const llenas = Math.floor(n / 2);
    return `${"★".repeat(llenas)}${n % 2 ? "½" : ""}` || "½";
}

/** La clave estable de una película: `peli:<titulo normalizado>|<anio>`. */
const clavePeli = (titulo, anio) => `peli:${clavePelicula(titulo, anio)}`;

/** La clave de una serie o, con `temporada`, de una temporada: `serie:<titulo>[|t<n>]`. */
const claveSerie = (titulo, temporada = null) => `serie:${normalizar(titulo)}${temporada ? `|t${Number(temporada)}` : ""}`;

/** El año de una clave de película (`peli:<titulo>|2024`), o null. */
function anioDeClave(clave) {
    const m = /\|(\d{4})$/.exec(String(clave || ""));
    return m ? Number(m[1]) : null;
}

/** La clave a partir de lo que llega (tipo, título, año y, en series, temporada). */
const claveDe = ({ tipo, titulo, anio, temporada }) => (tipo === "movie" ? clavePeli(titulo, anio) : claveSerie(titulo, temporada));

/** La temporada de una clave de serie (`serie:<titulo>|t<n>`), o null si es la serie entera o una película. */
const temporadaDeClave = (clave) => {
    const m = /\|t(\d+)$/.exec(String(clave || ""));
    return m ? Number(m[1]) : null;
};

/** El título que se guarda y se ve: una temporada lleva «· temporada N» detrás (la clave no cambia). */
const etiquetaTemporada = (titulo, temporada) => (temporada ? `${titulo} · temporada ${temporada}` : titulo);

/** Quita el «· temporada N» de un título guardado: el que se usa para volver a guardar la reseña. */
const tituloBase = (guardado) => String(guardado || "").replace(/ · temporada \d+$/, "");

/** Nota válida: entero de 1 a 10 (medias estrellas). */
const notaValida = (nota) => Number.isInteger(nota) && nota >= NOTA_MIN && nota <= NOTA_MAX;

/** Texto de la reseña: sin menciones masivas ni enlaces, recortado y como mucho 500 caracteres. */
function textoDe(texto) {
    const t = String(texto ?? "")
        .replace(/@(everyone|here)/gi, "")
        .replace(/https?:\/\/\S+/gi, "")
        .trim();
    return t ? t.slice(0, MAX_TEXTO) : null;
}

module.exports = {
    MAX_TEXTO,
    NOTA_MIN,
    NOTA_MAX,
    TIPOS,
    estrellasTexto,
    clavePeli,
    claveSerie,
    claveDe,
    notaValida,
    textoDe,
    anioDeClave,
    temporadaDeClave,
    etiquetaTemporada,
    tituloBase,
};
