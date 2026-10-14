// 🔔 Órdenes de TTCL: alertas de precio por DM (#298), stop-loss (#341) y compras recurrentes (#351). Un cron cada minuto las revisa
// (`revisar`). Cada alerta salta una sola vez y se borra (si el DM falla, se mantiene y se anota en el log); un stop-loss vende toda
// la posición una sola vez con el mismo cálculo, comisión y límites que una venta manual; una compra recurrente compra con las
// reglas de una compra manual y, si falla (sin efectivo, cooldown, límites), se salta el ciclo y avisa con la fecha del siguiente
// intento (nunca saca dinero del banco). Se pueden tener hasta MAX_POR_TIPO activas de cada tipo; cancelar no tiene cooldown.
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const mercado = require("./mercado");

const log = createLogger("Cripto");

const MAX_POR_TIPO = 5;
const PERIODO_MIN_HORAS = 1;
const PERIODO_MAX_HORAS = 24 * 30;

const SELECT = "SELECT id, userId, guildId, tipo, precio, sobre, monedas, periodo_min, proxima, estado, creada FROM cripto_ordenes";

const activasDe = (userId, tipo) =>
    db
        .prepare(`${SELECT} WHERE userId = ? AND estado = 'activa' ${tipo ? "AND tipo = ?" : ""} ORDER BY id`)
        .all(...(tipo ? [String(userId), tipo] : [String(userId)]));

function crear(orden) {
    const info = db
        .prepare(
            "INSERT INTO cripto_ordenes (userId, guildId, tipo, precio, sobre, monedas, periodo_min, proxima, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
            String(orden.userId),
            orden.guildId,
            orden.tipo,
            orden.precio ?? null,
            orden.sobre ? 1 : 0,
            orden.monedas ?? null,
            orden.periodoMin ?? null,
            orden.proxima ?? null,
            Date.now(),
        );
    return db.prepare(`${SELECT} WHERE id = ?`).get(info.lastInsertRowid);
}

function conLimite(userId, tipo) {
    return activasDe(userId, tipo).length >= MAX_POR_TIPO
        ? { ok: false, mensaje: `❌ Ya tienes ${MAX_POR_TIPO} de este tipo. Cancela alguna.` }
        : null;
}

/** Una alerta: salta cuando el precio sube hasta `precio` (si está por encima del actual) o baja hasta él (si está por debajo). */
function crearAlerta(userId, guildId, precio) {
    const actual = mercado.getTtclPrecio();
    if (!(precio > 0) || !Number.isFinite(precio)) return { ok: false, mensaje: "❌ El precio tiene que ser un número mayor que 0." };
    if (Math.abs(precio - actual) < 0.005) return { ok: false, mensaje: "❌ Ese es el precio de ahora mismo: elige uno distinto." };
    const limite = conLimite(userId, "alerta");
    if (limite) return limite;
    const sobre = precio > actual;
    const orden = crear({ userId, guildId, tipo: "alerta", precio, sobre });
    return {
        ok: true,
        orden,
        mensaje: `🔔 Te aviso por DM cuando el TTCL ${sobre ? "suba hasta" : "baje hasta"} **${mercado.formatCoins(precio)}** monedas (ahora ${mercado.formatCoins(actual)}).`,
    };
}

/** Un stop-loss: vende toda la posición cuando el precio baje hasta `precio` (tiene que estar por debajo del actual). */
function crearStopLoss(userId, guildId, precio) {
    const actual = mercado.getTtclPrecio();
    if (!(precio > 0) || !Number.isFinite(precio)) return { ok: false, mensaje: "❌ El precio tiene que ser un número mayor que 0." };
    if (precio >= actual)
        return { ok: false, mensaje: `❌ El stop-loss tiene que estar por debajo del precio actual (${mercado.formatCoins(actual)}).` };
    const limite = conLimite(userId, "stoploss");
    if (limite) return limite;
    const orden = crear({ userId, guildId, tipo: "stoploss", precio });
    return {
        ok: true,
        orden,
        mensaje: `🛡️ Si el TTCL baja hasta **${mercado.formatCoins(precio)}** monedas, vendo toda tu posición (con la comisión de una venta normal).`,
    };
}

/** Una compra recurrente de `monedas` cada `horas` horas; la primera, dentro de un periodo. */
function crearRecurrente(userId, guildId, monedas, horas, ahora = Date.now()) {
    if (!Number.isInteger(monedas) || monedas < 1)
        return { ok: false, mensaje: "❌ El importe tiene que ser un número entero de monedas." };
    if (!Number.isInteger(horas) || horas < PERIODO_MIN_HORAS || horas > PERIODO_MAX_HORAS) {
        return { ok: false, mensaje: `❌ El periodo va de ${PERIODO_MIN_HORAS} hora a ${PERIODO_MAX_HORAS / 24} días (en horas).` };
    }
    const limite = conLimite(userId, "recurrente");
    if (limite) return limite;
    const orden = crear({ userId, guildId, tipo: "recurrente", monedas, periodoMin: horas * 60, proxima: ahora + horas * 3600000 });
    return {
        ok: true,
        orden,
        mensaje: `🔁 Compraré **${monedas.toLocaleString("es")}** monedas de TTCL cada ${horas} h, empezando <t:${Math.floor(orden.proxima / 1000)}:R>.`,
    };
}

/** Cancela una orden propia. */
function cancelar(userId, id) {
    return (
        db
            .prepare("UPDATE cripto_ordenes SET estado = 'cancelada' WHERE id = ? AND userId = ? AND estado = 'activa'")
            .run(id, String(userId)).changes === 1
    );
}

const marcar = (id, estado) => db.prepare("UPDATE cripto_ordenes SET estado = ? WHERE id = ?").run(estado, id);
const reclamar = (id, de, a) => db.prepare("UPDATE cripto_ordenes SET estado = ? WHERE id = ? AND estado = ?").run(a, id, de).changes === 1;

/**
 * Cron (cada minuto). `avisar(userId, payload)` manda un DM y devuelve si llegó; `mensajes` pone los textos:
 * { alerta(orden, precio), stoploss(orden, r), recurrente(orden, r, proxima) } (vienen de src/discord/mensajes).
 * @returns {Promise<{ alertas: number, stoploss: number, compras: number }>}
 */
async function revisar(avisar, mensajes, ahora = Date.now()) {
    const precio = mercado.getTtclPrecio();
    const hecho = { alertas: 0, stoploss: 0, compras: 0 };
    for (const o of db.prepare(`${SELECT} WHERE estado = 'activa' ORDER BY id`).all()) {
        try {
            if (o.tipo === "alerta") hecho.alertas += (await revisarAlerta(o, precio, avisar, mensajes)) ? 1 : 0;
            else if (o.tipo === "stoploss") hecho.stoploss += (await revisarStopLoss(o, precio, avisar, mensajes)) ? 1 : 0;
            else if (o.tipo === "recurrente" && o.proxima <= ahora)
                hecho.compras += (await ejecutarRecurrente(o, avisar, mensajes, ahora)) ? 1 : 0;
        } catch (e) {
            log.warn(`Error revisando la orden #${o.id} de TTCL: ${e.message}`);
        }
    }
    return hecho;
}

async function revisarAlerta(o, precio, avisar, mensajes) {
    if (!(o.sobre ? precio >= o.precio : precio <= o.precio)) return false;
    if (!(await avisar(o.userId, mensajes.alerta(o, precio)))) {
        log.warn(`La alerta #${o.id} de TTCL de ${o.userId} saltó pero no se pudo avisar por DM: se mantiene`);
        return false;
    }
    db.prepare("DELETE FROM cripto_ordenes WHERE id = ?").run(o.id);
    return true;
}

const reintentos = new Set();

async function revisarStopLoss(o, precio, avisar, mensajes) {
    if (precio > o.precio || !reclamar(o.id, "activa", "ejecutando")) return false;
    const r = await mercado.ejecutarVenta(o.guildId, o.userId, mercado.TTCL.simbolo, 100);
    if (r.ok) {
        marcar(o.id, "ejecutada");
        await avisar(o.userId, mensajes.stoploss(o, r));
        return true;
    }
    if (/no tienes esa cripto/i.test(r.msg)) {
        // Sin TTCL no hay nada que vender: la orden se cancela.
        marcar(o.id, "cancelada");
        await avisar(o.userId, mensajes.stoploss(o, r));
        return false;
    }
    marcar(o.id, "activa"); // cooldown, límites, pausa…: se reintenta en el siguiente minuto
    if (!reintentos.has(o.id)) {
        reintentos.add(o.id);
        log.warn(`El stop-loss #${o.id} de ${o.userId} no ha podido vender (${r.msg}); se reintenta cada minuto`);
    }
    return false;
}

async function ejecutarRecurrente(o, avisar, mensajes, ahora) {
    const proxima = ahora + o.periodo_min * 60000;
    // Se adelanta la fecha antes de comprar: dos pasadas a la vez no pueden comprar dos veces el mismo ciclo.
    const r0 = db
        .prepare("UPDATE cripto_ordenes SET proxima = ? WHERE id = ? AND estado = 'activa' AND proxima = ?")
        .run(proxima, o.id, o.proxima);
    if (r0.changes !== 1) return false;
    const r = await mercado.ejecutarCompra(o.guildId, o.userId, mercado.TTCL.simbolo, o.monedas);
    if (!r.ok) await avisar(o.userId, mensajes.recurrente(o, r, proxima));
    return r.ok;
}

module.exports = {
    MAX_POR_TIPO,
    PERIODO_MIN_HORAS,
    activasDe,
    crearAlerta,
    crearStopLoss,
    crearRecurrente,
    cancelar,
    revisar,
};
