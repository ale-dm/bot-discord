// 🤝 Préstamos entre jugadores (#520), con el mismo cobro que los del Duende (#14): quien presta propone cantidad, interés y
// plazo; quien recibe acepta o rechaza (la propuesta caduca a las 24 h). Al aceptar, el dinero pasa del banco de uno al
// banco del otro (solo banco: un contrato con cobro automático necesita dinero rastreable). Se puede devolver antes, entero
// o a plazos, del efectivo. Al vencer, el bot cobra solo, primero del banco y luego del efectivo; lo que falte queda como
// deuda y se reintenta en cada pasada. Un préstamo aceptado no se cancela.
// Límites: interés de 0 a 50 % del total, plazo de 1 a 30 días, como mucho el 25 % del banco de quien presta, 5 préstamos
// abiertos o propuestos por prestamista y 3 abiertos por prestatario. Sin Discord: los DM están en
// discord/envios/prestamosJugadores.js.
const db = require("../core/db");
const dinero = require("./dinero");
const { fmtNumero } = require("../core/formato");

const DIA_MS = 24 * 3600 * 1000;
const INTERES_MAX = 50;
const PLAZO_MAX = 30;
const PCT_BANCO = 25;
const MAX_PRESTAMISTA = 5;
const MAX_PRESTATARIO = 3;
const CADUCA_PROPUESTA_MS = DIA_MS;
/** Con cuánto de antelación se avisa del vencimiento. */
const AVISO_MS = DIA_MS;
const ABIERTOS = "('activo', 'deuda')";

const error = (motivo) => ({ ok: false, motivo });
const entero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

const leer = (p) => (p ? { ...p, falta: p.total - p.pagado } : null);
const obtener = (id) => leer(db.prepare("SELECT * FROM prestamos_jugadores WHERE id = ?").get(Number(id)));

/** Lo que se devuelve por `cantidad` con un `pct` % de interés (redondeado hacia arriba). */
const totalDe = (cantidad, pct) => cantidad + Math.ceil((cantidad * pct) / 100);

const cuenta = (campo, userId, estados) =>
    db.prepare(`SELECT COUNT(*) FROM prestamos_jugadores WHERE ${campo} = ? AND estado IN ${estados}`).pluck().get(String(userId));

/** Por qué no se puede prestar esto, o null. Se comprueba al proponer y otra vez al aceptar. */
function motivoNoPrestar({ prestamista, prestatario, cantidad, interes, dias }, { aceptando = false } = {}) {
    if (String(prestamista) === String(prestatario)) return "No puedes prestarte dinero a ti mismo.";
    if (!entero(interes, 0, INTERES_MAX)) return `El interés va de 0 a ${INTERES_MAX} %.`;
    if (!entero(dias, 1, PLAZO_MAX)) return `El plazo va de 1 a ${PLAZO_MAX} días.`;
    const errorCantidad = dinero.validarCantidad(cantidad);
    if (errorCantidad) return errorCantidad;
    const tope = Math.floor((dinero.cuenta(prestamista).banco * PCT_BANCO) / 100);
    if (cantidad > tope) return `Como mucho puedes prestar el ${PCT_BANCO} % de lo que tienes en el banco (**${fmtNumero(tope)}** 🪙).`;
    if (!aceptando && cuenta("prestamista", prestamista, "('propuesto', 'activo', 'deuda')") >= MAX_PRESTAMISTA) {
        return `Ya tienes ${MAX_PRESTAMISTA} préstamos dados o propuestos.`;
    }
    if (cuenta("prestatario", prestatario, ABIERTOS) >= MAX_PRESTATARIO) return `Esa persona ya debe ${MAX_PRESTATARIO} préstamos.`;
    return null;
}

/** Propone un préstamo (no mueve dinero todavía). @returns {{ ok: true, prestamo } | { ok: false, motivo }} */
function proponer({ guildId, prestamista, prestatario, cantidad, interes, dias }, ahora = Date.now()) {
    const motivo = motivoNoPrestar({ prestamista, prestatario, cantidad, interes, dias });
    if (motivo) return error(motivo);
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO prestamos_jugadores (guildId, prestamista, prestatario, cantidad, interes_pct, total, plazo_dias, creado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(String(guildId), String(prestamista), String(prestatario), cantidad, interes, totalDe(cantidad, interes), dias, ahora);
    return { ok: true, prestamo: obtener(lastInsertRowid) };
}

/** Acepta la propuesta: el dinero pasa del banco de quien presta al banco de quien recibe, una sola vez. */
function aceptar(id, userId, ahora = Date.now()) {
    return db.transaction(() => {
        const p = obtener(id);
        if (!p || p.estado !== "propuesto") return error("Esa propuesta ya no está pendiente.");
        if (p.prestatario !== String(userId)) return error("Esa propuesta no es para ti.");
        if (ahora - p.creado_en > CADUCA_PROPUESTA_MS) return error("Esa propuesta ha caducado.");
        const motivo = motivoNoPrestar(
            { prestamista: p.prestamista, prestatario: p.prestatario, cantidad: p.cantidad, interes: p.interes_pct, dias: p.plazo_dias },
            { aceptando: true },
        );
        if (motivo) return error(motivo);
        if (!dinero.cobrarBanco(p.prestamista, p.cantidad)) return error("A quien presta ya no le llega el banco.");
        dinero.pagarBanco(p.prestatario, p.cantidad);
        dinero.apuntar(p.prestamista, "prestamo", `Préstamo #${p.id} a ${p.prestatario} (del banco)`, -p.cantidad);
        dinero.apuntar(
            p.prestatario,
            "prestamo",
            `Préstamo #${p.id} de ${p.prestamista} (al banco; devuelves ${fmtNumero(p.total)})`,
            p.cantidad,
        );
        db.prepare("UPDATE prestamos_jugadores SET estado = 'activo', aceptado_en = ?, vence_en = ? WHERE id = ?").run(
            ahora,
            ahora + p.plazo_dias * DIA_MS,
            p.id,
        );
        return { ok: true, prestamo: obtener(p.id) };
    })();
}

/** Rechaza (quien recibe) o cancela (quien propone) una propuesta pendiente. */
function descartar(id, userId, ahora = Date.now()) {
    const p = obtener(id);
    if (!p || p.estado !== "propuesto") return error("Esa propuesta ya no está pendiente.");
    const estado = p.prestatario === String(userId) ? "rechazado" : p.prestamista === String(userId) ? "cancelado" : null;
    if (!estado) return error("Esa propuesta no es tuya.");
    db.prepare("UPDATE prestamos_jugadores SET estado = ?, cerrado_en = ? WHERE id = ? AND estado = 'propuesto'").run(estado, ahora, p.id);
    return { ok: true, prestamo: obtener(p.id) };
}

/** Apunta lo cobrado, lo lleva al banco de quien prestó y cierra el préstamo si ya está todo. */
function registrarCobro(p, cantidad, ahora, origen) {
    dinero.pagarBanco(p.prestamista, cantidad);
    dinero.apuntar(p.prestamista, "prestamo", `Cobro del préstamo #${p.id} (al banco)`, cantidad);
    dinero.apuntar(p.prestatario, "prestamo", `Pago del préstamo #${p.id} (${origen})`, -cantidad);
    const pagado = p.pagado + cantidad;
    const cerrado = pagado >= p.total;
    db.prepare("UPDATE prestamos_jugadores SET pagado = ?, estado = ?, cerrado_en = ? WHERE id = ?").run(
        pagado,
        cerrado ? "devuelto" : p.estado,
        cerrado ? ahora : null,
        p.id,
    );
}

/** Devuelve antes de tiempo, del efectivo: todo lo que falta o `cantidad` (a plazos). */
function pagar(id, userId, cantidad = null, ahora = Date.now()) {
    return db.transaction(() => {
        const p = obtener(id);
        if (!p || !["activo", "deuda"].includes(p.estado)) return error("Ese préstamo ya no está abierto.");
        if (p.prestatario !== String(userId)) return error("Ese préstamo no lo debes tú.");
        const importe = cantidad === null ? p.falta : cantidad;
        if (!entero(importe, 1, p.falta)) return error(`Puedes pagar de 1 a ${fmtNumero(p.falta)} 🪙.`);
        if (!dinero.cobrar(userId, importe)) return error("No te llega el efectivo. Saca del banco primero.");
        registrarCobro(p, importe, ahora, "del efectivo");
        return { ok: true, prestamo: obtener(p.id), pagado: importe };
    })();
}

/** Cobra lo que se pueda de un préstamo vencido: primero del banco y luego del efectivo. Lo que falte queda como deuda. */
function cobrarVencido(id, ahora) {
    return db.transaction(() => {
        const p = obtener(id);
        if (!p || !["activo", "deuda"].includes(p.estado) || p.vence_en > ahora) return null;
        const c = dinero.cuenta(p.prestatario);
        let cobrado = 0;
        const deBanco = Math.min(p.falta, c.banco);
        if (deBanco > 0 && dinero.cobrarBanco(p.prestatario, deBanco)) {
            registrarCobro(p, deBanco, ahora, "cobro automático del banco");
            cobrado += deBanco;
        }
        const resto = obtener(p.id);
        const deEfectivo = Math.min(resto.falta, c.efectivo);
        if (deEfectivo > 0 && dinero.cobrar(p.prestatario, deEfectivo)) {
            registrarCobro(resto, deEfectivo, ahora, "cobro automático del efectivo");
            cobrado += deEfectivo;
        }
        const final = obtener(p.id);
        const pasaADeuda = final.falta > 0 && final.estado === "activo";
        if (pasaADeuda) db.prepare("UPDATE prestamos_jugadores SET estado = 'deuda' WHERE id = ?").run(p.id);
        return { prestamo: obtener(p.id), cobrado, pasaADeuda, eraDeuda: p.estado === "deuda" };
    })();
}

/**
 * Cron: caduca las propuestas de más de 24 h, cobra los vencidos (y reintenta las deudas) y marca los que hay que avisar.
 * @returns {{ cobros: object[], avisar: object[], caducadas: number }}
 */
function revisar(ahora = Date.now()) {
    const caducadas = db
        .prepare("UPDATE prestamos_jugadores SET estado = 'caducado', cerrado_en = ? WHERE estado = 'propuesto' AND creado_en <= ?")
        .run(ahora, ahora - CADUCA_PROPUESTA_MS).changes;
    const cobros = db
        .prepare(`SELECT id FROM prestamos_jugadores WHERE estado IN ${ABIERTOS} AND vence_en <= ? ORDER BY vence_en, id`)
        .pluck()
        .all(ahora)
        .map((id) => cobrarVencido(id, ahora))
        .filter((r) => r && (r.cobrado > 0 || r.pasaADeuda));
    const avisar = db
        .prepare("SELECT * FROM prestamos_jugadores WHERE estado = 'activo' AND avisado = 0 AND vence_en > ? AND vence_en <= ?")
        .all(ahora, ahora + AVISO_MS)
        .map(leer);
    for (const p of avisar) db.prepare("UPDATE prestamos_jugadores SET avisado = 1 WHERE id = ?").run(p.id);
    return { cobros, avisar, caducadas };
}

/** Los préstamos de alguien que siguen vivos (propuestos, activos o en deuda), dados y recibidos. */
function deUsuario(userId) {
    const filas = db
        .prepare(
            `SELECT * FROM prestamos_jugadores WHERE (prestamista = ? OR prestatario = ?) AND estado IN ('propuesto', 'activo', 'deuda')
             ORDER BY estado = 'propuesto' DESC, COALESCE(vence_en, creado_en), id`,
        )
        .all(String(userId), String(userId))
        .map(leer);
    return {
        dados: filas.filter((p) => p.prestamista === String(userId)),
        recibidos: filas.filter((p) => p.prestatario === String(userId)),
    };
}

/** Los últimos préstamos cerrados de alguien (para el historial). */
const historial = (userId, limite = 10) =>
    db
        .prepare(
            `SELECT * FROM prestamos_jugadores WHERE (prestamista = ? OR prestatario = ?) AND estado NOT IN ('propuesto', 'activo', 'deuda')
             ORDER BY COALESCE(cerrado_en, creado_en) DESC, id DESC LIMIT ?`,
        )
        .all(String(userId), String(userId), limite)
        .map(leer);

module.exports = {
    DIA_MS,
    INTERES_MAX,
    PLAZO_MAX,
    PCT_BANCO,
    MAX_PRESTAMISTA,
    MAX_PRESTATARIO,
    CADUCA_PROPUESTA_MS,
    totalDe,
    obtener,
    motivoNoPrestar,
    proponer,
    aceptar,
    descartar,
    pagar,
    cobrarVencido,
    revisar,
    deUsuario,
    historial,
};
