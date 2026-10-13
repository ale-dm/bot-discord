// Contraoferta de cantidad (#442): en vez de aceptar o rechazar un reto, el rival propone otra cantidad. Solo una por reto.
// Quien retó decide: si la acepta, se le cobra o devuelve la diferencia, el rival paga la nueva cantidad y el reto empieza;
// si cancela, el reto se devuelve como siempre (lo cobrado al crearlo es la cantidad original, que no cambia hasta aceptar).
const db = require("../../core/db");
const dinero = require("../dinero");
const { createLogger } = require("../../core/logger");
const { error, SinEfectivo, descripcion } = require("./comun");
const { obtener } = require("./persistencia");
const { unir } = require("./cobros");
const { validarCantidad } = require("./crear");
const { empezar, comprobarPartido } = require("./duelos");

const log = createLogger("Retos");

/** El rival propone otra cantidad. */
function contraofertar(retoId, userId, cantidad) {
    const reto = obtener(retoId);
    if (!reto || !["partido", "duelo"].includes(reto.tipo)) return error("❌ Ese reto ya no existe.");
    if (reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.rival !== String(userId)) return error("⛔ Este reto no es para ti.");
    if (reto.contraoferta) return error("💬 Ya has hecho una contraoferta en este reto: solo se permite una.");
    if (reto.expira_en && reto.expira_en <= Date.now()) return error("⌛ Este reto ha caducado.");
    const invalida = validarCantidad(cantidad);
    if (invalida) return error(invalida);
    if (cantidad === reto.cantidad) return error("💬 Esa es la cantidad del reto: si te encaja, acéptalo.");
    const r = db
        .prepare("UPDATE retos SET contraoferta = ?, actualizado_en = ? WHERE id = ? AND estado = 'pendiente' AND contraoferta IS NULL")
        .run(cantidad, Date.now(), reto.id);
    if (r.changes !== 1) return error("Este reto ya no está pendiente.");
    log.info(`Reto ${reto.id}: ${userId} propone ${cantidad} en vez de ${reto.cantidad}`);
    return { ok: true, reto: obtener(reto.id) };
}

/**
 * Quien retó acepta la contraoferta: ajusta lo que puso (cobra o devuelve la diferencia), cobra la nueva cantidad al rival
 * y empieza el reto. Si a alguno de los dos no le llega el efectivo, no cambia nada y el reto sigue pendiente.
 */
function aceptarContraoferta(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || !["partido", "duelo"].includes(reto.tipo)) return error("❌ Ese reto ya no existe.");
    if (reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.creador !== String(userId)) return error("⛔ Solo quien lanzó el reto puede aceptar la contraoferta.");
    if (!reto.contraoferta) return error("💬 Este reto no tiene ninguna contraoferta.");
    if (reto.expira_en && reto.expira_en <= Date.now()) return error("⌛ Este reto ha caducado.");
    const parado = comprobarPartido(reto);
    if (parado) return error(parado);
    const nueva = reto.contraoferta;
    const diferencia = nueva - reto.cantidad;
    try {
        db.transaction(() => {
            if (diferencia > 0) {
                if (!dinero.cobrar(reto.creador, diferencia)) throw new SinEfectivo("creador");
                dinero.apuntar(reto.creador, "retos", `Reto: ${descripcion(reto)} (contraoferta, más)`, -diferencia);
            } else if (diferencia < 0) {
                dinero.pagar(reto.creador, -diferencia);
                dinero.apuntar(reto.creador, "retos", `Reto: ${descripcion(reto)} (contraoferta, devolución)`, -diferencia);
            }
            const r = db
                .prepare(
                    "UPDATE retos SET estado = 'en_juego', cantidad = ?, contraoferta = NULL, actualizado_en = ? WHERE id = ? AND estado = 'pendiente'",
                )
                .run(nueva, Date.now(), reto.id);
            if (r.changes !== 1) throw new Error("carrera");
            db.prepare("UPDATE retos_participantes SET cantidad = ? WHERE reto_id = ? AND userId = ?").run(nueva, reto.id, reto.creador);
            const actual = obtener(reto.id);
            if (!unir(actual, reto.rival, actual.tipo === "partido" ? "en_contra" : null)) throw new SinEfectivo("rival");
            empezar(actual);
        })();
    } catch (e) {
        if (e instanceof SinEfectivo && e.message === "creador") {
            return error(
                `❌ No te llega el efectivo para la nueva cantidad (${nueva.toLocaleString("es")} 🪙). Saca dinero del banco o cancela el reto.`,
            );
        }
        if (e instanceof SinEfectivo) return error("❌ A tu rival ya no le llega el efectivo para esa cantidad.");
        if (e.message === "carrera") return error("Este reto ya no está pendiente.");
        throw e;
    }
    log.info(`Reto ${reto.id}: contraoferta de ${nueva} aceptada por ${userId}`);
    return { ok: true, reto: obtener(reto.id) };
}

module.exports = { contraofertar, aceptarContraoferta };
