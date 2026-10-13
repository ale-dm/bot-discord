// 🔒 Autoexclusión del casino (#463): quien se la pone no puede jugar a nada del casino durante 1 día, 1 semana o 1 mes. No
// es el límite de pérdidas: bloquea jugar por completo. No se puede levantar antes de la fecha de fin desde el bot (ni
// siquiera un admin), y al llegar esa fecha el casino vuelve solo: no hay nada que borrar. Es global, como el dinero.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Casino");

const DIA_MS = 24 * 60 * 60 * 1000;
/** Los periodos que se pueden elegir. */
const PERIODOS = {
    dia: { nombre: "1 día", ms: DIA_MS },
    semana: { nombre: "1 semana", ms: 7 * DIA_MS },
    mes: { nombre: "1 mes", ms: 30 * DIA_MS },
};

/** Cuándo acaba la autoexclusión (ms), o null si no tiene ninguna en vigor. */
function hastaDe(userId, ahora = Date.now()) {
    const fila = db.prepare("SELECT hasta FROM casino_autoexclusion WHERE userId = ?").get(String(userId));
    return fila && fila.hasta > ahora ? fila.hasta : null;
}

/** El texto de la fecha de fin, con la hora de Discord de cada cual. */
function textoHasta(hasta) {
    const unix = Math.floor(hasta / 1000);
    return `<t:${unix}:F> (<t:${unix}:R>)`;
}

/** El mensaje que ve quien intenta jugar estando autoexcluido, o null si puede jugar. */
function mensajeBloqueo(userId, ahora = Date.now()) {
    const hasta = hastaDe(userId, ahora);
    if (!hasta) return null;
    return `🔒 Estás autoexcluido del casino hasta ${textoHasta(hasta)}. No puedes jugar hasta entonces.`;
}

/**
 * Activa la autoexclusión por el periodo elegido. No se puede cambiar ni acortar una que esté en vigor.
 * @returns {{ ok: true, hasta: number } | { ok: false, mensaje: string }}
 */
function activar(userId, periodo, ahora = Date.now()) {
    const p = PERIODOS[periodo];
    if (!p) return { ok: false, mensaje: "❌ Ese periodo no existe: elige 1 día, 1 semana o 1 mes." };
    const actual = hastaDe(userId, ahora);
    if (actual)
        return { ok: false, mensaje: `🔒 Ya estás autoexcluido hasta ${textoHasta(actual)}. No se puede cambiar antes de que acabe.` };
    const hasta = ahora + p.ms;
    db.prepare(
        "INSERT INTO casino_autoexclusion (userId, hasta, desde) VALUES (?, ?, ?) ON CONFLICT(userId) DO UPDATE SET hasta = excluded.hasta, desde = excluded.desde",
    ).run(String(userId), hasta, ahora);
    log.info(`Autoexclusión: ${userId} se excluye ${p.nombre} (hasta ${new Date(hasta).toISOString()})`);
    return { ok: true, hasta };
}

module.exports = { PERIODOS, hastaDe, textoHasta, mensajeBloqueo, activar };
