// /duende: hablar con el Duende y gestionar sus personalidades y lo que recuerda de la gente.
// Las piezas están en systems/duende (config, memoria, personas) y services/duende (gemini,
// herramientas, voz); aquí queda el comando y la construcción del prompt.
const { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { createLogger } = require("../../core/logger");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const apodos = require("../../systems/apodos");
const {
    GEMINI_MODEL,
    DUENDE_MAX_TOKENS,
    DUENDE_MAX_TOKENS_FALLBACK,
    DUENDE_HISTORY_LIMIT,
    DUENDE_DAILY_LIMIT,
    DUENDE_PROMPT_MSG_MAX_CHARS,
    DUENDE_LOG_FULL_PROMPT,
} = require("../../systems/duende/config");
const { conversationHistory, saveHistory } = require("../../systems/duende/memoria");
const perfiles = require("../../systems/duende/perfiles");
const { ajusteDeTono } = require("../../systems/duende/tono");
const { instruccionDefault } = perfiles;
const { mentionizeKnownNames, buildPersonProfileText, detectMentionedPersons } = require("../../systems/duende/personas");
const { generarConGemini, buildPromptFromParts, isGeminiProhibitedContentError } = require("../../services/duende/gemini");
const recuerdosAuto = require("../../systems/duende/recuerdosAuto");
const { tryVoiceReply } = require("../../services/duende/voz");
const { getGifForText } = require("../../services/giphy");
const paneles = require("../../paneles/duende");
const { esAdmin } = require("../../core/permisos");

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

// Contador diario de respuestas
let dailyReplyCount = 0;
let dailyReplyDate = new Date().toDateString();
function checkAndIncrementDailyLimit() {
    const today = new Date().toDateString();
    if (today !== dailyReplyDate) {
        dailyReplyDate = today;
        dailyReplyCount = 0;
    }
    if (DUENDE_DAILY_LIMIT > 0 && dailyReplyCount >= DUENDE_DAILY_LIMIT) return false;
    dailyReplyCount++;
    return true;
}

function truncateText(value, maxLength) {
    const text = typeof value === "string" ? value : String(value || "");
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength);
}

function limitToSentences(value, maxSentences = 2) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    const sentences = raw.match(/[^.!?\n]+[.!?]?/g) || [raw];
    const compact = sentences.map((s) => s.trim()).filter(Boolean);
    if (!compact.length) return truncateText(raw, 220);
    return compact.slice(0, Math.max(1, maxSentences)).join(" ").trim();
}

// Pide la respuesta a Gemini. Si el contenido se bloquea (PROHIBITED_CONTENT) reintenta con un prompt seguro; si
// falla de otra forma, devuelve un texto de disculpa. Nunca lanza.
async function pedirRespuestaGemini({ parts, activeModel, temperature, imageAttachments, toolContext, userName, userInput }) {
    let text = "No estoy disponible.";
    try {
        text = await generarConGemini(parts, {
            maxTokens: DUENDE_MAX_TOKENS,
            model: activeModel,
            temperature,
            images: imageAttachments,
            toolContext,
        });
        log.info("Respuesta de Gemini: " + text);
    } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        if (isGeminiProhibitedContentError(errMsg)) {
            log.warn("Gemini bloqueó la respuesta por PROHIBITED_CONTENT. Reintentando con prompt seguro.");

            const safeParts = [
                { text: "Eres un asistente de Discord. Responde de forma breve, útil y respetuosa en español." },
                { text: `Usuario actual: ${userName}` },
                { text: `Mensaje del usuario: ${truncateText(userInput, 300)}` },
                {
                    text: 'Evita lenguaje ofensivo, amenazas, acoso o sexual explícito. Si tienes herramientas disponibles que te den datos reales o ejecuten la acción pedida, úsalas con normalidad — pedir contenido multimedia, consultar datos de otro usuario del mismo grupo, etc. no es "problemático", es el uso normal de este bot entre amigos. Solo niégate ante algo realmente dañino (amenazas reales, acoso serio, contenido sexual con menores...), nunca por simple prudencia ante una petición normal.',
                },
                { text: "Responde en 1-2 frases." },
            ];

            try {
                // Con toolContext también en este camino: si lo que se bloqueó fue solo el
                // TONO (personalidad muy agresiva chocando con el filtro de PROHIBITED_CONTENT
                // de Gemini, no configurable vía safetySettings), la acción real pedida por el
                // usuario sigue pudiendo completarse con un tono neutro — antes este fallback
                // no tenía herramientas y la funcionalidad entera se perdía, no solo el tono.
                text = await generarConGemini(safeParts, {
                    maxTokens: DUENDE_MAX_TOKENS_FALLBACK,
                    model: activeModel,
                    temperature,
                    toolContext,
                });
                log.warn("Reintento Gemini con prompt seguro completado (con herramientas). Texto: " + text);
            } catch (safeErr) {
                const safeErrMsg = safeErr && safeErr.message ? safeErr.message : String(safeErr);
                log.error("Error en reintento seguro de Gemini: " + safeErrMsg);
                text = "No puedo responder a ese contenido. Reformúlalo en términos más neutrales.";
            }
        } else {
            log.error(`Error al llamar a Gemini: ${errMsg}`);
            if (!text || text === "No estoy disponible.") {
                text = "Ahora mismo no puedo responder. Inténtalo de nuevo en unos segundos.";
            }
        }
    }
    return text;
}

function leerConfiguracion(guildCfg) {
    return {
        configuredModel: String(guildCfg?.model || "").trim(),
        historyLimit: Math.max(1, Number(guildCfg?.history_limit || DUENDE_HISTORY_LIMIT)),
        temperature: Number.isFinite(Number(guildCfg?.temperature))
            ? Number(guildCfg.temperature)
            : Number(process.env.DUENDE_TEMPERATURE || 0.7),
        allowedChannel: String(guildCfg?.allowed_channel_id || "").trim(),
    };
}

// Selección de personalidad: opción en comando > configuración de canal > default. Encima se le dice quién habla,
// y el tono de madrugada o formal del canal (F-DU-02).
function construirInstrucciones(interaction, channelId, userName) {
    const requestedPersonality = interaction.options.getString("personality") || null;
    let instrucciones = instruccionDefault;
    let personaObj = null;
    if (requestedPersonality) personaObj = perfiles.obtenerPersonalidad(requestedPersonality);
    if (!personaObj) personaObj = perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(channelId));
    if (personaObj) instrucciones = personaObj.systemInstructions;

    // Los perfiles de las personas SÍ moldean el trato: es contenido escrito a
    // mano para eso (ver buildPersonProfileText/lineaPerfiles más abajo). Cuando
    // se hable de alguien, se le da al modelo tanto el perfil de quien pregunta
    // como el de quien es el tema, para que pueda compararlos/relacionarlos en
    // la misma respuesta en vez de describir solo al otro de forma aislada.
    // El recordatorio de "usa las herramientas siempre" ya no va aquí: las
    // personalidades personalizadas (masiko, javier, sanchez...) sustituyen del
    // todo `instruccionDefault`, y mezclado en este texto competía con ellas en
    // igualdad de condiciones. Ahora vive en el systemInstruction real de Gemini
    // (gemini.js), que no se puede pisar cambiando de personalidad.
    instrucciones = `${instrucciones} El usuario que te habla es: ${userName}. Si se te dan perfiles de personas, úsalos para decidir tu tono con cada una; si hablas de alguien y también tienes el perfil de quien pregunta, compáralos o relaciónalos en la misma respuesta en vez de describir solo al otro de forma aislada.`;
    // 🌙 Más borde de madrugada y 👔 más formal en ciertos canales (F-DU-02), encima de la personalidad que toque.
    const tono = ajusteDeTono(interaction.guildId, channelId);
    if (tono) instrucciones = `${instrucciones} ${tono}`;
    return { instrucciones, personaObj };
}

// Perfil completo (sin truncar de forma agresiva, a diferencia de antes que
// cortaba a 200 caracteres y encima ignoraba `description` si había `notas`)
// para quien habla ahora + quien se mencione por nombre/apodo/mención en el
// mensaje. Es lo que le permite al Duende tratar a cada uno según lo que sabe
// de él y relacionar a ambos en la misma respuesta.
async function lineaDePerfiles(interaction, userInput) {
    const speakerProfile = perfiles.perfilDe(interaction.user);
    const mentionedProfiles = detectMentionedPersons(userInput, interaction.guild, interaction.user.id)
        .filter((p) => !speakerProfile || p.key !== speakerProfile.key)
        .slice(0, 3);

    // Con pocas notas se dan todas (perfiles.notasRelevantes no llama a Gemini); con
    // muchas, solo las más relacionadas con lo que se acaba de decir en vez de
    // siempre las últimas MAX_NOTAS — así no se pierden notas antiguas que sí vienen
    // a cuento ahora. Si falla la llamada a Gemini, cae a las últimas como antes.
    const conNotasRelevantes = async (p) => p && { ...p, notas: await perfiles.notasRelevantes(p, userInput) };
    const [speakerConNotas, ...mentionedConNotas] = await Promise.all([
        conNotasRelevantes(speakerProfile),
        ...mentionedProfiles.map(conNotasRelevantes),
    ]);

    const perfilesDestacados = [];
    if (speakerConNotas) {
        perfilesDestacados.push(
            `${speakerConNotas.name} (quien te habla ahora): ${truncateText(buildPersonProfileText(speakerConNotas), perfiles.MAX_PERFIL_PROMPT)}`,
        );
    }
    for (const p of mentionedConNotas) {
        perfilesDestacados.push(
            `${p.name} (mencionado en el mensaje): ${truncateText(buildPersonProfileText(p), perfiles.MAX_PERFIL_PROMPT)}`,
        );
    }
    return perfilesDestacados.length ? "Perfiles a tener en cuenta ahora mismo:\n" + perfilesDestacados.join("\n") : null;
}

// Equivalencias ligeras (solo nombre) para el resto de gente conocida, sin
// volcar toda su descripción — así no se infla el prompt con perfiles que no
// vienen a cuento en este mensaje.
function lineasDeUsuarios(interaction, userName) {
    // Nombre de cada uno según sus apodos (username de Discord -> nombre principal).
    const nombrePorUsername = new Map();
    for (const { discordId, nombre } of apodos.nombres(interaction.guildId)) {
        const m = interaction.guild?.members?.cache?.get(discordId);
        if (m) nombrePorUsername.set(m.user.username, nombre);
    }
    const personEntries = perfiles
        .listarPerfiles()
        .filter((p) => p.username)
        .map((p) => `"${p.username}" es ${p.name}`);
    const manualEntries = [...nombrePorUsername].map(([username, nombre]) => `"${username}" es ${nombre}`);
    const equivalencias = [...manualEntries, ...personEntries].join(", ");
    const lineaEquivalencias = "Equivalencias de usuarios: " + equivalencias + ".";

    // Línea que indica quién envía el mensaje ahora mismo
    const nombreHablante = apodos.nombreDe(interaction.guildId, interaction.user.id) || nombrePorUsername.get(userName);
    const lineaUsuarioActual = `Mensaje actual enviado por: ${userName}${nombreHablante ? ` / ${nombreHablante}` : ""}`;
    return { nombrePorUsername, lineaEquivalencias, lineaUsuarioActual };
}

// Historial con etiquetas claras de quién dijo qué
function historialParaPrompt(channelId, historyLimit, nombrePorUsername) {
    return conversationHistory[channelId]
        .map((msg) => {
            const nombre = nombrePorUsername.get(msg.name);
            if (msg.role === "user")
                return `Usuario (${msg.name}${nombre ? ` / ${nombre}` : ""}): ${truncateText(msg.text, DUENDE_PROMPT_MSG_MAX_CHARS)}`;
            return `Duende: ${truncateText(msg.text, DUENDE_PROMPT_MSG_MAX_CHARS)}`;
        })
        .slice(-historyLimit);
}

// Decide si intervenir (mantengo la lógica previa) y añade las reglas de estilo de este turno.
function instruccionesDelTurno(instrucciones, channelId, userInput) {
    const lastMessages = conversationHistory[channelId].slice(-4);
    const uniqueUsers = [...new Set(lastMessages.filter((m) => m.role === "user").map((m) => m.name))];
    const mensajeMencionaOtro = uniqueUsers.length > 1 || uniqueUsers.some((name) => userInput.toLowerCase().includes(name.toLowerCase()));
    const shouldIntervene = mensajeMencionaOtro && Math.random() < (parseFloat(process.env.DUENDE_INTERVENE_PROB) || 0.5);
    let instruccionesFinal = instrucciones;
    if (shouldIntervene)
        instruccionesFinal +=
            " Están hablando entre ellos. Si crees que puedes aportar algo sarcástico o molesto, hazlo. Si no, ignora la conversación.";
    instruccionesFinal +=
        " Regla importante: no repitas literalmente tu última respuesta ni copies frases exactas de mensajes previos. Responde solo una vez y de forma nueva.";
    instruccionesFinal +=
        " Si viene a cuento, termina alguna vez (no siempre, no lo fuerces) con una pregunta corta para seguir la conversación en vez de solo soltar una frase y punto.";
    instruccionesFinal +=
        " Cuando uses un dato que has consultado (fecha, título, cifra...), no lo sueltes en plan ficha ('X hizo Y el [fecha]') ni en dos bloques pegados ('¡exclamación o insulto! + luego el dato aparte') — teje el dato y el insulto/comentario DENTRO de la misma frase, como si el dato fuera parte de la queja o la burla, no un anexo. Nada de empezar siempre con una interjección tipo '¡Me cago en la puta!' antes del dato: varía cómo empiezas cada respuesta (a veces con el dato, a veces con la pulla, a veces con una pregunta retórica) para que no suene a plantilla repetida mensaje tras mensaje.";
    instruccionesFinal +=
        " Regla estricta: si tienes una herramienta que EJECUTA algo real (pedir contenido, comprar, cambiar un dato...), nunca digas en tu respuesta que ya lo has hecho ('ya te lo he pedido', 'hecho', 'ya está') a menos que hayas llamado de verdad a esa herramienta en este mismo turno y haya devuelto éxito. Está prohibido inventarte o dar por hecho el resultado de una acción que no has ejecutado — si dudas si ejecutarla o no, ejecútala (tienes permiso), pero nunca narres una acción como completada sin haberla completado de verdad.";
    return instruccionesFinal;
}

// Composición del prompt base
function construirPartes({
    lineaPersonalidadActiva,
    instruccionesFinal,
    lineaPerfiles,
    lineaEquivalencias,
    lineaUsuarioActual,
    contextParts,
    imageAttachments,
}) {
    return [
        { text: lineaPersonalidadActiva },
        { text: instruccionesFinal },
        ...(lineaPerfiles ? [{ text: lineaPerfiles }] : []),
        { text: lineaEquivalencias },
        { text: lineaUsuarioActual },
        { text: "Conversación reciente (de más antiguo a más nuevo):" },
        ...contextParts.map((text) => ({ text })),
        ...(imageAttachments.length
            ? [{ text: "El usuario ha compartido una imagen adjunta a su último mensaje; coméntala si viene a cuento." }]
            : []),
        { text: "Responde ahora al último mensaje del usuario actual en 1-2 frases." },
    ];
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
            const { mensajePropuesta } = require("../../paneles/duendeEconomia");
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

        if (interaction.guildId && allowedChannel && channelId !== allowedChannel) {
            await safeEditReply(interaction, `⛔ Duende está restringido a <#${allowedChannel}>.`);
            return;
        }

        log.debug(
            `Mensaje recibido de ${userName} (${channelId})${interaction.id ? ` [msg ${interaction.id}]` : ""}: ${userInput ? userInput.length : 0} chars`,
        );

        // Comprueba límite diario
        if (!checkAndIncrementDailyLimit()) {
            log.warn(`Límite diario alcanzado (${DUENDE_DAILY_LIMIT} respuestas). Mensaje ignorado.`);
            await safeEditReply(interaction, `He alcanzado mi límite de respuestas por hoy (${DUENDE_DAILY_LIMIT}). ¡Hasta mañana!`);
            return;
        }

        const { instrucciones, personaObj } = construirInstrucciones(interaction, channelId, userName);

        // Inicializa historial si no existe
        if (!conversationHistory[channelId]) conversationHistory[channelId] = [];

        // Añade el mensaje del usuario al historial (con timestamp)
        conversationHistory[channelId].push({ role: "user", name: userName, text: userInput, timestamp: Date.now() });
        if (conversationHistory[channelId].length > historyLimit) {
            conversationHistory[channelId] = conversationHistory[channelId].slice(-historyLimit);
        }

        const lineaPerfiles = await lineaDePerfiles(interaction, userInput);
        const { nombrePorUsername, lineaEquivalencias, lineaUsuarioActual } = lineasDeUsuarios(interaction, userName);
        const lineaPersonalidadActiva = personaObj
            ? `Personalidad activa: ${personaObj.id} (${personaObj.title || "sin título"})`
            : "Personalidad activa: default";
        const contextParts = historialParaPrompt(channelId, historyLimit, nombrePorUsername);
        const instruccionesFinal = instruccionesDelTurno(instrucciones, channelId, userInput);

        const parts = construirPartes({
            lineaPersonalidadActiva,
            instruccionesFinal,
            lineaPerfiles,
            lineaEquivalencias,
            lineaUsuarioActual,
            contextParts,
            imageAttachments,
        });

        const activeModel = configuredModel || GEMINI_MODEL;
        log.debug(`Prompt enviado a Gemini (${activeModel}): [personalidad, instrucciones, equivalencias, historial reciente]`);
        if (DUENDE_LOG_FULL_PROMPT) {
            try {
                log.info(`Prompt completo Gemini:\n${buildPromptFromParts(parts)}`);
            } catch (promptLogErr) {
                log.warn("No se pudo registrar el prompt completo: " + (promptLogErr && promptLogErr.message));
            }
        }

        const toolContext = {
            guildId: interaction.guildId || null,
            userId: interaction.user.id,
            guild: interaction.guild || null,
            channelId,
            // 🧙 Lo que el Duende proponga (un reto, una apuesta, un préstamo: F-DU-03) sale después con botones.
            // Por voz (/escuchar) no hay dónde pulsarlos: ahí no se ofrecen esas herramientas.
            ...(interaction?.silentTextReply ? {} : { propuestas: [] }),
        };

        let text = await pedirRespuestaGemini({
            parts,
            activeModel,
            temperature,
            imageAttachments,
            toolContext,
            userName,
            userInput,
        });
        text = limitToSentences(text, 2);
        // Para la voz, sin las menciones de Discord de debajo (si no, el TTS leería "<@370221…>").
        const textoVoz = text;
        if (interaction.guild) {
            text = mentionizeKnownNames(text, interaction.guild);
        }

        const gifUrl = await buscarGifParaRespuesta(text, userInput);

        conversationHistory[channelId].push({ role: "duende", name: "Duende", text, timestamp: Date.now() });
        saveHistory();

        const sendText = recortarParaDiscord(text);
        await enviarRespuestaTexto(interaction, { sendText, gifUrl, propuestas: toolContext.propuestas });
        await responderPorVoz(client, interaction, textoVoz, sendText);
    } catch (err) {
        log.error("Error general en el comando:", err);
        try {
            await interaction.editReply({ content: "Ha ocurrido un error inesperado. Intenta de nuevo más tarde." });
        } catch (e) {
            log.debug(`Tampoco se pudo avisar del error: ${e.message}`);
        }
    }
}

const noOtra = (interaction) =>
    interaction.reply({
        content: "Solo puedes gestionar lo que recuerdo de ti. Para lo de otra persona, pídeselo a un admin.",
        flags: MessageFlags.Ephemeral,
    });
const noPermitido = (interaction) =>
    interaction.reply({ content: "⛔ Solo los administradores pueden hacer esto.", flags: MessageFlags.Ephemeral });

// El chat del Duende espera las opciones del comando: esta capa las traduce desde el formulario 💬 Hablar.
function adaptarHablar(interaction, texto) {
    const adaptada = Object.create(interaction);
    adaptada.options = {
        getSubcommand: () => "talk",
        getString: (nombre) => (nombre === "texto" ? texto : null),
        getUser: () => null,
        getBoolean: () => null,
    };
    adaptada.isChatInputCommand = () => true;
    return adaptada;
}

const vistaInicio = (interaction, aviso = null) => {
    const personalidad = perfiles.personalidadDeCanal(interaction.channelId)
        ? perfiles.obtenerPersonalidad(perfiles.personalidadDeCanal(interaction.channelId))
        : null;
    const payload = paneles.buildInicio({ esAdmin: esAdmin(interaction), personalidad });
    if (aviso) payload.embeds[0].setDescription(`${aviso}\n\n${payload.embeds[0].data.description}`);
    return payload;
};
const vistaRecuerdos = (interaction, objetivo, aviso = null) => paneles.buildRecuerdos({ esAdmin: esAdmin(interaction), objetivo, aviso });
const vistaPersonalidad = (interaction, aviso = null) => {
    const actualId = perfiles.personalidadDeCanal(interaction.channelId);
    return paneles.buildPersonalidad({
        esAdmin: esAdmin(interaction),
        canal: interaction.channelId,
        personalidades: perfiles.listarPersonalidades(),
        actual: actualId ? perfiles.obtenerPersonalidad(actualId) : null,
        aviso,
    });
};

// Responde en la misma pantalla si el formulario sale de un mensaje del panel; si no, en privado.
const responder = (interaction, payload) =>
    interaction.isFromMessage?.() ? interaction.update(payload) : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });

module.exports = {
    async handleRecuerdoAuto(client, interaction) {
        const [, decision, id] = /^recuerdo_auto_(ok|no)_(\d+)$/.exec(interaction.customId) || [];
        if (!decision) return;
        const r = recuerdosAuto.resolver(id, interaction.user.id, decision === "ok");
        if (!r.ok) return interaction.reply({ content: `⚠️ ${r.mensaje}`, flags: MessageFlags.Ephemeral });
        return interaction.update({ content: r.mensaje, embeds: [], components: [] });
    },

    componentHandlers: [
        // 🧠 Recuerdos automáticos (#15): ✅ Guardar / ❌ Descartar de la propuesta (llega por DM a los admins).
        { types: ["button"], prefixes: ["recuerdo_auto_"], method: "handleRecuerdoAuto", acl: "duende" },
        { types: ["button"], prefixes: ["duendepanel_"], method: "handleButton", acl: "duende" },
        { types: ["stringSelect"], prefixes: ["duendepanel_"], method: "handleSelect", acl: "duende" },
        { types: ["userSelect"], prefixes: ["duendepanel_"], method: "handleUserSelect", acl: "duende" },
        { types: ["modal"], prefixes: ["duendepanel_"], method: "handleModal", acl: "duende" },
    ],
    data: new SlashCommandBuilder().setName("duende").setDescription("🤖 El Duende: habla con él, sus recuerdos y sus personalidades"),
    hablar,

    // /duende: abre el panel (solo lo ve quien lo abre).
    async run(client, interaction) {
        await interaction.reply({ ...vistaInicio(interaction), flags: MessageFlags.Ephemeral });
    },

    async handleButton(client, interaction) {
        const id = interaction.customId;
        const admin = esAdmin(interaction);
        if (id === "duendepanel_inicio") return interaction.update(vistaInicio(interaction));
        if (id === "duendepanel_hablar") {
            const modal = new ModalBuilder().setCustomId("duendepanel_modal_hablar").setTitle("💬 Hablar con el Duende");
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("texto")
                        .setLabel("¿Qué le quieres decir?")
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(1500)
                        .setRequired(true),
                ),
            );
            return interaction.showModal(modal);
        }
        if (id === "duendepanel_recuerdos") return interaction.update(vistaRecuerdos(interaction, interaction.user));
        if (id === "duendepanel_personalidad") return interaction.update(vistaPersonalidad(interaction));

        if (id.startsWith("duendepanel_anotar_") || id.startsWith("duendepanel_olvidar_")) {
            const objetivoId = id.replace(/^duendepanel_(anotar|olvidar)_/, "");
            if (objetivoId !== interaction.user.id && !admin) return noOtra(interaction);
            const objetivo =
                objetivoId === interaction.user.id ? interaction.user : await interaction.client.users.fetch(objetivoId).catch(() => null);
            if (!objetivo) return interaction.reply({ content: "❌ No encuentro a esa persona.", flags: MessageFlags.Ephemeral });

            if (id.startsWith("duendepanel_anotar_")) {
                const modal = new ModalBuilder()
                    .setCustomId(`duendepanel_modal_anotar_${objetivo.id}`)
                    .setTitle(`✏️ Anotar sobre ${objetivo.username}`.slice(0, 45));
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("nota")
                            .setLabel("Qué debe recordar el Duende")
                            .setStyle(TextInputStyle.Paragraph)
                            .setMaxLength(200)
                            .setRequired(true),
                    ),
                );
                return interaction.showModal(modal);
            }

            // Olvidar: borra las notas (no la descripción del perfil, que editan los admins en /paneladmin).
            const notas = perfiles.olvidarNotas(objetivo);
            if (!notas.length)
                return interaction.update(vistaRecuerdos(interaction, objetivo, "No tengo notas guardadas sobre esa persona."));
            log.warn(
                `${interaction.user.tag} (${interaction.user.id}) borró ${notas.length} notas sobre ${objetivo.username}: ${JSON.stringify(notas)}`,
            );
            return interaction.update(
                vistaRecuerdos(interaction, objetivo, `🗑️ Olvidadas ${notas.length} notas sobre **${objetivo.username}**.`),
            );
        }

        // Solo admins: personalidades.
        if (id === "duendepanel_add" || id === "duendepanel_quitar") {
            if (!admin) return noPermitido(interaction);
            if (id === "duendepanel_quitar") {
                return interaction.update(paneles.buildQuitar({ personalidades: perfiles.listarPersonalidades() }));
            }
            const modal = new ModalBuilder().setCustomId("duendepanel_modal_add").setTitle("➕ Añadir personalidad");
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("id")
                        .setLabel("ID único (sin espacios)")
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(40)
                        .setRequired(true),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("title")
                        .setLabel("Título legible")
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(60)
                        .setRequired(true),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("systeminstructions")
                        .setLabel("Instrucciones del sistema (prompt)")
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(4000)
                        .setRequired(true),
                ),
            );
            return interaction.showModal(modal);
        }
    },

    // Menús de personalidad del canal (duendepanel_canal) y de quitar una (duendepanel_quitar_select).
    async handleSelect(client, interaction) {
        if (!esAdmin(interaction)) return noPermitido(interaction);
        const valor = interaction.values[0];
        if (interaction.customId === "duendepanel_canal") {
            if (!perfiles.obtenerPersonalidad(valor))
                return interaction.update(vistaPersonalidad(interaction, `❌ Personalidad '${valor}' no encontrada.`));
            perfiles.asignarPersonalidadCanal(interaction.channelId, valor);
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "duende.personality.set_channel",
                details: { channelId: interaction.channelId, personality: valor },
            });
            return interaction.update(vistaPersonalidad(interaction, `✅ Personalidad del canal: **${valor}**.`));
        }
        if (interaction.customId === "duendepanel_quitar_select") {
            if (!perfiles.borrarPersonalidad(valor))
                return interaction.update(vistaInicio(interaction, `❌ Personalidad '${valor}' no encontrada.`));
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: "duende.personality.remove",
                details: { id: valor },
            });
            return interaction.update(vistaInicio(interaction, `🗑️ Personalidad '${valor}' eliminada.`));
        }
    },

    // Selector de persona (solo admins): sus recuerdos.
    async handleUserSelect(client, interaction) {
        if (!esAdmin(interaction)) return noPermitido(interaction);
        const objetivo = interaction.users.first();
        return interaction.update(vistaRecuerdos(interaction, objetivo));
    },

    async handleModal(client, interaction) {
        const id = interaction.customId;
        if (id === "duendepanel_modal_hablar") {
            // La respuesta del Duende sale en el canal, como un mensaje normal; el formulario se cierra sin más.
            return hablar(client, adaptarHablar(interaction, interaction.fields.getTextInputValue("texto")));
        }
        if (id.startsWith("duendepanel_modal_anotar_")) {
            const objetivoId = id.replace("duendepanel_modal_anotar_", "");
            if (objetivoId !== interaction.user.id && !esAdmin(interaction)) return noOtra(interaction);
            const objetivo =
                objetivoId === interaction.user.id ? interaction.user : await interaction.client.users.fetch(objetivoId).catch(() => null);
            if (!objetivo) return interaction.reply({ content: "❌ No encuentro a esa persona.", flags: MessageFlags.Ephemeral });
            const nota = interaction.fields.getTextInputValue("nota").trim();
            const nombre = apodos.nombreDe(interaction.guildId, objetivo.id) || objetivo.globalName || objetivo.username;
            perfiles.anotar(objetivo, nota, nombre);
            log.info(`${interaction.user.tag} guardó una nota sobre ${objetivo.username} (${objetivo.id}): "${nota}"`);
            return responder(interaction, vistaRecuerdos(interaction, objetivo, `📝 Anotado sobre **${objetivo.username}**: "${nota}"`));
        }
        if (id === "duendepanel_modal_add") {
            if (!esAdmin(interaction)) return noPermitido(interaction);
            const pid = interaction.fields.getTextInputValue("id").trim();
            const title = interaction.fields.getTextInputValue("title").trim();
            const si = interaction.fields.getTextInputValue("systeminstructions").trim();
            if (!pid || /\s/.test(pid))
                return responder(interaction, vistaInicio(interaction, "❌ El ID no puede estar vacío ni tener espacios."));
            const existia = perfiles.guardarPersonalidad({ id: pid, title, systemInstructions: si });
            adminAudit.logAdminAction({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                action: existia ? "duende.personality.edit" : "duende.personality.add",
                details: { id: pid, title, chars: si.length },
            });
            return responder(interaction, vistaInicio(interaction, `✅ Personalidad '${pid}' ${existia ? "actualizada" : "añadida"}.`));
        }
    },
};
