// 🗳️ Ajustes de las elecciones (`elecciones.*` en Config Global): leerlos ya normalizados y validar lo que llega de los
// formularios del panel admin. Sin Discord.
const guildSettings = require("../guildSettings");

const DIA_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
/** El ajuste de duración de cada fase con tiempo. */
const AJUSTE_DURACION = {
    inscripcion: "dias_inscripcion",
    primarias: "dias_primarias",
    programas: "dias_programas",
    generales: "dias_generales",
    mandato: "dias_mandato",
};
const DIAS_MIN = 0.01;
const DIAS_MAX = 365;
const LIMITES = {
    antiguedad_dias: { min: 0, max: 365, nombre: "Antigüedad mínima (días)" },
    max_canales: { min: 0, max: 10, nombre: "Canales del presidente" },
    max_sancion_min: { min: 1, max: 1440, nombre: "Silencio máximo (minutos)" },
    cooldown_min: { min: 0, max: 1440, nombre: "Espera por persona (minutos)" },
};

/** Los ajustes del servidor, con nombres de JS y tipos ya limpios. */
function ajustes(guildId) {
    const e = guildSettings.getSettings(guildId).elecciones;
    return {
        canal: String(e.canal || ""),
        rolPresidente: String(e.rol_presidente || ""),
        categoria: String(e.categoria_presidente || ""),
        dias: Object.fromEntries(Object.entries(AJUSTE_DURACION).map(([fase, clave]) => [fase, Number(e[clave]) || 1])),
        antiguedadDias: Number(e.antiguedad_dias) || 0,
        maxCanales: Number(e.max_canales) || 0,
        maxSancionMin: Number(e.max_sancion_min) || 1,
        cooldownMin: Number(e.cooldown_min) || 0,
        reeleccion: e.reeleccion !== false,
        autoReiniciar: e.auto_reiniciar === true,
    };
}

/** Cuánto dura `fase` en ese servidor, en ms (0 si la fase no tiene tiempo). */
function duracionMs(guildId, fase) {
    const dias = ajustes(guildId).dias[fase];
    return dias ? Math.round(dias * DIA_MS) : 0;
}

/** Un número escrito en un formulario (admite coma decimal), o null si no lo es o se sale de [min, max]. */
function numero(texto, min, max, { entero = false } = {}) {
    const t = String(texto ?? "")
        .trim()
        .replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    if (entero && !Number.isInteger(n)) return null;
    return n >= min && n <= max ? n : null;
}

/**
 * Valida las duraciones del formulario (`{ inscripcion, primarias, programas, generales, mandato }`, en días).
 * @returns {{ ok: true, valores: object } | { ok: false, motivo: string }}
 */
function validarDuraciones(campos) {
    const valores = {};
    for (const [fase, clave] of Object.entries(AJUSTE_DURACION)) {
        const n = numero(campos[fase], DIAS_MIN, DIAS_MAX);
        if (n === null) return { ok: false, motivo: `La duración de «${fase}» va de ${DIAS_MIN} a ${DIAS_MAX} días.` };
        valores[clave] = n;
    }
    return { ok: true, valores };
}

/**
 * Valida los límites del formulario (`{ antiguedad_dias, max_canales, max_sancion_min, cooldown_min }`), todos enteros.
 * @returns {{ ok: true, valores: object } | { ok: false, motivo: string }}
 */
function validarLimites(campos) {
    const valores = {};
    for (const [clave, { min, max, nombre }] of Object.entries(LIMITES)) {
        const n = numero(campos[clave], min, max, { entero: true });
        if (n === null) return { ok: false, motivo: `${nombre}: un número entero de ${min} a ${max}.` };
        valores[clave] = n;
    }
    return { ok: true, valores };
}

module.exports = { DIA_MS, MIN_MS, AJUSTE_DURACION, LIMITES, ajustes, duracionMs, numero, validarDuraciones, validarLimites };
