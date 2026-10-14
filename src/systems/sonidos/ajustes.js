// Lo que cada sonido lleva además del nombre y el archivo: categoría (#325), volumen (#328), roles que lo pueden usar (#329) y
// cuántas veces ha sonado (#297). Todo por servidor y sin Discord: los roles se comparan con los de un miembro que se pasa.
const db = require("../../core/db");

const CATEGORIA_MAX = 24;
const VOLUMEN_MIN = 25;
const VOLUMEN_MAX = 200;
const SIN_CATEGORIA = "Sin categoría";

/** La categoría limpia (sin espacios de más ni «|», que separa filtros en los botones), o null si queda vacía. */
function normalizarCategoria(texto) {
    const t = String(texto ?? "")
        .replace(/\|/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    return t ? t.slice(0, CATEGORIA_MAX) : null;
}

/** Pone o quita (texto vacío) la categoría de un sonido. @returns {{ ok: boolean, categoria?: string|null, motivo?: string }} */
function fijarCategoria(guildId, id, texto) {
    const categoria = normalizarCategoria(texto);
    const r = db.prepare("UPDATE sonidos SET categoria = ? WHERE guildId = ? AND id = ?").run(categoria, String(guildId), Number(id));
    return r.changes ? { ok: true, categoria } : { ok: false, motivo: "Ese sonido ya no existe." };
}

/** Las categorías que hay en el servidor, por nombre (sin la de «sin categoría»). */
function categorias(guildId) {
    return db
        .prepare("SELECT DISTINCT categoria FROM sonidos WHERE guildId = ? AND categoria IS NOT NULL ORDER BY categoria COLLATE NOCASE")
        .all(String(guildId))
        .map((f) => f.categoria);
}

/** Fija el volumen (25 a 200 %) de un sonido. @returns {{ ok: boolean, volumen?: number, motivo?: string }} */
function fijarVolumen(guildId, id, valor) {
    const texto = String(valor ?? "")
        .trim()
        .replace(/\s*%$/, "");
    const volumen = Number(texto);
    if (!texto || !Number.isInteger(volumen) || volumen < VOLUMEN_MIN || volumen > VOLUMEN_MAX) {
        return { ok: false, motivo: `El volumen es un número entero entre ${VOLUMEN_MIN} y ${VOLUMEN_MAX} (100 es el original).` };
    }
    const r = db.prepare("UPDATE sonidos SET volumen = ? WHERE guildId = ? AND id = ?").run(volumen, String(guildId), Number(id));
    return r.changes ? { ok: true, volumen } : { ok: false, motivo: "Ese sonido ya no existe." };
}

/** Los roles (IDs) que pueden usar un sonido; vacío = todo el mundo. */
const rolesDe = (sonidoId) =>
    db
        .prepare("SELECT roleId FROM sonido_roles WHERE sonidoId = ? ORDER BY roleId")
        .all(Number(sonidoId))
        .map((f) => f.roleId);

/** Sustituye los roles de un sonido (lista vacía = de todos). */
function fijarRoles(sonidoId, roleIds) {
    const poner = db.prepare("INSERT OR IGNORE INTO sonido_roles (sonidoId, roleId) VALUES (?, ?)");
    db.transaction(() => {
        db.prepare("DELETE FROM sonido_roles WHERE sonidoId = ?").run(Number(sonidoId));
        for (const rol of new Set(roleIds.map(String))) poner.run(Number(sonidoId), rol);
    })();
}

/** Los ids de los sonidos del servidor que tienen roles asignados (para marcarlos con 🔒 en el panel). */
const conRestriccion = (guildId) =>
    new Set(
        db
            .prepare("SELECT DISTINCT r.sonidoId FROM sonido_roles r JOIN sonidos s ON s.id = r.sonidoId WHERE s.guildId = ?")
            .all(String(guildId))
            .map((f) => f.sonidoId),
    );

/** ¿Puede este miembro usar el sonido? Sin roles asignados, sí; con roles, basta con tener uno. @returns {{ ok: boolean, roles: string[] }} */
function puedeUsar(sonidoId, member) {
    const roles = rolesDe(sonidoId);
    if (!roles.length) return { ok: true, roles };
    return { ok: roles.some((r) => member?.roles?.cache?.has?.(r)), roles };
}

/** Suma una reproducción al sonido. */
const contar = (sonidoId) => db.prepare("UPDATE sonidos SET reproducciones = reproducciones + 1 WHERE id = ?").run(Number(sonidoId));

/** Los sonidos más usados del servidor (con al menos un uso), el que más suena primero. */
const masUsados = (guildId, limite = 10) =>
    db
        .prepare(
            "SELECT id, nombre, reproducciones FROM sonidos WHERE guildId = ? AND reproducciones > 0 ORDER BY reproducciones DESC, nombre COLLATE NOCASE LIMIT ?",
        )
        .all(String(guildId), Number(limite));

/** Las líneas del ranking, para el panel de /sonidos y el de admin. */
function textoRanking(guildId, limite = 10) {
    const lista = masUsados(guildId, limite);
    if (!lista.length) return "Todavía no ha sonado ningún sonido.";
    return lista.map((s, i) => `**${i + 1}.** ${s.nombre} — ${s.reproducciones} ${s.reproducciones === 1 ? "vez" : "veces"}`).join("\n");
}

module.exports = {
    CATEGORIA_MAX,
    VOLUMEN_MIN,
    VOLUMEN_MAX,
    SIN_CATEGORIA,
    normalizarCategoria,
    fijarCategoria,
    categorias,
    fijarVolumen,
    rolesDe,
    conRestriccion,
    fijarRoles,
    puedeUsar,
    contar,
    masUsados,
    textoRanking,
};
