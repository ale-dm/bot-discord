// Objetos del inventario: qué tiene cada uno y usarlos (aplicar su efecto). Sin mensajes de Discord: los pinta
// paneles/tienda (pestaña 🎒 Inventario de /tienda). Antes eran /inventario y /usar.
const db = require("../core/db");
const dinero = require("./dinero");
const { createLogger } = require("../core/logger");

const log = createLogger("Objetos");

/** Tipos de objeto que hacen algo al usarse (los demás no llevan botón de Usar). */
const USABLES = new Set(["rol", "consumible"]);
const esUsable = (obj) => USABLES.has(String(obj?.tipo || "").toLowerCase());

/** Objetos de alguien agrupados (con cuántos tiene), los más recientes primero; con filtros opcionales. */
function inventarioDe(userId, { categoria, rareza } = {}) {
    const where = ["inventario.userId = ?"];
    const params = [userId];
    if (categoria) {
        where.push("objeto.categoria = ?");
        params.push(categoria);
    }
    if (rareza) {
        where.push("objeto.rareza = ?");
        params.push(rareza);
    }
    return db
        .prepare(
            `SELECT inventario.itemId, objeto.*, COUNT(*) AS cantidad
             FROM inventario JOIN objeto ON inventario.itemId = objeto.id
             WHERE ${where.join(" AND ")}
             GROUP BY inventario.itemId ORDER BY MAX(inventario.id) DESC`,
        )
        .all(...params);
}

/**
 * Aplica el efecto de un objeto al usuario que lo usa.
 * Devuelve { ok, mensaje } donde mensaje describe qué pasó.
 */
async function aplicarEfecto(obj, userId, member, guild) {
    const tipo = (obj.tipo || "").toLowerCase();
    const efecto = obj.efecto || "";

    // --- ROL: asignar rol de Discord ---
    if (tipo === "rol") {
        // Buscar por rolId (ID de Discord) o por nombre del objeto
        let role = obj.rolId ? guild.roles.cache.get(obj.rolId) : null;
        if (!role) role = guild.roles.cache.find((r) => r.name.toLowerCase() === obj.nombre.toLowerCase());
        if (!role) return { ok: false, mensaje: "❌ No se encontró el rol de Discord correspondiente." };

        if (member.roles.cache.has(role.id)) {
            return { ok: false, mensaje: `❌ Ya tienes el rol **${role.name}**.` };
        }
        await member.roles.add(role);
        return { ok: true, mensaje: `🎭 Se te ha asignado el rol **${role.name}**.` };
    }

    // --- CONSUMIBLE: efecto definido en campo "efecto" ---
    // Formato: "monedas:500" | "xp:100" | "mensaje:Texto personalizado"
    if (tipo === "consumible") {
        if (efecto.startsWith("monedas:")) {
            const cantidad = parseInt(efecto.split(":")[1]) || 0;
            // Al 💵 efectivo (systems/dinero; crea la cuenta si no la tenía).
            dinero.pagar(userId, cantidad);
            dinero.apuntar(userId, "objeto", `Efecto consumible: ${obj.nombre}`, cantidad);
            return { ok: true, mensaje: `🪙 ¡Has recibido **${cantidad} monedas**!` };
        }
        if (efecto.startsWith("mensaje:")) {
            const texto = efecto.slice("mensaje:".length);
            return { ok: true, mensaje: `✨ ${texto}` };
        }
        // Sin efecto definido — al menos consume el objeto
        return { ok: true, mensaje: `✅ Has usado **${obj.nombre}**.` };
    }

    return { ok: false, mensaje: "⚠️ Este objeto no tiene un efecto definido." };
}

/**
 * Usa un objeto del inventario. Un consumible se gasta; si su efecto falla, se devuelve.
 * @returns {Promise<{ ok: boolean, mensaje: string, obj: object|null }>}
 */
async function usarObjeto(userId, objetoId, member, guild, etiqueta = userId) {
    const obj = db
        .prepare(
            `SELECT objeto.*, inventario.id AS inventarioId
             FROM inventario JOIN objeto ON inventario.itemId = objeto.id
             WHERE inventario.userId = ? AND objeto.id = ?
             ORDER BY inventario.id ASC LIMIT 1`,
        )
        .get(userId, objetoId);
    if (!obj) return { ok: false, mensaje: "❌ No tienes ese objeto en tu inventario.", obj: null };

    const tipo = (obj.tipo || "").toLowerCase();
    const esConsumible = tipo === "consumible";
    // Los consumibles se borran ANTES de aplicar el efecto (evita el doble uso).
    if (esConsumible) db.prepare("DELETE FROM inventario WHERE id = ?").run(obj.inventarioId);

    let ok;
    let mensaje;
    try {
        ({ ok, mensaje } = await aplicarEfecto(obj, userId, member, guild));
    } catch (e) {
        log.error(`Error aplicando el efecto de "${obj.nombre}" (#${obj.id}) para ${userId}:`, e);
        ok = false;
        mensaje = "⚠️ Ha fallado al aplicar el efecto. No has perdido el objeto.";
    }
    log.info(`${etiqueta} (${userId}) usó "${obj.nombre}" (#${obj.id}, ${tipo || "sin tipo"}): ${ok ? "ok" : "falló"} · ${mensaje}`);
    // Si el consumible falló, se devuelve al inventario.
    if (esConsumible && !ok) {
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, obj.id, new Date().toISOString());
    }
    return { ok, mensaje, obj };
}

module.exports = { inventarioDe, usarObjeto, esUsable };
