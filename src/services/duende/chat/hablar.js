// Hablar con el Duende: del mensaje al prompt, a Gemini y a la respuesta (texto, GIF o voz).

const guildSettings = require("../../../systems/guildSettings");
const { GEMINI_MODEL, DUENDE_DAILY_LIMIT, DUENDE_LOG_FULL_PROMPT } = require("../../../systems/duende/config");
const { conversationHistory, saveHistory } = require("../../../systems/duende/memoria");
const { mentionizeKnownNames } = require("../../../systems/duende/personas");
const { buildPromptFromParts } = require("../gemini");
const { safeEditReply, buscarGifParaRespuesta, recortarParaDiscord, enviarRespuestaTexto, responderPorVoz } = require("./enviar");
const { checkAndIncrementDailyLimit, limitToSentences, pedirRespuestaGemini } = require("./generar");
const {
    leerConfiguracion,
    construirInstrucciones,
    lineaDePerfiles,
    lineasDeUsuarios,
    historialParaPrompt,
    instruccionesDelTurno,
    construirPartes,
} = require("./contexto");
const { createLogger } = require("../../../core/logger");

const log = createLogger("Duende");

/** Añade el mensaje del usuario al historial del canal (con timestamp), recortado al límite configurado. */
function registrarMensajeUsuario(channelId, userName, userInput, historyLimit) {
    // Inicializa historial si no existe
    if (!conversationHistory[channelId]) conversationHistory[channelId] = [];

    // Añade el mensaje del usuario al historial (con timestamp)
    conversationHistory[channelId].push({ role: "user", name: userName, text: userInput, timestamp: Date.now() });
    if (conversationHistory[channelId].length > historyLimit) {
        conversationHistory[channelId] = conversationHistory[channelId].slice(-historyLimit);
    }
}

/** Las partes del prompt de Gemini para este turno: personalidad, instrucciones, perfiles, equivalencias e historial. */
async function montarPartes(interaction, { channelId, userName, userInput, historyLimit, instrucciones, personaObj, imageAttachments }) {
    const lineaPerfiles = await lineaDePerfiles(interaction, userInput);
    const { nombrePorUsername, lineaEquivalencias, lineaUsuarioActual } = lineasDeUsuarios(interaction, userName);
    const lineaPersonalidadActiva = personaObj
        ? `Personalidad activa: ${personaObj.id} (${personaObj.title || "sin título"})`
        : "Personalidad activa: default";
    const contextParts = historialParaPrompt(channelId, historyLimit, nombrePorUsername);
    const instruccionesFinal = instruccionesDelTurno(instrucciones, channelId, userInput);

    return construirPartes({
        lineaPersonalidadActiva,
        instruccionesFinal,
        lineaPerfiles,
        lineaEquivalencias,
        lineaUsuarioActual,
        contextParts,
        imageAttachments,
    });
}

/** Registra en el log el prompt que va a Gemini (el completo solo si DUENDE_LOG_FULL_PROMPT). */
function registrarPrompt(parts, activeModel) {
    log.debug(`Prompt enviado a Gemini (${activeModel}): [personalidad, instrucciones, equivalencias, historial reciente]`);
    if (DUENDE_LOG_FULL_PROMPT) {
        try {
            log.info(`Prompt completo Gemini:\n${buildPromptFromParts(parts)}`);
        } catch (promptLogErr) {
            log.warn("No se pudo registrar el prompt completo: " + (promptLogErr && promptLogErr.message));
        }
    }
}

/** Contexto que reciben las herramientas del Duende; las propuestas solo existen donde hay botones (no en la voz). */
function contextoDeHerramientas(interaction, channelId) {
    return {
        guildId: interaction.guildId || null,
        userId: interaction.user.id,
        guild: interaction.guild || null,
        channelId,
        // 🧙 Lo que el Duende proponga (un reto, una apuesta, un préstamo: F-DU-03) sale después con botones.
        // Por voz (/escuchar) no hay dónde pulsarlos: ahí no se ofrecen esas herramientas.
        ...(interaction?.silentTextReply ? {} : { propuestas: [] }),
    };
}

/** Ya con la respuesta de Gemini: la deja en dos frases, la guarda en el historial y la manda por texto, GIF, propuestas y voz. */
async function entregarRespuesta(client, interaction, { text, userInput, channelId, toolContext }) {
    const respuesta = limitToSentences(text, 2);
    // Para la voz, sin las menciones de Discord de debajo (si no, el TTS leería "<@370221…>").
    const textoVoz = respuesta;
    const textoChat = interaction.guild ? mentionizeKnownNames(respuesta, interaction.guild) : respuesta;

    const gifUrl = await buscarGifParaRespuesta(textoChat, userInput);

    conversationHistory[channelId].push({ role: "duende", name: "Duende", text: textoChat, timestamp: Date.now() });
    saveHistory();

    const sendText = recortarParaDiscord(textoChat);
    await enviarRespuestaTexto(interaction, { sendText, gifUrl, propuestas: toolContext.propuestas });
    await responderPorVoz(client, interaction, textoVoz, sendText);
}

/**
 * Comprueba que el Duende puede responder aquí: canal permitido y límite diario. Si no puede, avisa y devuelve false.
 */
async function puedeResponder(interaction, { channelId, userName, userInput, allowedChannel }) {
    if (interaction.guildId && allowedChannel && channelId !== allowedChannel) {
        await safeEditReply(interaction, `⛔ Duende está restringido a <#${allowedChannel}>.`);
        return false;
    }

    log.debug(
        `Mensaje recibido de ${userName} (${channelId})${interaction.id ? ` [msg ${interaction.id}]` : ""}: ${userInput ? userInput.length : 0} chars`,
    );

    // Comprueba límite diario
    if (!checkAndIncrementDailyLimit()) {
        log.warn(`Límite diario alcanzado (${DUENDE_DAILY_LIMIT} respuestas). Mensaje ignorado.`);
        await safeEditReply(interaction, `He alcanzado mi límite de respuestas por hoy (${DUENDE_DAILY_LIMIT}). ¡Hasta mañana!`);
        return false;
    }
    return true;
}

// Responder en el chat: lo usan el chat de texto, la voz (/escuchar) y el formulario 💬 Hablar del panel.
async function hablar(client, interaction) {
    try {
        await interaction.deferReply({});
        const guildCfg = interaction.guildId ? guildSettings.getSettings(interaction.guildId).duende : null;
        const { configuredModel, historyLimit, temperature, allowedChannel } = leerConfiguracion(guildCfg);

        // TALK
        const userInput = interaction.options.getString("texto");
        const imageAttachments = Array.isArray(interaction.imageAttachments) ? interaction.imageAttachments : [];
        const userName = interaction.user.username;
        const channelId = interaction.channel.id;

        if (!(await puedeResponder(interaction, { channelId, userName, userInput, allowedChannel }))) return;

        const { instrucciones, personaObj } = construirInstrucciones(interaction, channelId, userName);
        registrarMensajeUsuario(channelId, userName, userInput, historyLimit);

        const parts = await montarPartes(interaction, {
            channelId,
            userName,
            userInput,
            historyLimit,
            instrucciones,
            personaObj,
            imageAttachments,
        });
        const activeModel = configuredModel || GEMINI_MODEL;
        registrarPrompt(parts, activeModel);

        const toolContext = contextoDeHerramientas(interaction, channelId);
        const text = await pedirRespuestaGemini({
            parts,
            activeModel,
            temperature,
            imageAttachments,
            toolContext,
            userName,
            userInput,
        });
        await entregarRespuesta(client, interaction, { text, userInput, channelId, toolContext });
    } catch (err) {
        log.error("Error general en el comando:", err);
        try {
            await interaction.editReply({ content: "Ha ocurrido un error inesperado. Intenta de nuevo más tarde." });
        } catch (e) {
            log.debug(`Tampoco se pudo avisar del error: ${e.message}`);
        }
    }
}

module.exports = { hablar };
