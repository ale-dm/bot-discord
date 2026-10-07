// Cambio automático de modelo de Gemini (F-AD-03). Al arrancar se prueba el modelo del Duende de cada servidor
// (gemini.comprobarModelo): si no existe (404, retirado) o no usa las herramientas (se inventaría los datos), en vez de
// solo avisar se prueban otros —el de .env (GEMINI_MODEL) y los de GEMINI_FALLBACK_MODELS, en ese orden— y el primero
// que funciona pasa a ser el del servidor (Config Global → 🤖 Duende), con una alerta a los admins y una línea en la
// auditoría. Un fallo que no dice nada del modelo (cuota, timeout, red) solo se avisa: no es motivo para cambiarlo.
const guildSettings = require("../guildSettings");
const adminAudit = require("../adminAudit");
const alertas = require("../alertas");
const { comprobarModelo, modeloDe } = require("../../services/duende/gemini");
const { GEMINI_MODEL } = require("./config");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende");

const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-2.5-flash,gemini-2.5-pro")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

/** Los modelos que se prueban, en orden, cuando `fallido` no sirve: el de .env y los de respaldo, sin repetir. */
function candidatos(fallido) {
    return [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])].filter((m) => m !== fallido);
}

/** ¿El fallo es del modelo (no existe o no usa herramientas), y no un error de paso? */
const fallaElModelo = (r) => !r.ok && !r.error;

/** El primer modelo de los de respaldo que funciona (su comprobación), o null. */
async function buscarAlternativa(fallido) {
    for (const modelo of candidatos(fallido)) {
        const r = await comprobarModelo(modelo);
        log.info(`Modelo de Gemini de respaldo ${modelo}: ${r.ok ? `funciona (${r.ms} ms)` : r.motivo}`);
        if (r.ok) return r;
    }
    return null;
}

/**
 * Comprueba el modelo de cada servidor y, si no sirve, lo cambia por uno que funcione. Cada modelo distinto se prueba
 * una sola vez. @returns {Promise<Array<{ modelo, ok, nuevo?: string, guildIds: string[], motivo?: string }>>}
 */
async function comprobarAlArrancar(guildIds) {
    const porModelo = new Map();
    for (const guildId of guildIds) {
        const modelo = modeloDe(guildId);
        porModelo.set(modelo, [...(porModelo.get(modelo) || []), guildId]);
    }
    const resultados = [];
    for (const [modelo, servidores] of porModelo) {
        const r = await comprobarModelo(modelo);
        if (r.ok) {
            log.info(`Modelo de Gemini ${modelo}: funciona y usa herramientas (${r.ms} ms)`);
            resultados.push({ modelo, ok: true, guildIds: servidores });
            continue;
        }
        log.warn(`Modelo de Gemini ${modelo}: ${r.motivo}`);
        const alternativa = fallaElModelo(r) ? await buscarAlternativa(modelo) : null;
        if (alternativa) {
            for (const guildId of servidores) {
                guildSettings.setSetting(guildId, "duende.model", alternativa.modelo);
                adminAudit.logAdminAction({
                    guildId,
                    actorId: "bot",
                    action: "settings.duende.modelo_automatico",
                    details: { antes: modelo, ahora: alternativa.modelo, motivo: r.motivo },
                });
            }
            log.warn(`Modelo de Gemini cambiado solo de ${modelo} a ${alternativa.modelo} en ${servidores.length} servidor(es)`);
            await alertas.alertar({
                clave: `gemini-modelo:${modelo}`,
                titulo: "🤖 He cambiado el modelo de Gemini",
                detalle:
                    `${r.motivo}\n\nEl Duende usa ahora **${alternativa.modelo}**, que funciona y usa las herramientas. ` +
                    "Si prefieres otro, cámbialo en /paneladmin → ⚙️ Config Global → 🤖 Duende → ✏️ Editar IA.",
            });
            resultados.push({ modelo, ok: false, nuevo: alternativa.modelo, guildIds: servidores, motivo: r.motivo });
            continue;
        }
        await alertas.alertar({
            clave: `gemini-modelo:${modelo}`,
            titulo: "🤖 El modelo de Gemini no funciona bien",
            detalle:
                `${r.motivo}\n\n` +
                (fallaElModelo(r) ? "Tampoco funciona ninguno de los de respaldo (GEMINI_FALLBACK_MODELS). " : "") +
                "Cámbialo en /paneladmin → ⚙️ Config Global → 🤖 Duende → ✏️ Editar IA.",
        });
        resultados.push({ modelo, ok: false, guildIds: servidores, motivo: r.motivo });
    }
    return resultados;
}

module.exports = { GEMINI_FALLBACK_MODELS, candidatos, comprobarAlArrancar };
