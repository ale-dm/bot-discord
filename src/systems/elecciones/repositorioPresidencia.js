// 👑 El SQL de lo que hace el presidente durante el mandato: el registro de sus acciones (para la espera por persona), los
// canales que crea (se borran al acabar) y los silencios y sorderas con fecha de fin (los revierte el cron).
const db = require("../../core/db");

function registrarAccion({ eleccionId, guildId, presidenteId, accion, objetivoId = null, ahora }) {
    db.prepare(
        "INSERT INTO presidencia_acciones (eleccion_id, guildId, presidenteId, accion, objetivoId, creada_en) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(Number(eleccionId), String(guildId), String(presidenteId), accion, objetivoId ? String(objetivoId) : null, ahora);
}

/** Cuándo actuó el presidente por última vez sobre esa persona en este mandato (ms), o null. */
const ultimaAccionSobre = (eleccionId, objetivoId) =>
    db
        .prepare("SELECT MAX(creada_en) FROM presidencia_acciones WHERE eleccion_id = ? AND objetivoId = ?")
        .pluck()
        .get(Number(eleccionId), String(objetivoId)) ?? null;

const acciones = (eleccionId, limite = 10) =>
    db
        .prepare("SELECT * FROM presidencia_acciones WHERE eleccion_id = ? ORDER BY creada_en DESC, id DESC LIMIT ?")
        .all(Number(eleccionId), limite);

// —— Canales ——

function registrarCanal({ eleccionId, guildId, channelId, ahora }) {
    db.prepare("INSERT INTO presidencia_canales (eleccion_id, guildId, channelId, creado_en) VALUES (?, ?, ?, ?)").run(
        Number(eleccionId),
        String(guildId),
        String(channelId),
        ahora,
    );
}

const canalesActivos = (eleccionId) =>
    db
        .prepare("SELECT * FROM presidencia_canales WHERE eleccion_id = ? AND borrado_en IS NULL ORDER BY creado_en, id")
        .all(Number(eleccionId));

const canalActivo = (eleccionId, channelId) =>
    db
        .prepare("SELECT * FROM presidencia_canales WHERE eleccion_id = ? AND channelId = ? AND borrado_en IS NULL")
        .get(Number(eleccionId), String(channelId)) || null;

function marcarCanalBorrado(id, ahora) {
    db.prepare("UPDATE presidencia_canales SET borrado_en = ? WHERE id = ? AND borrado_en IS NULL").run(ahora, Number(id));
}

// —— Sanciones (silencio y sordera) ——

function registrarSancion({ eleccionId, guildId, userId, tipo, ahora, fin }) {
    const { lastInsertRowid } = db
        .prepare("INSERT INTO presidencia_sanciones (eleccion_id, guildId, userId, tipo, inicio, fin) VALUES (?, ?, ?, ?, ?, ?)")
        .run(Number(eleccionId), String(guildId), String(userId), tipo, ahora, fin);
    return Number(lastInsertRowid);
}

/** La sanción de ese tipo que aún no se ha revertido, o null. */
const sancionActiva = (guildId, userId, tipo) =>
    db
        .prepare("SELECT * FROM presidencia_sanciones WHERE guildId = ? AND userId = ? AND tipo = ? AND revertida_en IS NULL")
        .get(String(guildId), String(userId), tipo) || null;

/** Las sanciones sin revertir cuyo tiempo ya ha pasado (de todos los servidores). */
const sancionesVencidas = (ahora) =>
    db.prepare("SELECT * FROM presidencia_sanciones WHERE revertida_en IS NULL AND fin <= ? ORDER BY fin, id").all(ahora);

/** Hace que las sanciones sin revertir de un mandato venzan ya (al acabar o al destituir). */
function vencerSancionesDe(eleccionId, ahora) {
    db.prepare("UPDATE presidencia_sanciones SET fin = ? WHERE eleccion_id = ? AND revertida_en IS NULL AND fin > ?").run(
        ahora,
        Number(eleccionId),
        ahora,
    );
}

function marcarRevertida(id, ahora) {
    db.prepare("UPDATE presidencia_sanciones SET revertida_en = ? WHERE id = ? AND revertida_en IS NULL").run(ahora, Number(id));
}

module.exports = {
    registrarAccion,
    ultimaAccionSobre,
    acciones,
    registrarCanal,
    canalesActivos,
    canalActivo,
    marcarCanalBorrado,
    registrarSancion,
    sancionActiva,
    sancionesVencidas,
    vencerSancionesDe,
    marcarRevertida,
};
