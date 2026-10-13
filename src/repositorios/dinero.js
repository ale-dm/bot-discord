// SQL del dinero que usan los paneles y el panel de admin: cuentas (banco) e historial. Las reglas de dónde va el dinero están
// en systems/dinero; aquí solo las consultas, tal cual (#473).
const db = require("../core/db");

const historialGlobal = (limite, desplazamiento) =>
    db
        .prepare("SELECT userId, fecha, descripcion, cantidad FROM historial ORDER BY fecha DESC LIMIT ? OFFSET ?")
        .all(limite, desplazamiento);
const totalMovimientos = () => db.prepare("SELECT COUNT(*) as total FROM historial").get().total || 0;
const ultimosMovimientos = (userId, n) =>
    db.prepare("SELECT fecha, descripcion, cantidad FROM historial WHERE userId = ? ORDER BY fecha DESC LIMIT ?").all(userId, n);
const borrarHistorial = (userId) => db.prepare("DELETE FROM historial WHERE userId = ?").run(userId);

/** Deja la cuenta como una nueva: `efectivo` en mano, banco vacío y sin dinero negro. */
const resetearCuenta = (userId, efectivo) =>
    db.prepare("UPDATE banco SET saldo = 0, enMano = ?, negro = 0 WHERE userId = ?").run(efectivo, userId);

const COLUMNAS = { banco: "saldo", negro: "negro", efectivo: "enMano" };
/** Suma (o resta, con una cantidad negativa) al banco, al dinero negro o al efectivo. */
function sumarA(destino, cantidad, userId) {
    const columna = COLUMNAS[destino] || COLUMNAS.efectivo;
    return db.prepare(`UPDATE banco SET ${columna} = ${columna} + ? WHERE userId = ?`).run(cantidad, userId);
}

const resumenCuenta = (userId) => db.prepare("SELECT saldo, enMano, negro FROM banco WHERE userId = ?").get(userId);
const totalCuentas = () => db.prepare("SELECT COUNT(*) as total FROM banco").get()?.total || 0;
const sumaBanco = () => db.prepare("SELECT SUM(saldo) as total FROM banco").get().total || 0;
const sumaEfectivo = () => db.prepare("SELECT SUM(enMano) as total FROM banco").get().total || 0;
const objetosEnInventario = (userId) => db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ?").get(userId).n;
const resumenCasino = (userId) => db.prepare("SELECT ganado, perdido FROM casino_resumen WHERE userId = ?").get(String(userId));

/** Asegura que la persona existe en `usuarios` (sin tocarla si ya estaba). */
const registrarUsuario = (id, nombre, tag, fecha) =>
    db.prepare("INSERT OR IGNORE INTO usuarios (id, nombre, tag, fechaRegistro) VALUES (?, ?, ?, ?)").run(id, nombre, tag, fecha);
const canalLegadoTienda = () => db.prepare("SELECT valor FROM config WHERE clave = 'tienda_canal_notif'").get()?.valor;

module.exports = {
    historialGlobal,
    totalMovimientos,
    ultimosMovimientos,
    borrarHistorial,
    resetearCuenta,
    sumarA,
    resumenCuenta,
    totalCuentas,
    sumaBanco,
    sumaEfectivo,
    objetosEnInventario,
    resumenCasino,
    registrarUsuario,
    canalLegadoTienda,
};
