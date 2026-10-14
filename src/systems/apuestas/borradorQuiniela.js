// 📝 Borrador de la quiniela (#384): los pronósticos a medio elegir se guardan en la base de datos (uno por persona y quiniela), así que
// el editor los recupera tras un reinicio del bot o al volver a abrirlo. Se borra al apostar, al cancelar y cuando la quiniela se cierra.
const db = require("../../core/db");

/** Los pronósticos como texto: una letra por partido y «-» donde aún no hay pronóstico («1X-2»). */
const aTexto = (pronosticos) => pronosticos.map((p) => p || "-").join("");

/** Guarda (o sustituye) el borrador de una persona en una quiniela. Si no hay ningún pronóstico, no queda borrador. */
function guardar(userId, quinielaId, pronosticos, ahora = Date.now()) {
    if (!pronosticos.some(Boolean)) return borrar(userId, quinielaId);
    db.prepare(
        `INSERT INTO quiniela_borrador (userId, quinielaId, pronosticos, actualizado_en) VALUES (?, ?, ?, ?)
         ON CONFLICT (userId, quinielaId) DO UPDATE SET pronosticos = excluded.pronosticos, actualizado_en = excluded.actualizado_en`,
    ).run(String(userId), Number(quinielaId), aTexto(pronosticos), ahora);
}

/**
 * El borrador de una persona como lista de `partidos` pronósticos (null donde falta), o null si no hay o ya no vale (otro número de
 * partidos o letras que no son 1, X o 2).
 */
function cargar(userId, quinielaId, partidos) {
    const fila = db
        .prepare("SELECT pronosticos FROM quiniela_borrador WHERE userId = ? AND quinielaId = ?")
        .get(String(userId), Number(quinielaId));
    if (!fila || fila.pronosticos.length !== partidos || !/^[1X2-]+$/.test(fila.pronosticos)) return null;
    return [...fila.pronosticos].map((c) => (c === "-" ? null : c));
}

const borrar = (userId, quinielaId) =>
    db.prepare("DELETE FROM quiniela_borrador WHERE userId = ? AND quinielaId = ?").run(String(userId), Number(quinielaId));

/** Borra los borradores de todos en una quiniela (al cerrarse o caducar). */
const borrarDeQuiniela = (quinielaId) => db.prepare("DELETE FROM quiniela_borrador WHERE quinielaId = ?").run(Number(quinielaId));

module.exports = { guardar, cargar, borrar, borrarDeQuiniela };
