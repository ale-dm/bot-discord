// /trabajar: ingreso con cooldown corto (30 min por defecto), distinto de la 🎁 recompensa diaria
// (esa es gratis una vez al día; esto exige estar activo). El texto de "en qué has trabajado" lo
// escribe el Duende con Gemini cada vez, con su personalidad y el perfil de quien lo use si tiene.
const guildSettings = require("../guildSettings");
const dinero = require("../dinero");
const xpSystem = require("../xpSystem");
const perfiles = require("./perfiles");
const { buildPersonProfileText } = require("./personas");
const { generarConGemini } = require("../../services/duende/gemini");
const { createLogger } = require("../../core/logger");

const log = createLogger("Duende").child("Trabajo");

const COOLDOWN_SEC = Number(process.env.TRABAJAR_COOLDOWN_SEC || 30 * 60);
const BASE_MIN = Number(process.env.TRABAJAR_BASE_MIN || 20);
const BASE_MAX = Number(process.env.TRABAJAR_BASE_MAX || 50);
const BONUS_POR_NIVEL = Number(process.env.TRABAJAR_BONUS_NIVEL || 2);
const PROB_FALLO = Number(process.env.TRABAJAR_PROB_FALLO || 0.12);

function cantidadBase() {
    return BASE_MIN + Math.floor(Math.random() * (BASE_MAX - BASE_MIN + 1));
}

async function generarTexto(channelId, user, { exito, cantidad }) {
    const persona = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    const base = persona ? persona.systemInstructions : perfiles.instruccionDefault;
    const perfil = perfiles.perfilDe(user);
    const perfilTexto = perfil ? buildPersonProfileText(perfil) : null;
    const parts = [
        {
            text:
                `${base} ${user.username || "alguien"} acaba de usar /trabajar. ` +
                (exito
                    ? `Ha ganado ${cantidad} monedas.`
                    : "Esta vez no ha ganado nada (le ha salido mal: la has despedido, un cliente le ha timado, lo que te apetezca).") +
                " Cuéntale en 1 frase, con humor y en tu personalidad, en qué ha 'trabajado' hoy. No lo sueltes como una ficha " +
                "aparte: teje la cifra (si la hay) dentro de la misma frase, de forma natural.",
        },
        ...(perfilTexto ? [{ text: `Lo que sabes de esta persona: ${perfilTexto}` }] : []),
    ];
    // thinkingBudget: 0 — una frase suelta no necesita que el modelo "piense" antes de
    // responder, y si piensa se come el maxTokens antes de escribir nada visible (visto en
    // producción: la respuesta salía cortada a una palabra).
    return generarConGemini(parts, { maxTokens: 400, thinkingBudget: 0 });
}

/**
 * @returns {Promise<
 *   { ok: true, exito: boolean, cantidad: number, texto: string } |
 *   { ok: false, reason: "cooldown", retrySeconds: number }
 * >}
 */
async function trabajar(guildId, user, channelId) {
    const limite = guildSettings.checkAndConsumeLimit(guildId, "trabajar", String(user.id), { cooldownSec: COOLDOWN_SEC });
    if (!limite.ok) return limite;

    const nivel = xpSystem.getProfile(guildId, user.id).nivel || 0;
    const exito = Math.random() >= PROB_FALLO;
    const cantidad = exito ? cantidadBase() + nivel * BONUS_POR_NIVEL : 0;
    if (cantidad > 0) {
        dinero.pagarConImpuesto(user.id, guildId, "trabajo", "Trabajar", cantidad);
    }

    let texto;
    try {
        texto = await generarTexto(channelId, user, { exito, cantidad });
    } catch (e) {
        log.warn(`No se pudo generar el texto de /trabajar: ` + e.message);
        texto = exito ? `Has trabajado y ganado ${cantidad} monedas.` : "Esta vez no has ganado nada.";
    }

    log.info(`${user.username || user.id} trabajó: ${exito ? `+${cantidad}` : "sin suerte"}`);
    return { ok: true, exito, cantidad, texto };
}

module.exports = { trabajar, COOLDOWN_SEC, BASE_MIN, BASE_MAX, BONUS_POR_NIVEL, PROB_FALLO };
