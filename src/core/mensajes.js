// 💬 Mensajes de texto: XP por escribir, cuándo responde el Duende (si le hablan o por probabilidad) y los filtros
// (duplicados, mensajes de bajo esfuerzo que solo reciben una reacción).
const { createLogger } = require("./logger");
const { whoWhere, cut } = require("./interactionLog");
const guildSettings = require("../systems/guildSettings");
const xpSystem = require("../systems/xpSystem");
const duendeCommand = require("../commands/duende/duende");

const msgLog = createLogger("Mensajes");

const DUENDE_TEXT_REPLY_PROB = Math.max(0, Math.min(1, Number(process.env.DUENDE_TEXT_REPLY_PROB || 0.25)));
// Ventana de conversación activa: tras hablarle (o que él hable), sube la probabilidad
// de respuesta para que un intercambio no se corte solo por mala suerte del dado.
const DUENDE_ACTIVE_TEXT_REPLY_PROB = Math.max(0, Math.min(1, Number(process.env.DUENDE_ACTIVE_TEXT_REPLY_PROB ?? 1)));
const DUENDE_ACTIVE_WINDOW_MS = Number(process.env.DUENDE_ACTIVE_WINDOW_MS || 3 * 60 * 1000);
const duendeActiveChannels = new Map(); // channelId -> timestamp del último "enganche"

// Guardarraíl: si Discord (gateway resume, reconexión...) entrega el mismo mensaje dos veces,
// procesarlo dos veces podría disparar dos veces una acción real (ej. dos peticiones de Seerr
// para el mismo mensaje). El id de mensaje de Discord es único e inmutable, así que basta con
// no volver a procesar uno ya visto recientemente.
const recentlyProcessedMessageIds = new Map(); // messageId -> timestamp
const MESSAGE_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
function isDuplicateMessage(messageId) {
    const now = Date.now();
    if (recentlyProcessedMessageIds.size > 500) {
        const cutoff = now - MESSAGE_DEDUPE_WINDOW_MS;
        for (const [id, ts] of recentlyProcessedMessageIds) {
            if (ts < cutoff) recentlyProcessedMessageIds.delete(id);
        }
    }
    if (recentlyProcessedMessageIds.has(messageId)) return true;
    recentlyProcessedMessageIds.set(messageId, now);
    return false;
}

// Mensajes de bajo esfuerzo (risas, "xd", un emoji suelto): en vez de gastar una llamada
// a la IA para generar una respuesta completa, el Duende solo reacciona — más barato y
// más parecido a cómo reacciona alguien real a ese tipo de mensajes.
const LOW_EFFORT_REACTIONS = ["😂", "🤣", "👀", "💀", "😏", "🔥"];
function isLowEffortMessage(text) {
    const t = text.trim();
    if (!t) return false;
    if (/^(ja|je|ji|jo|ju|aj|js){2,}!*$/i.test(t)) return true; // jajaja, jeje, jsjsjs, ajaj...
    if (/^(lo+l+|lmao+|xd+)!*$/i.test(t)) return true;
    // Muy corto y sin ninguna letra (solo emoji/puntuación/signos)
    if (t.length <= 6 && !/[a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ]/.test(t)) return true;
    return false;
}

/**
 * ¿Contesta el Duende a este mensaje? Si el canal tiene uno asignado, solo ahí. Si no le hablan a él, con probabilidad
 * (más alta mientras la charla del canal está activa). Refresca la ventana de charla activa al contestar.
 */
function debeContestar(client, message, userText) {
    if (message.guildId) {
        const duendeCfg = guildSettings.getSettings(message.guildId).duende;
        if (duendeCfg.allowed_channel_id && message.channelId !== duendeCfg.allowed_channel_id) return false;
    }
    // Cuenta como "le hablan directamente" tanto la mención real de Discord como
    // decir su nombre en texto plano ("duende, ¿qué opinas?"), sin necesidad del @.
    const isMentioned = !!client.user && message.mentions?.has?.(client.user.id);
    const mentionsNameInText = /\bduende\b/i.test(userText);
    const isAddressed = isMentioned || mentionsNameInText;

    const now = Date.now();
    const lastActiveAt = duendeActiveChannels.get(message.channelId) || 0;
    const withinActiveWindow = now - lastActiveAt < DUENDE_ACTIVE_WINDOW_MS;
    const effectiveProb = withinActiveWindow ? DUENDE_ACTIVE_TEXT_REPLY_PROB : DUENDE_TEXT_REPLY_PROB;

    if (!isAddressed && Math.random() > effectiveProb) {
        msgLog.debug(
            `Duende no responde por probabilidad (${Math.round(effectiveProb * 100)}%${withinActiveWindow ? ", ventana activa" : ""}) · ${message.author.tag}`,
        );
        return false;
    }
    // Seguimos "enganchados" a esta charla: refresca la ventana de conversación activa.
    duendeActiveChannels.set(message.channelId, now);
    return true;
}

// Mensajes de bajo esfuerzo ("jajaja", un emoji...) solo reciben una reacción, sin respuesta.
async function reaccionarBajoEsfuerzo(message) {
    try {
        const emoji = LOW_EFFORT_REACTIONS[Math.floor(Math.random() * LOW_EFFORT_REACTIONS.length)];
        await message.react(emoji);
        msgLog.debug(`Mensaje de bajo esfuerzo: solo reacción ${emoji} · ${message.author.tag}`);
    } catch (e) {
        msgLog.warn(`No se pudo reaccionar al mensaje de bajo esfuerzo · ${whoWhere(message)}: ${e.message}`);
    }
}

// Si el mensaje trae imágenes (meme, captura...), las descarga para que el Duende también "las vea" al generar la
// respuesta, no solo lea el texto. Como mucho dos, y las que fallan se saltan.
async function descargarImagenes(imageAttachmentsRaw) {
    const imageAttachments = [];
    for (const att of imageAttachmentsRaw.slice(0, 2)) {
        try {
            const res = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) {
                msgLog.warn(`No se pudo descargar imagen adjunta para Duende: HTTP ${res.status}`);
                continue;
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            imageAttachments.push({ buffer, mime: (att.contentType || "image/png").split(";")[0].trim() });
        } catch (e) {
            msgLog.warn(`No se pudo descargar imagen adjunta para Duende: ${e.message}`);
        }
    }
    return imageAttachments;
}

/**
 * La interacción que espera duendeCommand.hablar, armada desde un mensaje de texto. `estado.respondido` se pone a
 * true en cuanto sale algo por el canal, para saber si hay que mandar el aviso de respaldo.
 */
function interaccionDeMensaje(message, { effectiveText, imageAttachments, estado }) {
    // Detectar si el mensaje es en un canal de texto de servidor
    const isGuild = !!message.guild && !!message.member && !!message.guild.id;
    return {
        id: message.id,
        deferReply: async () => {},
        editReply: async (payload) => {
            const content = typeof payload === "string" ? payload : payload?.content;
            if (content === undefined || content === null) {
                throw new Error("Contenido vacío en editReply");
            }
            estado.respondido = true;
            return message.channel.send(String(content));
        },
        followUp: async (payload) => {
            // Las propuestas del Duende (F-DU-03) llevan embed y botones; lo demás es solo texto.
            if (payload?.embeds || payload?.components) {
                estado.respondido = true;
                const { content, embeds, components, allowedMentions } = payload;
                return message.channel.send({ ...(content ? { content } : {}), embeds, components, allowedMentions });
            }
            const content = typeof payload === "string" ? payload : payload?.content;
            if (content === undefined || content === null) {
                throw new Error("Contenido vacío en followUp");
            }
            estado.respondido = true;
            return message.channel.send(String(content));
        },
        options: {
            getSubcommand: () => "talk",
            getString: (name) => {
                if (!name) return null;
                if (name === "texto") return effectiveText;
                if (name === "personality") return null;
                return null;
            },
        },
        imageAttachments,
        user: message.author,
        channel: message.channel,
        guild: isGuild ? message.guild : undefined,
        guildId: isGuild ? message.guild.id : undefined,
    };
}

/** Un mensaje de texto que puede ser para el Duende: decide si responde, y cómo. */
async function atenderComoDuende(client, message, userText, imageAttachmentsRaw) {
    try {
        if (!debeContestar(client, message, userText)) return;
        if (isLowEffortMessage(userText)) return reaccionarBajoEsfuerzo(message);

        const imageAttachments = await descargarImagenes(imageAttachmentsRaw);
        const effectiveText = userText || (imageAttachments.length ? "(el usuario ha compartido una imagen sin texto)" : "");

        // Sin await a propósito (no hace falta esperar al "escribiendo..."), pero con catch:
        // si falta el permiso, antes acababa como unhandledRejection.
        message.channel.sendTyping().catch((e) => msgLog.warn(`sendTyping falló en ${message.channelId}: ${e.message}`));
        const estado = { respondido: false };
        const fakeInteraction = interaccionDeMensaje(message, { effectiveText, imageAttachments, estado });
        const t0 = Date.now();
        await duendeCommand.hablar(client, fakeInteraction);
        if (!estado.respondido) {
            await message.channel.send("⚠️ No he podido responder ahora mismo. Prueba otra vez en unos segundos.");
            msgLog.warn(`Duende no envió respuesta visible; fallback aplicado · ${whoWhere(message)}`);
        }
        msgLog.info(
            `Duende respondió a "${cut(userText, 120)}"${imageAttachments.length ? ` (+${imageAttachments.length} imagen)` : ""} · ${whoWhere(message)} · ${Date.now() - t0} ms`,
        );
    } catch (error) {
        msgLog.error(`Error respondiendo como Duende · ${whoWhere(message)}`, error);
        try {
            await message.channel.send("Hubo un error al procesar tu solicitud. Intenta de nuevo más tarde.");
        } catch (e) {
            msgLog.debug(`Tampoco se pudo enviar el mensaje de error: ${e.message}`);
        }
    }
}

function registrarMensajes(client) {
    // Manejo de mensajes de texto
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;
        if (isDuplicateMessage(message.id)) {
            msgLog.info(`Mensaje duplicado ignorado (id ${message.id}) de ${message.author.tag}`);
            return;
        }

        try {
            await xpSystem.handleMessageXp(message);
        } catch (e) {
            msgLog.error(`Error dando XP por mensaje · ${whoWhere(message)}`, e);
        }

        // 🧠 Recuerdos automáticos del Duende (#15): mira la conversación en segundo plano; no bloquea nada.
        try {
            require("../systems/duende/recuerdosAuto").observar(message);
        } catch (e) {
            msgLog.error(`Error mirando la conversación para los recuerdos del Duende · ${whoWhere(message)}`, e);
        }

        const userText = message.content.trim();
        const imageAttachmentsRaw = message.attachments
            ? [...message.attachments.values()].filter((a) => (a.contentType || "").startsWith("image/"))
            : [];

        // Evitar procesar mensajes que sean comandos (slash o que empiecen por /).
        // Un mensaje vacío solo se descarta si tampoco trae una imagen adjunta.
        if (userText.startsWith("/")) return;
        if (!userText && imageAttachmentsRaw.length === 0) return;

        await atenderComoDuende(client, message, userText, imageAttachmentsRaw);
    });
}

module.exports = { isDuplicateMessage, isLowEffortMessage, registrarMensajes };
