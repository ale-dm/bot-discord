// ⏳ Roles temporales (#543): las reglas y la BD, sin Discord. Una asignación vive en `roles_temporales` hasta que vence, se
// quita antes de tiempo o se cancela (el rol se ha borrado). Dar y quitar el rol en Discord, y los DM, están en
// discord/envios/rolesTemporales.js.
const db = require("../core/db");

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_DEFECTO = 7;
const DIAS_MAX = 365;
const ESTADOS_FIN = new Set(["vencido", "quitado", "cancelado"]);

/** Los días escritos en un formulario: un entero de 1 a 365, o null. */
function diasValidos(texto) {
    const t = String(texto ?? "").trim();
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= DIAS_MAX ? n : null;
}

const fila = (r) => (r ? { ...r, avisar: Boolean(r.avisar) } : null);

/** Una asignación por id, o null. */
const get = (id) => fila(db.prepare("SELECT * FROM roles_temporales WHERE id = ?").get(Number(id)));

/** La asignación activa de ese rol a esa persona, o null. Cada rol temporal de una persona es independiente. */
const activo = (guildId, userId, roleId) =>
    fila(
        db
            .prepare("SELECT * FROM roles_temporales WHERE guildId = ? AND userId = ? AND roleId = ? AND estado = 'activo'")
            .get(String(guildId), String(userId), String(roleId)),
    );

/**
 * Apunta una asignación nueva. Si esa persona ya tiene ese rol temporal activo, no se duplica: se renueva.
 * @returns {{ ok: true, id: number, vence: number } | { ok: false, motivo: string }}
 */
function registrar({ guildId, userId, roleId, porId, dias, avisar = true }, ahora = Date.now()) {
    if (!diasValidos(dias)) return { ok: false, motivo: `La duración va de 1 a ${DIAS_MAX} días.` };
    if (activo(guildId, userId, roleId)) return { ok: false, motivo: "Ya tiene ese rol temporal: renuévalo desde la lista." };
    const vence = ahora + Number(dias) * DIA_MS;
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO roles_temporales (guildId, userId, roleId, asignadoPor, inicio, vence, avisar)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(String(guildId), String(userId), String(roleId), String(porId), ahora, vence, avisar ? 1 : 0);
    return { ok: true, id: Number(lastInsertRowid), vence };
}

/**
 * Alarga una asignación activa `dias` desde su vencimiento (o desde ahora si ya venció), con un tope de 365 días desde ahora.
 * @returns {{ ok: true, antes: number, vence: number } | { ok: false, motivo: string }}
 */
function renovar(id, dias, ahora = Date.now()) {
    if (!diasValidos(dias)) return { ok: false, motivo: `La duración va de 1 a ${DIAS_MAX} días.` };
    const r = get(id);
    if (!r || r.estado !== "activo") return { ok: false, motivo: "Ese rol temporal ya no está activo." };
    const vence = Math.min(Math.max(r.vence, ahora) + Number(dias) * DIA_MS, ahora + DIAS_MAX * DIA_MS);
    db.prepare("UPDATE roles_temporales SET vence = ? WHERE id = ? AND estado = 'activo'").run(vence, r.id);
    return { ok: true, antes: r.vence, vence };
}

/**
 * Cierra una asignación activa (`vencido`, `quitado` o `cancelado`). Solo cambia una vez: si ya estaba cerrada, devuelve null.
 * @returns {object | null} la asignación tal y como estaba
 */
function terminar(id, estado, porId = null, ahora = Date.now()) {
    if (!ESTADOS_FIN.has(estado)) throw new Error(`Estado de rol temporal no válido: ${estado}`);
    const r = get(id);
    const { changes } = db
        .prepare("UPDATE roles_temporales SET estado = ?, terminadoEn = ?, terminadoPor = ? WHERE id = ? AND estado = 'activo'")
        .run(estado, ahora, porId ? String(porId) : null, Number(id));
    return changes ? r : null;
}

/** Las asignaciones activas de un servidor, la que antes vence primero. */
const activos = (guildId) =>
    db.prepare("SELECT * FROM roles_temporales WHERE guildId = ? AND estado = 'activo' ORDER BY vence, id").all(String(guildId)).map(fila);

/** Las activas ya vencidas (de todos los servidores): las que hay que quitar. */
const vencidas = (ahora = Date.now()) =>
    db.prepare("SELECT * FROM roles_temporales WHERE estado = 'activo' AND vence <= ? ORDER BY vence, id").all(ahora).map(fila);

/** Las activas de un rol (para cancelarlas si se borra). */
const activasDelRol = (guildId, roleId) =>
    db
        .prepare("SELECT * FROM roles_temporales WHERE guildId = ? AND roleId = ? AND estado = 'activo'")
        .all(String(guildId), String(roleId))
        .map(fila);

module.exports = {
    DIA_MS,
    DIAS_DEFECTO,
    DIAS_MAX,
    diasValidos,
    get,
    activo,
    registrar,
    renovar,
    terminar,
    activos,
    vencidas,
    activasDelRol,
};
