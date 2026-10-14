// 🎯 Meta comunitaria financiada con el bote (#415): un admin fija una meta (monedas en el bote) y una recompensa por persona.
// Cuando el bote llega a la meta, se reparte entre quien ha participado (ha ganado XP en la última semana y sigue en el servidor):
// cada persona recibe la recompensa, o su parte si el bote no da para todas (la meta se reparte a partes iguales). Solo se descuenta
// del bote lo que se paga y la meta se marca como cumplida en la misma transacción, así que nunca se paga dos veces.
const db = require("../../core/db");
const dinero = require("../dinero");
const { boteTotal } = require("../impuestos");

const SEMANA_DIAS = 7;

function obtener(guildId) {
    return db.prepare("SELECT guildId, meta, recompensa, creada, cumplida_en FROM impuestos_meta WHERE guildId = ?").get(guildId) || null;
}

/** Fija una meta nueva (sustituye a la anterior, cumplida o no). @returns {{ ok: boolean, mensaje: string }} */
function fijar(guildId, meta, recompensa, ahora = Date.now()) {
    if (!Number.isInteger(meta) || meta < 1) return { ok: false, mensaje: "❌ La meta tiene que ser un número entero de 1 o más." };
    if (!Number.isInteger(recompensa) || recompensa < 1 || recompensa > meta) {
        return { ok: false, mensaje: "❌ La recompensa por persona tiene que ser un entero entre 1 y la meta." };
    }
    db.prepare(
        `INSERT INTO impuestos_meta (guildId, meta, recompensa, creada, cumplida_en) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(guildId) DO UPDATE SET meta = excluded.meta, recompensa = excluded.recompensa, creada = excluded.creada, cumplida_en = NULL`,
    ).run(guildId, meta, recompensa, ahora);
    return {
        ok: true,
        mensaje: `✅ Meta fijada: al llegar el bote a ${meta.toLocaleString("es")} 🪙 se reparten ${recompensa.toLocaleString("es")} 🪙 por persona.`,
    };
}

function quitar(guildId) {
    return db.prepare("DELETE FROM impuestos_meta WHERE guildId = ?").run(guildId).changes === 1;
}

/** Quienes han participado: han ganado XP en los últimos días con registro (xp_diaria guarda una semana). */
function participantes(guildId, esMiembro = () => true) {
    return db
        .prepare("SELECT DISTINCT userId FROM xp_diaria WHERE guildId = ? AND xp > 0")
        .all(guildId)
        .map((r) => r.userId)
        .filter(esMiembro);
}

/**
 * Cron: si el bote ha llegado a la meta, la reparte. `esMiembro`: filtra a quien ya no está en el servidor.
 * @returns {{ repartido: number, personas: number, porPersona: number } | null} null si no tocaba repartir
 */
function comprobar(guildId, esMiembro = () => true, ahora = Date.now()) {
    const m = obtener(guildId);
    if (!m || m.cumplida_en || boteTotal(guildId) < m.meta) return null;
    const gente = participantes(guildId, esMiembro);
    if (!gente.length) return null;
    const porPersona = Math.min(m.recompensa, Math.floor(m.meta / gente.length));
    if (porPersona < 1) return null;
    const repartido = porPersona * gente.length;
    return db.transaction(() => {
        const r = db.prepare("UPDATE impuestos_meta SET cumplida_en = ? WHERE guildId = ? AND cumplida_en IS NULL").run(ahora, guildId);
        if (r.changes !== 1) return null;
        const bote = db
            .prepare("UPDATE impuestos_bote SET total = total - ? WHERE guildId = ? AND total >= ?")
            .run(repartido, guildId, repartido);
        if (bote.changes !== 1) throw new Error("El bote ya no llega");
        for (const userId of gente) {
            dinero.pagarSinImpuesto(userId, "premio", `Meta comunitaria del bote (${porPersona.toLocaleString("es")} 🪙)`, porPersona);
        }
        return { repartido, personas: gente.length, porPersona };
    })();
}

module.exports = { SEMANA_DIAS, obtener, fijar, quitar, participantes, comprobar };
