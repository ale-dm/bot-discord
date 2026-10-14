// 🎟️ Códigos canjeables (#409): un admin crea un código con monedas y/o un objeto, un máximo de usos y una caducidad, y cada
// persona lo canjea una sola vez. Los códigos son globales (como el dinero y la tienda). Un código agotado, caducado o desactivado
// se rechaza sin dejar ningún movimiento; el canje es una transacción, así que N usos son exactamente N canjes aunque dos
// personas lo canjeen a la vez.
const db = require("../core/db");
const dinero = require("./dinero");
const { puedeRecibir } = require("./objetosRegalo");

const FORMATO = /^[A-Z0-9_-]{3,30}$/;
const MONEDAS_MAX = 1_000_000;

const normalizar = (codigo) =>
    String(codigo || "")
        .trim()
        .toUpperCase();

/**
 * Crea un código. `monedas` y/o `objetoId` (puede dar las dos cosas a la vez); `usosMax` (1 o más) y `caduca` (ms, o null).
 * @returns {{ ok: boolean, mensaje: string }}
 */
function crear({ codigo, monedas = 0, objetoId = null, usosMax, caduca = null }, ahora = Date.now()) {
    const c = normalizar(codigo);
    if (!FORMATO.test(c)) return { ok: false, mensaje: "❌ El código lleva de 3 a 30 letras, números, _ o -." };
    if (!Number.isInteger(monedas) || monedas < 0 || monedas > MONEDAS_MAX) {
        return { ok: false, mensaje: `❌ Las monedas tienen que ser un entero entre 0 y ${MONEDAS_MAX.toLocaleString("es")}.` };
    }
    if (!monedas && !objetoId) return { ok: false, mensaje: "❌ El código tiene que dar monedas, un objeto o las dos cosas." };
    if (objetoId && !db.prepare("SELECT 1 FROM objeto WHERE id = ?").get(objetoId))
        return { ok: false, mensaje: "❌ Ese objeto no existe." };
    if (!Number.isInteger(usosMax) || usosMax < 1) return { ok: false, mensaje: "❌ Los usos máximos tienen que ser 1 o más." };
    if (caduca !== null && caduca <= ahora) return { ok: false, mensaje: "❌ La fecha de caducidad ya ha pasado." };
    if (db.prepare("SELECT 1 FROM codigos WHERE codigo = ?").get(c)) return { ok: false, mensaje: `❌ Ya existe el código ${c}.` };
    db.prepare(
        "INSERT INTO codigos (codigo, monedas, objetoId, usos_max, usos, caduca, activo, creado) VALUES (?, ?, ?, ?, 0, ?, 1, ?)",
    ).run(c, monedas, objetoId, usosMax, caduca, ahora);
    return { ok: true, mensaje: `✅ Código **${c}** creado.`, codigo: c };
}

/** Desactiva un código (no se puede canjear más; los canjes hechos se conservan). */
function desactivar(codigo) {
    return db.prepare("UPDATE codigos SET activo = 0 WHERE codigo = ? AND activo = 1").run(normalizar(codigo)).changes === 1;
}

/** Los códigos, los más recientes primero, con el nombre del objeto si lo hay. */
function listar(limite = 25) {
    return db
        .prepare(
            `SELECT codigos.*, objeto.nombre AS objetoNombre FROM codigos LEFT JOIN objeto ON codigos.objetoId = objeto.id
             ORDER BY codigos.creado DESC LIMIT ?`,
        )
        .all(limite);
}

/** ¿Está en vigor? (activo, con usos y sin caducar). */
const vigente = (c, ahora) => c.activo === 1 && c.usos < c.usos_max && !(c.caduca && ahora >= c.caduca);

/** Canjea un código. @returns {{ ok: boolean, mensaje: string }} */
function canjear(userId, codigo, ahora = Date.now()) {
    const nombre = normalizar(codigo);
    return db.transaction(() => {
        const c = db
            .prepare(
                "SELECT codigos.*, objeto.nombre AS objetoNombre, objeto.unico AS objetoUnico FROM codigos LEFT JOIN objeto ON codigos.objetoId = objeto.id WHERE codigo = ?",
            )
            .get(nombre);
        if (!c || !c.activo) return { ok: false, mensaje: "❌ Ese código no existe." };
        if (c.caduca && ahora >= c.caduca) return { ok: false, mensaje: "❌ Ese código ha caducado." };
        if (c.usos >= c.usos_max) return { ok: false, mensaje: "❌ Ese código ya se ha agotado." };
        if (db.prepare("SELECT 1 FROM codigos_canjes WHERE codigo = ? AND userId = ?").get(nombre, String(userId))) {
            return { ok: false, mensaje: "❌ Ya has canjeado ese código." };
        }
        if (c.objetoId && !puedeRecibir(userId, { id: c.objetoId, unico: c.objetoUnico })) {
            return { ok: false, mensaje: `❌ Ya tienes **${c.objetoNombre}** y es un objeto único.` };
        }
        const r = db.prepare("UPDATE codigos SET usos = usos + 1 WHERE codigo = ? AND usos < usos_max").run(nombre);
        if (r.changes !== 1) return { ok: false, mensaje: "❌ Ese código ya se ha agotado." };
        db.prepare("INSERT INTO codigos_canjes (codigo, userId, fecha) VALUES (?, ?, ?)").run(nombre, String(userId), ahora);
        const partes = [];
        if (c.monedas) {
            dinero.pagarSinImpuesto(userId, "codigo", `Código ${nombre}`, c.monedas);
            partes.push(`**${c.monedas.toLocaleString("es")}** 🪙`);
        }
        if (c.objetoId) {
            db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(
                String(userId),
                c.objetoId,
                new Date(ahora).toISOString(),
            );
            if (!c.monedas) dinero.apuntar(userId, "codigo", `Código ${nombre}: ${c.objetoNombre}`, 0);
            partes.push(`**${c.objetoNombre}**`);
        }
        return { ok: true, mensaje: `🎟️ Código **${nombre}** canjeado: ${partes.join(" y ")}.` };
    })();
}

module.exports = { FORMATO, normalizar, crear, desactivar, listar, vigente, canjear };
