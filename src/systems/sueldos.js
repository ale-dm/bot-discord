// 🧾 Sueldo diario por rol de Discord (#416): un admin asigna un sueldo a cada rol y cada día (hora de Madrid) el bot lo paga a quien
// lo tenga. Quien tiene varios roles con sueldo cobra la suma. El pago va al efectivo con el impuesto de ingresos del servidor.
// El registro de lo pagado está en la base de datos, así que se cobra una sola vez al día aunque el bot se reinicie. Quien pierde
// el rol deja de cobrar al día siguiente, sin efectos retroactivos.
const db = require("../core/db");
const dinero = require("./dinero");
const { madridDateStr } = require("./xp/rachas");

const SUELDO_MAX = 1_000_000;

/** Fija el sueldo diario de un rol (0 lo quita). @returns {{ ok: boolean, mensaje: string }} */
function fijar(guildId, roleId, cantidad) {
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > SUELDO_MAX) {
        return { ok: false, mensaje: `❌ El sueldo tiene que ser un entero entre 0 y ${SUELDO_MAX.toLocaleString("es")}.` };
    }
    if (cantidad === 0) {
        db.prepare("DELETE FROM sueldos_rol WHERE guildId = ? AND roleId = ?").run(guildId, roleId);
        return { ok: true, mensaje: "✅ Sueldo quitado." };
    }
    db.prepare(
        "INSERT INTO sueldos_rol (guildId, roleId, cantidad) VALUES (?, ?, ?) ON CONFLICT(guildId, roleId) DO UPDATE SET cantidad = excluded.cantidad",
    ).run(guildId, roleId, cantidad);
    return { ok: true, mensaje: `✅ Sueldo diario del rol: ${cantidad.toLocaleString("es")} 🪙.` };
}

const listar = (guildId) => db.prepare("SELECT roleId, cantidad FROM sueldos_rol WHERE guildId = ? ORDER BY cantidad DESC").all(guildId);

/**
 * Paga el sueldo del día a quien le toque y aún no lo haya cobrado hoy. `miembros`: GuildMembers (o algo con `id`, `user.bot` y
 * `roles.cache`). @returns {{ pagados: number, total: number }}
 */
function pagarDia(guildId, miembros, ahora = Date.now()) {
    const sueldos = new Map(listar(guildId).map((s) => [s.roleId, s.cantidad]));
    if (!sueldos.size) return { pagados: 0, total: 0 };
    const dia = madridDateStr(new Date(ahora));
    let pagados = 0;
    let total = 0;
    for (const m of miembros) {
        if (m.user?.bot) continue;
        let suma = 0;
        for (const roleId of m.roles?.cache?.keys?.() ?? []) suma += sueldos.get(roleId) || 0;
        if (suma <= 0) continue;
        db.transaction(() => {
            const r = db
                .prepare("INSERT OR IGNORE INTO sueldos_pagos (guildId, userId, dia, cantidad) VALUES (?, ?, ?, ?)")
                .run(guildId, m.id, dia, suma);
            if (r.changes !== 1) return;
            dinero.pagarConImpuesto(m.id, guildId, "sueldo", "Sueldo diario por rol", suma);
            pagados++;
            total += suma;
        })();
    }
    return { pagados, total };
}

module.exports = { SUELDO_MAX, fijar, listar, pagarDia };
