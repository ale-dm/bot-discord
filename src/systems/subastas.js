// 🔨 Casa de subastas de objetos (#519). Complementa el mercado a precio fijo (#374): se subasta un objeto transferible del
// inventario con un precio de salida, un incremento mínimo y una duración de 24 o 48 horas. El objeto queda retenido.
// - Pujar retiene el importe del efectivo (no del banco ni del dinero negro); quien queda superado lo recupera al momento.
// - Anti-sniping: una puja en los 2 últimos minutos alarga el cierre 2 minutos, como mucho 30 en total.
// - Al cerrar, el objeto va al ganador y el dinero al vendedor menos un 5 % de comisión (mínimo 1), que va al bote de
//   impuestos del servidor. Sin pujas, el objeto vuelve al vendedor. Quien la creó puede cancelarla mientras nadie haya pujado.
// Sin Discord: los DM y el cron están en discord/envios/subastas.js.
const db = require("../core/db");
const dinero = require("./dinero");
const impuestos = require("./impuestos");
const { esDeProteccion, unidadDe, puedeRecibir } = require("./objetosRegalo");
const { fmtNumero } = require("../core/formato");

const HORA_MS = 3600 * 1000;
const MIN_MS = 60 * 1000;
const DURACIONES = [24, 48];
const PRECIO_MAX = 1_000_000;
const MAX_ABIERTAS = 5;
const COMISION_PCT = 5;
const PRORROGA_MS = 2 * MIN_MS;
const PRORROGA_MAX_MS = 30 * MIN_MS;

const error = (motivo) => ({ ok: false, motivo });
const entero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

const SELECT = `SELECT subastas.*, objeto.nombre, objeto.descripcion, objeto.rareza, objeto.imagen, objeto.unico
    FROM subastas JOIN objeto ON subastas.objetoId = objeto.id`;

const obtener = (id) => db.prepare(`${SELECT} WHERE subastas.id = ?`).get(Number(id)) || null;

/** La puja más alta que sigue en pie (sin devolver), o null. */
const pujaMayor = (subastaId) =>
    db
        .prepare("SELECT * FROM subasta_pujas WHERE subasta_id = ? AND devuelta = 0 ORDER BY cantidad DESC, id ASC LIMIT 1")
        .get(Number(subastaId)) || null;

/** Lo mínimo que hay que pujar ahora: el precio de salida o la puja más alta más el incremento. */
function minimaPuja(s) {
    const mayor = pujaMayor(s.id);
    return mayor ? mayor.cantidad + s.incremento : s.precio_inicial;
}

/** La comisión de una venta: el 5 %, como mínimo 1. */
const comisionDe = (precio) => Math.max(1, Math.floor((precio * COMISION_PCT) / 100));

/**
 * Subasta una unidad de un objeto del inventario.
 * @returns {{ ok: true, subasta: object } | { ok: false, motivo: string }}
 */
function crear({ guildId, userId, objetoId, precio, incremento, horas }, ahora = Date.now()) {
    if (!entero(precio, 1, PRECIO_MAX)) return error(`El precio de salida va de 1 a ${fmtNumero(PRECIO_MAX)}.`);
    if (!entero(incremento, 1, PRECIO_MAX)) return error(`El incremento mínimo va de 1 a ${fmtNumero(PRECIO_MAX)}.`);
    if (!DURACIONES.includes(horas)) return error("La subasta dura 24 o 48 horas.");
    return db.transaction(() => {
        const unidad = unidadDe(userId, Number(objetoId));
        if (!unidad) return error("Ya no tienes ese objeto.");
        if (esDeProteccion(unidad)) return error(`**${unidad.nombre}** es un objeto de protección: no se puede subastar.`);
        const abiertas = db.prepare("SELECT COUNT(*) FROM subastas WHERE vendedor = ? AND estado = 'abierta'").pluck().get(String(userId));
        if (abiertas >= MAX_ABIERTAS) return error(`Ya tienes ${MAX_ABIERTAS} subastas abiertas.`);
        db.prepare("DELETE FROM inventario WHERE id = ?").run(unidad.inventarioId);
        const cierra = ahora + horas * HORA_MS;
        const { lastInsertRowid } = db
            .prepare(
                `INSERT INTO subastas (guildId, vendedor, objetoId, precio_inicial, incremento, creada, cierra, cierre_original)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(String(guildId), String(userId), unidad.id, precio, incremento, ahora, cierra, cierra);
        return { ok: true, subasta: obtener(lastInsertRowid) };
    })();
}

/**
 * Puja. Retiene la cantidad del efectivo y devuelve la suya a quien queda superado.
 * @returns {{ ok: true, subasta: object, superado: { userId: string, cantidad: number } | null, prorrogada: boolean } | { ok: false, motivo: string }}
 */
function pujar(subastaId, userId, cantidad, ahora = Date.now()) {
    return db.transaction(() => {
        const s = obtener(subastaId);
        if (!s || s.estado !== "abierta" || s.cierra <= ahora) return error("Esta subasta ya está cerrada.");
        if (s.vendedor === String(userId)) return error("No puedes pujar en tu propia subasta.");
        const mayor = pujaMayor(s.id);
        if (mayor?.userId === String(userId)) return error("Ya vas ganando: espera a que alguien te supere.");
        const minima = mayor ? mayor.cantidad + s.incremento : s.precio_inicial;
        if (!entero(cantidad, minima, PRECIO_MAX)) return error(`La puja mínima es de **${fmtNumero(minima)}** 🪙.`);
        if (!puedeRecibir(userId, { id: s.objetoId, unico: s.unico })) return error(`Ya tienes **${s.nombre}** y es un objeto único.`);
        if (!dinero.cobrar(userId, cantidad)) return error("No te llega el efectivo para esa puja (no vale el banco ni el dinero negro).");
        dinero.apuntar(userId, "venta", `Subasta: puja por ${s.nombre}`, -cantidad);
        db.prepare("INSERT INTO subasta_pujas (subasta_id, userId, cantidad, creada) VALUES (?, ?, ?, ?)").run(
            s.id,
            String(userId),
            cantidad,
            ahora,
        );
        if (mayor) {
            db.prepare("UPDATE subasta_pujas SET devuelta = 1 WHERE id = ?").run(mayor.id);
            dinero.pagar(mayor.userId, mayor.cantidad);
            dinero.apuntar(mayor.userId, "venta", `Subasta: te han superado en ${s.nombre} (devolución)`, mayor.cantidad);
        }
        const prorroga = s.cierra - ahora < PRORROGA_MS ? Math.min(s.cierra + PRORROGA_MS, s.cierre_original + PRORROGA_MAX_MS) : s.cierra;
        if (prorroga !== s.cierra) db.prepare("UPDATE subastas SET cierra = ? WHERE id = ?").run(prorroga, s.id);
        return {
            ok: true,
            subasta: obtener(s.id),
            superado: mayor ? { userId: mayor.userId, cantidad: mayor.cantidad } : null,
            prorrogada: prorroga !== s.cierra,
        };
    })();
}

const alInventario = (userId, objetoId, ahora) =>
    db
        .prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)")
        .run(String(userId), objetoId, new Date(ahora).toISOString());

/** Quien la creó la cancela mientras nadie haya pujado: el objeto vuelve a su inventario. */
function cancelar(subastaId, userId, ahora = Date.now()) {
    return db.transaction(() => {
        const s = obtener(subastaId);
        if (!s || s.estado !== "abierta") return error("Esta subasta ya está cerrada.");
        if (s.vendedor !== String(userId)) return error("Esta subasta no es tuya.");
        if (pujaMayor(s.id)) return error("Ya hay pujas: no se puede cancelar.");
        db.prepare("UPDATE subastas SET estado = 'cancelada', cerrada_en = ? WHERE id = ? AND estado = 'abierta'").run(ahora, s.id);
        alInventario(s.vendedor, s.objetoId, ahora);
        return { ok: true, subasta: obtener(s.id) };
    })();
}

/**
 * Cierra una subasta vencida: el objeto al ganador y el dinero (menos la comisión) al vendedor, o el objeto de vuelta si
 * nadie pujó. Una sola vez aunque se llame dos veces. @returns {object | null} la subasta cerrada, o null
 */
function cerrar(subastaId, ahora = Date.now()) {
    return db.transaction(() => {
        const s = obtener(subastaId);
        if (!s || s.estado !== "abierta" || s.cierra > ahora) return null;
        const mayor = pujaMayor(s.id);
        if (!mayor) {
            db.prepare("UPDATE subastas SET estado = 'desierta', cerrada_en = ? WHERE id = ?").run(ahora, s.id);
            alInventario(s.vendedor, s.objetoId, ahora);
            return obtener(s.id);
        }
        const comision = comisionDe(mayor.cantidad);
        db.prepare("UPDATE subastas SET estado = 'cerrada', ganador = ?, precio_final = ?, comision = ?, cerrada_en = ? WHERE id = ?").run(
            mayor.userId,
            mayor.cantidad,
            comision,
            ahora,
            s.id,
        );
        alInventario(mayor.userId, s.objetoId, ahora);
        dinero.pagarSinImpuesto(
            s.vendedor,
            "venta",
            `Subasta: venta de ${s.nombre} (${COMISION_PCT} % de comisión)`,
            mayor.cantidad - comision,
        );
        impuestos.sumarBote(s.guildId, comision);
        return obtener(s.id);
    })();
}

/** Las subastas abiertas cuyo tiempo ha acabado. */
const vencidas = (ahora = Date.now()) =>
    db.prepare("SELECT id FROM subastas WHERE estado = 'abierta' AND cierra <= ? ORDER BY cierra, id").pluck().all(ahora);

/** Las abiertas, la que antes cierra primero. */
const abiertas = (ahora = Date.now()) =>
    db.prepare(`${SELECT} WHERE subastas.estado = 'abierta' AND subastas.cierra > ? ORDER BY subastas.cierra, subastas.id`).all(ahora);

/** Las de un vendedor (abiertas y las 10 últimas cerradas). */
const deVendedor = (userId) =>
    db
        .prepare(`${SELECT} WHERE subastas.vendedor = ? ORDER BY subastas.estado = 'abierta' DESC, subastas.creada DESC LIMIT 15`)
        .all(String(userId));

/** Las subastas abiertas en las que ha pujado, con su mejor puja y si va ganando. */
function conPujasDe(userId, ahora = Date.now()) {
    return db
        .prepare(
            `${SELECT} WHERE subastas.estado = 'abierta' AND subastas.cierra > ?
             AND subastas.id IN (SELECT subasta_id FROM subasta_pujas WHERE userId = ?) ORDER BY subastas.cierra`,
        )
        .all(ahora, String(userId))
        .map((s) => ({ ...s, ganando: pujaMayor(s.id)?.userId === String(userId) }));
}

/** Los objetos del inventario que se pueden subastar (sin los de protección), uno por tipo. */
const subastables = (inventario) => inventario.filter((o) => !esDeProteccion(o));

module.exports = {
    DURACIONES,
    PRECIO_MAX,
    MAX_ABIERTAS,
    COMISION_PCT,
    PRORROGA_MS,
    PRORROGA_MAX_MS,
    obtener,
    pujaMayor,
    minimaPuja,
    comisionDe,
    crear,
    pujar,
    cancelar,
    cerrar,
    vencidas,
    abiertas,
    deVendedor,
    conPujasDe,
    subastables,
};
