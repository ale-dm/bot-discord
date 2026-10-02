// Recompensa diaria (🎁 Diario en /perfil → 💰 Economía): una vez al día (hora de Madrid, como las rachas), unas
// monedas al efectivo que crecen con la racha de XP del servidor: base + por_dia_racha × días, hasta el tope.
// El dinero es global, así que se cobra una vez al día aunque se esté en varios servidores.
const db = require("../core/db");
const dinero = require("./dinero");
const guildSettings = require("./guildSettings");
const { madridDateStr, getEffectiveStreak } = require("./xp/rachas");
const { createLogger } = require("../core/logger");

const log = createLogger("Diario");

function cantidadPara(cfg, racha) {
    const base = Math.max(0, Math.floor(Number(cfg.base) || 0));
    const porDia = Math.max(0, Math.floor(Number(cfg.por_dia_racha) || 0));
    const tope = Math.max(base, Math.floor(Number(cfg.tope) || 0));
    return Math.min(tope, base + porDia * Math.max(0, racha));
}

/** { activo, disponible, cantidad, racha, veces, total } de alguien en un servidor (sin cobrar nada). */
function estado(guildId, userId) {
    const cfg = guildSettings.getSettings(guildId).diario;
    const racha = guildId ? getEffectiveStreak(guildId, userId) : 0;
    const fila = db.prepare("SELECT ultimo_dia, veces, total FROM recompensa_diaria WHERE userId = ?").get(String(userId));
    return {
        activo: Boolean(cfg.enabled),
        disponible: Boolean(cfg.enabled) && fila?.ultimo_dia !== madridDateStr(),
        cantidad: cantidadPara(cfg, racha),
        racha,
        veces: fila?.veces || 0,
        total: fila?.total || 0,
    };
}

/**
 * Cobra la recompensa de hoy. La marca del día y el pago van en la misma transacción, y la marca solo se pone si
 * no estaba ya (dos clics a la vez no cobran dos veces). @returns {{ ok: boolean, mensaje: string, cantidad?: number }}
 */
function cobrar(guildId, userId) {
    const e = estado(guildId, userId);
    if (!e.activo) return { ok: false, mensaje: "❌ La recompensa diaria está desactivada en este servidor." };
    const hoy = madridDateStr();
    const ok = db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO recompensa_diaria (userId, ultimo_dia) VALUES (?, '')").run(String(userId));
        const marcado = db
            .prepare(
                "UPDATE recompensa_diaria SET ultimo_dia = ?, veces = veces + 1, total = total + ? WHERE userId = ? AND ultimo_dia != ?",
            )
            .run(hoy, e.cantidad, String(userId), hoy);
        if (marcado.changes !== 1) return false;
        dinero.pagar(userId, e.cantidad);
        dinero.apuntar(userId, "diario", `Recompensa diaria (racha de ${e.racha} días)`, e.cantidad);
        return true;
    })();
    if (!ok) return { ok: false, mensaje: "⏳ Ya has cobrado la recompensa de hoy. Vuelve mañana (desde las 00:00, hora de Madrid)." };
    log.info(`${userId} cobró la recompensa diaria: ${e.cantidad} (racha ${e.racha})`);
    return {
        ok: true,
        cantidad: e.cantidad,
        mensaje:
            `🎁 Has cobrado **${e.cantidad.toLocaleString("es")}** 🪙 de recompensa diaria` +
            (e.racha > 0 ? ` (racha de ${e.racha} días).` : ". Gana XP cada día para que suba con tu racha."),
    };
}

module.exports = { estado, cobrar, cantidadPara };
