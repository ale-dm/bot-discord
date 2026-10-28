// 📚 Listas de películas y series de Plex (#575, épica #536), al estilo de Letterboxd: «Top 10 de Nolan», «Para ver en
// Halloween». Cada persona tiene hasta MAX_LISTAS listas de hasta MAX_ITEMS títulos, ordenadas, públicas (las ve todo el
// servidor) o privadas (solo su dueño). Solo se añaden títulos que hay ahora en Plex (plex_fichas), con la misma clave que
// las reseñas para abrir su ficha. Sin Discord: la pantalla está en paneles/plexListas.js.
const db = require("../core/db");
const { normalizar } = require("./plexFichas");
const { clavePeli, claveSerie } = require("./plexResenas/base");

const MAX_LISTAS = 10;
const MAX_ITEMS = 50;
const TITULO_MIN = 3;
const TITULO_MAX = 80;
const DESCRIPCION_MAX = 300;
const MIN_BUSQUEDA = 2;
/** Lo que cabe en un desplegable de Discord. */
const MAX_RESULTADOS = 25;

const error = (motivo) => ({ ok: false, motivo });
const linea = (t) =>
    String(t ?? "")
        .replace(/\s+/g, " ")
        .trim();
const leerLista = (f) => (f ? { ...f, publica: Boolean(f.publica) } : null);

// —— Catálogo de Plex ——

/** Las películas y series que hay ahora en Plex, una vez por clave (la misma en dos bibliotecas cuenta una). */
function catalogo(guildId) {
    const filas = db
        .prepare(
            `SELECT tipo, titulo, anio FROM plex_fichas
             WHERE guildId = ? AND encontrada = 1 AND titulo IS NOT NULL AND tipo IN ('movie', 'show') ORDER BY titulo, anio`,
        )
        .all(String(guildId));
    const porClave = new Map();
    for (const f of filas) {
        const anio = Number(f.anio) || null;
        const clave = f.tipo === "movie" ? clavePeli(f.titulo, anio) : claveSerie(f.titulo);
        if (!porClave.has(clave)) porClave.set(clave, { clave, tipo: f.tipo, titulo: f.titulo, anio });
    }
    return [...porClave.values()];
}

/** Busca en Plex por título (sin tildes ni mayúsculas): primero lo que empieza así y luego lo que lo contiene. */
function buscar(guildId, texto, limite = MAX_RESULTADOS) {
    const q = normalizar(texto);
    if (q.length < MIN_BUSQUEDA) return [];
    const encontrados = catalogo(guildId)
        .map((t) => ({ t, n: normalizar(t.titulo) }))
        .filter(({ n }) => n.includes(q));
    encontrados.sort((a, b) => Number(!a.n.startsWith(q)) - Number(!b.n.startsWith(q)) || a.n.localeCompare(b.n));
    return encontrados.slice(0, limite).map(({ t }) => t);
}

/** El título de Plex con esa clave (tipo, título y año), o null si ya no está en Plex. */
const enPlex = (guildId, clave) => catalogo(guildId).find((t) => t.clave === clave) || null;

// —— Listas ——

const obtener = (id) => leerLista(db.prepare("SELECT * FROM plex_listas WHERE id = ?").get(Number(id)));

/** ¿La puede ver? Las públicas, todo el servidor; las privadas, solo su dueño. */
const puedeVer = (lista, userId) => Boolean(lista) && (lista.publica || lista.userId === String(userId));

const CON_TOTAL = "SELECT l.*, (SELECT COUNT(*) FROM plex_lista_items i WHERE i.lista_id = l.id) AS total FROM plex_listas l";

/** Las listas de una persona, la última que tocó primero. */
const deUsuario = (guildId, userId) =>
    db
        .prepare(`${CON_TOTAL} WHERE l.guildId = ? AND l.userId = ? ORDER BY l.actualizada_en DESC, l.id DESC`)
        .all(String(guildId), String(userId))
        .map(leerLista);

/** Las listas públicas del servidor (de todos), la última que se tocó primero. */
const publicas = (guildId, limite = 50) =>
    db
        .prepare(`${CON_TOTAL} WHERE l.guildId = ? AND l.publica = 1 ORDER BY l.actualizada_en DESC, l.id DESC LIMIT ?`)
        .all(String(guildId), limite)
        .map(leerLista);

/** Los títulos de una lista, en su orden (posición 1, 2, 3…). */
const items = (listaId) =>
    db.prepare("SELECT * FROM plex_lista_items WHERE lista_id = ? ORDER BY posicion, anadido_en").all(Number(listaId));

/** Limpia y valida el título (3 a 80 caracteres) y la descripción (opcional, hasta 300). */
function validar({ titulo, descripcion }) {
    const t = linea(titulo);
    const d = String(descripcion ?? "").trim();
    if (t.length < TITULO_MIN || t.length > TITULO_MAX) return error(`El título va de ${TITULO_MIN} a ${TITULO_MAX} caracteres.`);
    if (d.length > DESCRIPCION_MAX) return error(`La descripción puede tener como mucho ${DESCRIPCION_MAX} caracteres.`);
    return { ok: true, titulo: t, descripcion: d || null };
}

/** Crea una lista (pública si no se dice otra cosa). @returns {{ ok: true, lista } | { ok: false, motivo }} */
function crear(guildId, userId, { titulo, descripcion, publica = true }, ahora = Date.now()) {
    const v = validar({ titulo, descripcion });
    if (!v.ok) return v;
    if (deUsuario(guildId, userId).length >= MAX_LISTAS) return error(`Ya tienes ${MAX_LISTAS} listas: borra una antes.`);
    const { lastInsertRowid } = db
        .prepare(
            "INSERT INTO plex_listas (guildId, userId, titulo, descripcion, publica, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(String(guildId), String(userId), v.titulo, v.descripcion, publica ? 1 : 0, ahora, ahora);
    return { ok: true, lista: obtener(lastInsertRowid) };
}

/** La lista si es de esa persona; si no, el motivo. */
function suya(id, userId) {
    const lista = obtener(id);
    if (!lista) return error("Esa lista ya no existe.");
    if (lista.userId !== String(userId)) return error("Esa lista no es tuya.");
    return { ok: true, lista };
}

const tocar = (id, ahora) => db.prepare("UPDATE plex_listas SET actualizada_en = ? WHERE id = ?").run(ahora, Number(id));

/** Cambia el título y la descripción. */
function editar(id, userId, { titulo, descripcion }, ahora = Date.now()) {
    const s = suya(id, userId);
    if (!s.ok) return s;
    const v = validar({ titulo, descripcion });
    if (!v.ok) return v;
    db.prepare("UPDATE plex_listas SET titulo = ?, descripcion = ?, actualizada_en = ? WHERE id = ?").run(
        v.titulo,
        v.descripcion,
        ahora,
        Number(id),
    );
    return { ok: true, lista: obtener(id) };
}

/** Pasa de pública a privada o al revés. */
function cambiarVisibilidad(id, userId, ahora = Date.now()) {
    const s = suya(id, userId);
    if (!s.ok) return s;
    db.prepare("UPDATE plex_listas SET publica = ?, actualizada_en = ? WHERE id = ?").run(s.lista.publica ? 0 : 1, ahora, Number(id));
    return { ok: true, lista: obtener(id) };
}

/** Borra la lista y sus títulos. */
function borrar(id, userId) {
    const s = suya(id, userId);
    if (!s.ok) return s;
    db.transaction(() => {
        db.prepare("DELETE FROM plex_lista_items WHERE lista_id = ?").run(Number(id));
        db.prepare("DELETE FROM plex_listas WHERE id = ?").run(Number(id));
    })();
    return { ok: true, lista: s.lista };
}

/** Añade al final un título que esté ahora en Plex. */
function anadir(id, userId, clave, ahora = Date.now()) {
    const s = suya(id, userId);
    if (!s.ok) return s;
    const t = enPlex(s.lista.guildId, clave);
    if (!t) return error("Ese título no está en Plex.");
    const actuales = items(id);
    if (actuales.some((i) => i.clave === clave)) return error(`**${t.titulo}** ya está en la lista.`);
    if (actuales.length >= MAX_ITEMS) return error(`La lista ya tiene ${MAX_ITEMS} títulos.`);
    db.prepare("INSERT INTO plex_lista_items (lista_id, posicion, clave, tipo, titulo, anio, anadido_en) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        Number(id),
        actuales.length + 1,
        clave,
        t.tipo,
        t.titulo,
        t.anio,
        ahora,
    );
    tocar(id, ahora);
    return { ok: true, titulo: t };
}

/** Vuelve a numerar 1, 2, 3… en el orden dado. */
function renumerar(id, claves) {
    const poner = db.prepare("UPDATE plex_lista_items SET posicion = ? WHERE lista_id = ? AND clave = ?");
    db.transaction(() => claves.forEach((clave, n) => poner.run(n + 1, Number(id), clave)))();
}

/** Quita el título de la posición `pos` (1, 2…) y cierra el hueco. */
function quitar(id, userId, pos, ahora = Date.now()) {
    const s = suya(id, userId);
    if (!s.ok) return s;
    const lista = items(id);
    const item = lista[Number(pos) - 1];
    if (!item) return error("Ese título ya no está en la lista.");
    db.prepare("DELETE FROM plex_lista_items WHERE lista_id = ? AND clave = ?").run(Number(id), item.clave);
    renumerar(
        id,
        lista.filter((i) => i.clave !== item.clave).map((i) => i.clave),
    );
    tocar(id, ahora);
    return { ok: true, item };
}

/** Sube (`delta` −1) o baja (+1) el título de la posición `pos`. @returns {{ ok: true, posicion: number } | …} */
function mover(id, userId, pos, delta, ahora = Date.now()) {
    const s = suya(id, userId);
    if (!s.ok) return s;
    const claves = items(id).map((i) => i.clave);
    const desde = Number(pos) - 1;
    const hasta = desde + Math.sign(delta);
    if (!claves[desde]) return error("Ese título ya no está en la lista.");
    if (hasta < 0 || hasta >= claves.length) return { ok: true, posicion: desde + 1 };
    [claves[desde], claves[hasta]] = [claves[hasta], claves[desde]];
    renumerar(id, claves);
    tocar(id, ahora);
    return { ok: true, posicion: hasta + 1 };
}

module.exports = {
    MAX_LISTAS,
    MAX_ITEMS,
    TITULO_MAX,
    DESCRIPCION_MAX,
    MAX_RESULTADOS,
    buscar,
    enPlex,
    obtener,
    puedeVer,
    deUsuario,
    publicas,
    items,
    validar,
    crear,
    editar,
    cambiarVisibilidad,
    borrar,
    anadir,
    quitar,
    mover,
};
