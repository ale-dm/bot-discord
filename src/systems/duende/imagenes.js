// 🎨 Imágenes del Duende: el límite que comparten /imagen, su botón «Otra versión» y la herramienta del chat (#367, #408): un cooldown
// por persona (en memoria, 45 s) y una cuota diaria por persona que sobrevive a los reinicios (IMAGE_GEN_DAILY_LIMIT, 10 por defecto,
// 0 = sin tope; nadie está exento). Un fallo de la API devuelve el cooldown y el cupo. También el historial de imágenes (#357) y el
// llamar a la API con tiempo límite.
const db = require("../../core/db");
const cuotas = require("./cuotas");
const { createLogger } = require("../../core/logger");

const log = createLogger("Imagen");

const COOLDOWN_MS = Number(process.env.IMAGE_GEN_COOLDOWN_MS || 45_000);
const LIMITE_DIARIO = Number(process.env.IMAGE_GEN_DAILY_LIMIT ?? 10);
const TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS || 120_000);
const RETENCION_DIAS = 90;

const cooldowns = new Map();
const clave = (userId) => `imagen:${userId}`;

/**
 * Reserva una generación para alguien: respeta el cooldown y gasta una imagen de su cuota de hoy. Si hay que esperar o ya no queda
 * cupo, no gasta nada. `opciones.limite` (por defecto, el de la variable de entorno) es para los tests.
 * @returns {{ ok: true, restantes: number|null } | { ok: false, motivo: "cooldown", faltan: number } | { ok: false, motivo: "cuota", reinicio: number }}
 */
function reservar(userId, { ahora = Date.now(), limite = LIMITE_DIARIO } = {}) {
    const falta = COOLDOWN_MS - (ahora - (cooldowns.get(userId) || 0));
    if (falta > 0) return { ok: false, motivo: "cooldown", faltan: Math.ceil(falta / 1000) };
    const r = cuotas.consumir([[clave(userId), limite]], ahora);
    if (!r.ok) return { ok: false, motivo: "cuota", reinicio: cuotas.reinicio(ahora) };
    cooldowns.set(userId, ahora);
    return { ok: true, restantes: limite > 0 ? limite - cuotas.usadas(clave(userId), ahora) : null };
}

/** La generación falló: se devuelven el cooldown y el cupo. */
function liberar(userId, ahora = Date.now()) {
    cooldowns.delete(userId);
    cuotas.devolver(clave(userId), ahora);
}

/** El texto de por qué no se puede generar ahora. */
function mensajeDeLimite(r) {
    if (r.motivo === "cooldown") return `⏳ Espera **${r.faltan}s** antes de generar otra imagen.`;
    return `🚫 Ya has generado tus ${LIMITE_DIARIO} imágenes de hoy. Vuelves a poder <t:${r.reinicio}:R>.`;
}

/** Llama a la API de imagen con un tiempo límite: al vencer se cancelan la petición y los reintentos pendientes. */
async function generarConTimeout(prompt, images = []) {
    const { generateImageREST } = require("../../services/duende/imagenGemini");
    const limite = AbortSignal.timeout(TIMEOUT_MS);
    try {
        return await generateImageREST(prompt, images, limite);
    } catch (e) {
        if (limite.aborted) throw new Error(`Timeout tras ${TIMEOUT_MS / 1000}s esperando respuesta`);
        throw e;
    }
}

/** Guarda una imagen en el historial. Nunca lanza: si falla la base de datos, la imagen ya se ha enviado y solo se anota en el log. */
function guardar({ guildId, userId, prompt, estilo, url, adjunto }) {
    try {
        db.prepare(
            "INSERT INTO imagenes_generadas (guildId, userId, prompt, estilo, url, adjunto, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(guildId ?? null, String(userId), prompt, estilo ?? null, url ?? null, adjunto ?? null, Date.now());
        db.prepare("DELETE FROM imagenes_generadas WHERE creada_en < ?").run(Date.now() - RETENCION_DIAS * 86400000);
        return true;
    } catch (e) {
        log.warn(`No se pudo guardar la imagen en el historial: ${e.message}`);
        return false;
    }
}

/** Las últimas imágenes de una persona (o, con `guildId`, las del servidor), las más recientes primero. */
function ultimas({ userId = null, guildId = null, limite = 10 } = {}) {
    if (userId) {
        return db
            .prepare(
                "SELECT userId, prompt, estilo, url, adjunto, creada_en FROM imagenes_generadas WHERE userId = ? ORDER BY creada_en DESC, id DESC LIMIT ?",
            )
            .all(String(userId), limite);
    }
    return db
        .prepare(
            "SELECT userId, prompt, estilo, url, adjunto, creada_en FROM imagenes_generadas WHERE guildId = ? ORDER BY creada_en DESC, id DESC LIMIT ?",
        )
        .all(String(guildId), limite);
}

module.exports = { COOLDOWN_MS, LIMITE_DIARIO, RETENCION_DIAS, reservar, liberar, mensajeDeLimite, generarConTimeout, guardar, ultimas };
