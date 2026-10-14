// Contadores diarios del Duende que sobreviven a un reinicio (#371, #408): una fila por clave y día (hora de Madrid). Una clave es
// «chat:global», «chat:{persona}» o «imagen:{persona}». Un límite de 0 (o menos) apaga ese tope y no cuenta nada.
const db = require("../../core/db");
const { madridDateStr } = require("../xp/rachas");
const { fechaMadridAMs, sumarDias } = require("../../core/zonaMadrid");

const diaActual = (ahora = Date.now()) => madridDateStr(new Date(ahora));

/** Cuánto se ha gastado de una clave hoy. */
const usadas = (clave, ahora = Date.now()) =>
    db.prepare("SELECT n FROM duende_cuotas WHERE clave = ? AND dia = ?").get(clave, diaActual(ahora))?.n ?? 0;

/** Cuándo se reinician los contadores: la próxima medianoche de Madrid, en segundos Unix (para <t:…:R>). */
function reinicio(ahora = Date.now()) {
    const [a, m, d] = sumarDias(diaActual(ahora), 1).split("-");
    return Math.floor(fechaMadridAMs(`${d}/${m}/${a} 00:00`) / 1000);
}

/**
 * Gasta una unidad de cada tope a la vez, o ninguna: `topes` es [[clave, límite], …]. Si alguno ya está lleno, no cuenta nada y
 * devuelve su posición. @returns {{ ok: true } | { ok: false, indice: number }}
 */
function consumir(topes, ahora = Date.now()) {
    const dia = diaActual(ahora);
    return db.transaction(() => {
        for (let i = 0; i < topes.length; i++) {
            const [clave, limite] = topes[i];
            if (limite > 0 && usadas(clave, ahora) >= limite) return { ok: false, indice: i };
        }
        for (const [clave, limite] of topes) {
            if (!(limite > 0)) continue;
            db.prepare("INSERT INTO duende_cuotas (clave, dia, n) VALUES (?, ?, 1) ON CONFLICT(clave, dia) DO UPDATE SET n = n + 1").run(
                clave,
                dia,
            );
        }
        return { ok: true };
    })();
}

/** Devuelve una unidad de una clave (un fallo de la API no consume cupo). */
function devolver(clave, ahora = Date.now()) {
    db.prepare("UPDATE duende_cuotas SET n = MAX(0, n - 1) WHERE clave = ? AND dia = ?").run(clave, diaActual(ahora));
}

/** Borra los contadores de hace más de una semana. */
function limpiar(ahora = Date.now()) {
    return db.prepare("DELETE FROM duende_cuotas WHERE dia < ?").run(sumarDias(diaActual(ahora), -7)).changes;
}

module.exports = { diaActual, usadas, reinicio, consumir, devolver, limpiar };
