// SQL del diagnóstico del panel de admin → 🩺 Sistema: usuarios del banco y estado del registro de precios de TTCL (#473).
const db = require("../core/db");

const usuariosDelBanco = () => db.prepare("SELECT COUNT(*) as total FROM banco").get()?.total || 0;
const ultimoPrecioTtcl = () => db.prepare("SELECT precio, timestamp FROM cripto_ttcl_precios ORDER BY timestamp DESC LIMIT 1").get();
const puntosDePrecio = () => db.prepare("SELECT COUNT(*) as total FROM cripto_ttcl_precios").get()?.total || 0;
const puntosDePrecioDesde = (desde) =>
    db.prepare("SELECT COUNT(*) as total FROM cripto_ttcl_precios WHERE timestamp >= ?").get(desde)?.total || 0;
const tenedoresDeTtcl = () =>
    db.prepare("SELECT COUNT(DISTINCT userId) as total FROM cripto_carteras WHERE cripto = 'TTCL' AND cantidad > 0").get()?.total || 0;
const ttclEnCarteras = () =>
    db.prepare("SELECT COALESCE(SUM(cantidad), 0) as total FROM cripto_carteras WHERE cripto = 'TTCL'").get()?.total || 0;

module.exports = { usuariosDelBanco, ultimoPrecioTtcl, puntosDePrecio, puntosDePrecioDesde, tenedoresDeTtcl, ttclEnCarteras };
