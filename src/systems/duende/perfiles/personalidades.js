// Personalidades del Duende y la personalidad asignada a cada canal (tablas duende_personalidades y duende_canales).
const db = require("../../../core/db");

const instruccionDefault = "Eres un bot de discord asistente , no añadas al principio ni tu nombre ni el de que te hable con los ':'...";
const PERSONALIDADES_INICIALES = [
    { id: "default", title: "Inútil y malhumorado", systemInstructions: instruccionDefault },
    {
        id: "inteligente",
        title: "Inteligente y resolutivo",
        systemInstructions: "Eres un asistente eficiente, claro y resolutivo. Responde con precisión y amabilidad.",
    },
];

// ─── Personalidades ──────────────────────────────────────────────────────────

const aPersonalidad = (r) => r && { id: r.id, title: r.titulo, systemInstructions: r.instrucciones };

function listarPersonalidades() {
    return db
        .prepare("SELECT id, titulo, instrucciones, actualizado_en FROM duende_personalidades ORDER BY rowid")
        .all()
        .map(aPersonalidad);
}

function obtenerPersonalidad(id) {
    if (!id) return null;
    return (
        aPersonalidad(db.prepare("SELECT id, titulo, instrucciones, actualizado_en FROM duende_personalidades WHERE id = ?").get(id)) ||
        null
    );
}

/** @returns {boolean} true si ya existía (se ha actualizado) */
function guardarPersonalidad({ id, title, systemInstructions }) {
    const existia = !!obtenerPersonalidad(id);
    db.prepare(
        `INSERT INTO duende_personalidades (id, titulo, instrucciones, actualizado_en) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, instrucciones = excluded.instrucciones, actualizado_en = excluded.actualizado_en`,
    ).run(id, title, systemInstructions, Date.now());
    return existia;
}

/** @returns {boolean} true si existía */
function borrarPersonalidad(id) {
    return db.transaction(() => {
        db.prepare("DELETE FROM duende_canales WHERE personalidad_id = ?").run(id);
        return db.prepare("DELETE FROM duende_personalidades WHERE id = ?").run(id).changes > 0;
    })();
}

function personalidadDeCanal(channelId) {
    return db.prepare("SELECT personalidad_id FROM duende_canales WHERE channel_id = ?").pluck().get(channelId) || null;
}

function asignarPersonalidadCanal(channelId, personalidadId) {
    db.prepare(
        "INSERT INTO duende_canales (channel_id, personalidad_id) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET personalidad_id = excluded.personalidad_id",
    ).run(channelId, personalidadId);
}

module.exports = {
    instruccionDefault,
    PERSONALIDADES_INICIALES,
    listarPersonalidades,
    obtenerPersonalidad,
    guardarPersonalidad,
    borrarPersonalidad,
    personalidadDeCanal,
    asignarPersonalidadCanal,
};
