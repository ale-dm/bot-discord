// 🙈 Ocultar la economía en el perfil ajeno (#377): quien lo activa no deja ver a los demás su dinero (efectivo, banco, casino,
// cartera, objetos y movimientos) ni en 👤 Perfil ni en 💰 Economía. Él siempre lo ve todo. 🏆 Rankings → Riqueza no cambia.
const db = require("../core/db");

const oculta = (userId) => Boolean(db.prepare("SELECT 1 FROM economia_privada WHERE userId = ?").get(String(userId)));

function fijar(userId, valor) {
    if (valor) db.prepare("INSERT OR IGNORE INTO economia_privada (userId) VALUES (?)").run(String(userId));
    else db.prepare("DELETE FROM economia_privada WHERE userId = ?").run(String(userId));
}

/** ¿Debe ver `viewerId` la economía de `targetId`? Sí si es la suya o no la ha ocultado. */
const puedeVer = (viewerId, targetId) => String(viewerId) === String(targetId) || !oculta(targetId);

module.exports = { oculta, fijar, puedeVer };
