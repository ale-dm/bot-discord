// Enviar la respuesta del Duende: edición segura de la respuesta, GIF, texto para Discord y respuesta por voz.

const { MessageFlags } = require("discord.js");
const { tryVoiceReply } = require("../voz");
const { getGifForText } = require("../../giphy");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende");

// Helper to safely send text responses without exceeding Discord's 2000-char limit.
async function safeEditReply(interaction, content) {
    try {
        const MAX = 2000;
        const text = typeof content === "string" ? content : String(content || "");
        if (text.length <= MAX) {
            await interaction.editReply({ content: text });
            return true;
        }
        // Truncate and attempt to send; leave room for truncation notice
        const truncated = text.slice(0, MAX - 50) + "\n\n(Respuesta truncada por longitud)";
        // Los followUp no heredan lo privado de la respuesta: si esta era privada, los trozos también.
        const flags = interaction.ephemeral ? MessageFlags.Ephemeral : undefined;
        try {
            await interaction.editReply({ content: truncated });
            // If possible, follow up with remaining content in chunks (best-effort)
            if (interaction.followUp && typeof interaction.followUp === "function") {
                let rest = text.slice(MAX - 50);
                while (rest.length > 0) {
                    const chunk = rest.slice(0, MAX - 20);
                    rest = rest.slice(MAX - 20);
                    try {
                        await interaction.followUp({ content: chunk, flags });
                    } catch (e) {
                        break;
                    }
                }
            }
            return true;
        } catch (e) {
            // If editReply fails, try simple followUp
            if (interaction.followUp && typeof interaction.followUp === "function") {
                try {
                    await interaction.followUp({ content: truncated, flags });
                    return true;
                } catch (e2) {
                    log.debug(`followUp de respaldo también falló: ${e2.message}`);
                }
            }
            throw e;
        }
    } catch (err) {
        log.warn("No se pudo enviar la respuesta (safeEditReply):", err);
        return false;
    }
}

// Un GIF de vez en cuando (DUENDE_GIF_PROB); si falla, la respuesta sale igual sin él.
async function buscarGifParaRespuesta(text, userInput) {
    try {
        if (Math.random() < (parseFloat(process.env.DUENDE_GIF_PROB) || 0.08)) {
            const gifUrl = await getGifForText(text, userInput);
            if (gifUrl) log.debug("GIF encontrado: " + gifUrl);
            else log.debug("No se encontró GIF relevante.");
            return gifUrl;
        }
        log.debug("No se busca GIF esta vez.");
    } catch (err) {
        log.error("Error buscando GIF: " + err.message);
    }
    return null;
}

// Ensure message content fits Discord limits (2000 chars). Truncate if needed.
function recortarParaDiscord(text) {
    const MAX_DISCORD_CONTENT = 2000;
    const SAFETY_MARGIN = 20; // leave room for extra text like truncation notice and gif url
    const effectiveMax = MAX_DISCORD_CONTENT - SAFETY_MARGIN;
    const sendText = typeof text === "string" ? text : String(text || "");
    if (sendText.length > effectiveMax) {
        return sendText.slice(0, effectiveMax) + "\n\n(Respuesta truncada por longitud)";
    }
    return sendText;
}

// Manda el texto (y el GIF y las propuestas). Por voz (/escuchar) no sale nada por aquí.
async function enviarRespuestaTexto(interaction, { sendText, gifUrl, propuestas }) {
    try {
        let sentOk = false;
        if (!interaction?.silentTextReply) {
            sentOk = await safeEditReply(interaction, sendText);
        } else {
            sentOk = true;
        }

        if (!interaction?.silentTextReply && sentOk && gifUrl) {
            let gifSent = false;
            if (interaction.followUp && typeof interaction.followUp === "function") {
                try {
                    await interaction.followUp({ content: gifUrl });
                    gifSent = true;
                } catch (gifErr) {
                    log.warn("No se pudo enviar GIF por followUp: " + (gifErr && gifErr.message ? gifErr.message : gifErr));
                }
            }
            if (!gifSent && interaction.channel && typeof interaction.channel.send === "function") {
                try {
                    await interaction.channel.send(gifUrl);
                } catch (gifErr2) {
                    log.warn("No se pudo enviar GIF por channel.send: " + (gifErr2 && gifErr2.message ? gifErr2.message : gifErr2));
                }
            }
        }

        // Las propuestas del Duende, cada una en su mensaje con ✅ Acepto / ❌ No (paneles/duendeEconomia).
        if (sentOk && propuestas?.length) {
            const { mensajePropuesta } = require("../../../paneles/duendeEconomia");
            const flags = interaction.ephemeral ? MessageFlags.Ephemeral : undefined;
            for (const propuesta of propuestas) {
                try {
                    await interaction.followUp({ ...mensajePropuesta(propuesta), flags });
                } catch (e) {
                    log.warn(`No se pudo enviar la propuesta del Duende (${propuesta.tipo}): ${e.message}`);
                }
            }
        }

        if (!interaction?.silentTextReply && !sentOk) {
            const fallbackMsg = "⚠️ No he podido enviar la respuesta principal. Inténtalo de nuevo en unos segundos.";
            if (interaction.followUp && typeof interaction.followUp === "function") {
                try {
                    await interaction.followUp({ content: fallbackMsg });
                    sentOk = true;
                } catch (e) {
                    log.debug(`followUp de aviso falló: ${e.message}`);
                }
            }
            if (!sentOk && interaction.channel && typeof interaction.channel.send === "function") {
                try {
                    await interaction.channel.send(fallbackMsg);
                } catch (e) {
                    log.warn(`No se pudo enviar ni la respuesta ni el aviso de error en ${interaction.channel?.id}: ${e.message}`);
                }
            }
        }
    } catch (sendErr) {
        log.error("Error enviando respuesta por texto:", sendErr);
    }
}

// Conversación por voz (/escuchar): no hay respuesta por texto, así que si la voz falla (TTS sin audio, sin
// conexión al canal...) se manda por texto para que el Duende no se quede mudo.
async function responderPorVoz(client, interaction, textoVoz, sendText) {
    try {
        const hablado = tryVoiceReply(client, interaction, textoVoz);
        if (interaction?.silentTextReply) {
            if (!(await hablado) && interaction.channel?.send) {
                log.warn("No se pudo responder por voz: la respuesta va por texto");
                await interaction.channel.send({ content: `🗣️ ${sendText}`, allowedMentions: { parse: ["users"] } });
            }
        } else void hablado;
    } catch (voiceErr) {
        log.error("Error lanzando respuesta por voz:", voiceErr);
    }
}

module.exports = { safeEditReply, buscarGifParaRespuesta, recortarParaDiscord, enviarRespuestaTexto, responderPorVoz };
