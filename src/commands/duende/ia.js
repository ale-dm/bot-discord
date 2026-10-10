/**
 * /ia — Comando de consulta a agentes de inteligencia artificial especializados.
 *
 * Parámetros:
 *   - prompt      (requerido) Texto de la consulta
 *   - agente      (opcional)  Tipo de agente IA (selector)
 *   - generar_imagen (opcional) Booleano — genera también una imagen basada en la consulta
 *
 * El selector de agente es una opción de slash command: Discord admite hasta 25 opciones y hoy hay 8 (ver AGENTES).
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { generateContentWithTimeout } = require("../../services/geminiClient");
const { logInfo, logError, logWarn } = require("../../core/logger");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30_000);
const IMAGE_GEN_MODEL = process.env.IMAGE_GEN_MODEL || "gemini-2.0-flash-exp-image-generation";
const IMAGE_GEN_TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS || 120_000);
const IA_COOLDOWN_MS = Number(process.env.IA_COOLDOWN_MS || 15_000);

const userCooldowns = new Map();

// ─── Catálogo de agentes ───────────────────────────────────────────────────────
const AGENTES = {
    general: {
        nombre: "🤖 Asistente General",
        color: 0x5865f2,
        systemInstruction:
            "Eres un asistente de IA útil, claro y conciso. Respondes en español a menos que te pidan " +
            "otro idioma. Das respuestas precisas, bien estructuradas y con ejemplos cuando convenga.",
    },
    tecnico: {
        nombre: "💻 Asistente Técnico",
        color: 0x00adb5,
        systemInstruction:
            "Eres un asistente técnico con amplio conocimiento en informática, programación, sistemas " +
            "y tecnología en general. Explicas conceptos técnicos de forma clara, incluyes ejemplos " +
            "de código cuando ayuda a entender, y siempre buscas la solución más práctica y directa. " +
            "Respondes en español.",
    },
    creativo: {
        nombre: "🎨 Asistente Creativo",
        color: 0xff69b4,
        systemInstruction:
            "Eres un asistente creativo con talento para la escritura, el diseño, el arte y la " +
            "generación de ideas. Ayudas a crear textos, historias, nombres, conceptos o cualquier " +
            "cosa que requiera imaginación. Eres expresivo, original y entusiasta. " +
            "Respondes en español.",
    },
    profesor: {
        nombre: "📚 Profesor / Explicador",
        color: 0xffd700,
        systemInstruction:
            "Eres un profesor paciente y didáctico capaz de explicar cualquier tema de forma clara " +
            "y adaptada al nivel del alumno. Usas analogías, ejemplos cotidianos y resúmenes para " +
            "que los conceptos queden bien claros. Si el tema es complejo, lo divides en partes. " +
            "Respondes en español.",
    },
    negocio: {
        nombre: "💼 Asistente de Negocios",
        color: 0x1da1f2,
        systemInstruction:
            "Eres un asistente especializado en negocios, emprendimiento y estrategia. Ayudas con " +
            "planes de negocio, análisis de mercado, toma de decisiones, comunicación profesional y " +
            "todo lo relacionado con el mundo empresarial. Eres directo, pragmático y orientado a " +
            "resultados. Respondes en español.",
    },
    coach: {
        nombre: "🧘 Coach Personal",
        color: 0x00cc66,
        systemInstruction:
            "Eres un coach personal empático y motivador. Ayudas a las personas a reflexionar, " +
            "tomar mejores decisiones, superar bloqueos y alcanzar sus metas personales o " +
            "profesionales. Escuchas activamente, haces preguntas poderosas y ofreces perspectivas " +
            "que ayudan a crecer. Respondes en español.",
    },
    cientifico: {
        nombre: "🔬 Asistente Científico",
        color: 0x3498db,
        systemInstruction:
            "Eres un asistente con mentalidad científica. Analizas problemas con rigor, buscas " +
            "evidencias, distingues hechos de opiniones y explicas fenómenos del mundo natural y " +
            "social. Cubres ciencias exactas, naturales, sociales y humanidades. " +
            "Respondes en español.",
    },
    filosofo: {
        nombre: "🧠 Filósofo / Debate",
        color: 0x9b59b6,
        systemInstruction:
            "Eres un interlocutor filosófico y dialéctico. Te encanta debatir ideas, explorar " +
            "diferentes puntos de vista, cuestionar supuestos y profundizar en temas de ética, " +
            "existencia, política o cualquier asunto que merezca reflexión. Eres curioso, abierto " +
            "y estimulante intelectualmente. Respondes en español.",
    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Divide texto largo en chunks seguros para embeds de Discord (≤4096 chars).
 * Intenta cortar en saltos de línea para no partir código a mitad.
 */
function chunkText(text, maxLen = 4000) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let splitAt = remaining.lastIndexOf("\n", maxLen);
        if (splitAt < maxLen / 2) splitAt = maxLen;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

// ─── Llamada a Gemini con system instruction personalizada ────────────────────
async function llamarGemini(promptText, systemInstruction) {
    if (!GEMINI_API_KEY) throw new Error("Falta GOOGLE_API_KEY en las variables de entorno");

    const response = await generateContentWithTimeout(
        {
            model: GEMINI_MODEL,
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            config: {
                systemInstruction,
                maxOutputTokens: 2048,
                temperature: 0.7,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                ],
            },
        },
        GEMINI_TIMEOUT_MS,
        "Gemini",
    );

    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Gemini bloqueó la petición (${blockReason})`);

    const text = response?.text || "";
    if (!text) throw new Error("Respuesta vacía de Gemini");
    return text;
}

// ─── Generación de imagen vía REST (igual que imagen.js) ─────────────────────
const IMAGE_GEN_MAX_RETRIES_IA = Number(process.env.IMAGE_GEN_MAX_RETRIES || 3);
const IMAGE_GEN_RETRY_BASE_MS_IA = Number(process.env.IMAGE_GEN_RETRY_BASE_MS || 5_000);

async function generarImagenREST(promptStr, signal = undefined) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: promptStr }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };

    let lastError;
    for (let attempt = 0; attempt <= IMAGE_GEN_MAX_RETRIES_IA; attempt++) {
        if (attempt > 0) {
            const backoffMs = IMAGE_GEN_RETRY_BASE_MS_IA * Math.pow(2, attempt - 1);
            logWarn(`[IA/Imagen] Reintento ${attempt}/${IMAGE_GEN_MAX_RETRIES_IA} tras ${backoffMs / 1000}s`);
            await new Promise((r) => setTimeout(r, backoffMs));
            if (signal?.aborted) throw signal.reason || new Error("Abortado");
        }

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal,
        });

        if (res.status === 503 || res.status === 429) {
            const errText = await res.text();
            lastError = { status: res.status, text: errText };
            if (attempt < IMAGE_GEN_MAX_RETRIES_IA) continue;
            throw new Error(`Error API imagen (${res.status}): ${errText.slice(0, 300)}`);
        }

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Error API imagen (${res.status}): ${errText.slice(0, 300)}`);
        }

        const data = await res.json();
        const partsOut = data.candidates?.[0]?.content?.parts || [];
        const imagePart = partsOut.find((p) => p.inlineData?.data);

        if (!imagePart) {
            const textParts = partsOut
                .filter((p) => p.text)
                .map((p) => p.text)
                .join(" ");
            const finishReason = data.candidates?.[0]?.finishReason || "?";
            const blockReason = data.promptFeedback?.blockReason || null;
            logWarn(
                `[IA/Imagen] Sin imagen en intento ${attempt + 1}/${IMAGE_GEN_MAX_RETRIES_IA + 1} — finishReason: ${finishReason}${blockReason ? ", blockReason: " + blockReason : ""}${textParts ? ", texto: " + textParts.slice(0, 200) : ""}`,
            );

            if (blockReason) throw new Error(`Contenido bloqueado por la API: ${blockReason}`);

            lastError = { status: "NO_IMAGE", text: `finishReason: ${finishReason}` };
            if (attempt < IMAGE_GEN_MAX_RETRIES_IA) continue;
            throw new Error("La API no devolvió ninguna imagen");
        }

        return {
            buffer: Buffer.from(imagePart.inlineData.data, "base64"),
            mimeType: imagePart.inlineData.mimeType || "image/png",
        };
    }
    throw lastError ? new Error(`Error API imagen (${lastError.status}): ${lastError.text}`) : new Error("Error desconocido");
}

// ─── Comando ──────────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName("ia")
        .setDescription("Consulta a un agente de inteligencia artificial especializado.")
        .addStringOption((opt) =>
            opt.setName("prompt").setDescription("¿Qué quieres preguntarle al agente?").setRequired(true).setMaxLength(2000),
        )
        .addStringOption((opt) =>
            opt
                .setName("agente")
                .setDescription("Elige el tipo de agente IA (por defecto: Asistente General)")
                .setRequired(false)
                .addChoices(
                    { name: "🤖 Asistente General", value: "general" },
                    { name: "💻 Asistente Técnico", value: "tecnico" },
                    { name: "🎨 Asistente Creativo", value: "creativo" },
                    { name: "📚 Profesor / Explicador", value: "profesor" },
                    { name: "💼 Asistente de Negocios", value: "negocio" },
                    { name: "🧘 Coach Personal", value: "coach" },
                    { name: "🔬 Asistente Científico", value: "cientifico" },
                    { name: "🧠 Filósofo / Debate", value: "filosofo" },
                ),
        )
        .addBooleanOption((opt) =>
            opt
                .setName("generar_imagen")
                .setDescription("¿Generar también una imagen basada en tu consulta? (opcional)")
                .setRequired(false),
        ),

    async run(client, interaction) {
        await interaction.deferReply();

        if (!GEMINI_API_KEY) {
            return interaction.editReply({ content: "❌ La API de Gemini no está configurada en el servidor." });
        }

        // ── Cooldown por usuario ─────────────────────────────────────────────
        const userId = interaction.user.id;
        const lastUsed = userCooldowns.get(userId) || 0;
        const remaining = IA_COOLDOWN_MS - (Date.now() - lastUsed);
        if (remaining > 0) {
            const secs = Math.ceil(remaining / 1000);
            return interaction.editReply({ content: `⏳ Espera **${secs}s** antes de usar /ia de nuevo.` });
        }
        userCooldowns.set(userId, Date.now());

        const promptText = interaction.options.getString("prompt");
        const agenteKey = interaction.options.getString("agente") || "general";
        const generarImagen = interaction.options.getBoolean("generar_imagen") ?? false;

        const agente = AGENTES[agenteKey] ?? AGENTES.general;

        logInfo(`[IA] ${interaction.user.tag} → agente: ${agenteKey} | imagen: ${generarImagen} | prompt: "${promptText.slice(0, 80)}"`);

        try {
            // ── Consulta al agente ───────────────────────────────────────────
            const respuesta = await llamarGemini(promptText, agente.systemInstruction);

            // ── Construir embed(s) de respuesta ──────────────────────────────
            const chunks = chunkText(respuesta);

            const mainEmbed = new EmbedBuilder()
                .setColor(agente.color)
                .setAuthor({
                    name: agente.nombre,
                    iconURL: client.user.displayAvatarURL(),
                })
                .setDescription(chunks[0])
                .addFields({
                    name: "📝 Consulta",
                    value: promptText.length > 256 ? promptText.slice(0, 253) + "…" : promptText,
                })
                .setFooter({
                    text: `Solicitado por ${interaction.user.username}`,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
                })
                .setTimestamp();

            const replyPayload = { embeds: [mainEmbed] };

            // Continuaciones si la respuesta es larga
            for (let i = 1; i < chunks.length; i++) {
                replyPayload.embeds.push(
                    new EmbedBuilder()
                        .setColor(agente.color)
                        .setDescription(chunks[i])
                        .setFooter({ text: `Parte ${i + 1} de ${chunks.length}` }),
                );
            }

            // ── Generación de imagen (opcional) ──────────────────────────────
            if (generarImagen) {
                try {
                    logInfo(`[IA] Generando imagen para "${promptText.slice(0, 60)}"`);
                    const imgPrompt = `Ilustración visual que representa: ${promptText.slice(0, 400)}`;
                    const timeoutSignal = AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS);
                    let imgResult;
                    try {
                        imgResult = await generarImagenREST(imgPrompt, timeoutSignal);
                    } catch (genErr) {
                        if (timeoutSignal.aborted) throw new Error(`Timeout generando imagen tras ${IMAGE_GEN_TIMEOUT_MS / 1000}s`);
                        throw genErr;
                    }
                    const ext = imgResult.mimeType.split("/")[1] || "png";
                    replyPayload.files = [new AttachmentBuilder(imgResult.buffer, { name: `ia_imagen.${ext}` })];
                    mainEmbed.addFields({ name: "🎨 Imagen", value: "(adjunta abajo)" });
                    logInfo(`[IA] Imagen generada (${(imgResult.buffer.length / 1024).toFixed(1)} KB)`);
                } catch (imgErr) {
                    logWarn(`[IA] No se pudo generar imagen: ${imgErr.message}`);
                    mainEmbed.addFields({
                        name: "⚠️ Imagen",
                        value: "No se pudo generar la imagen en este momento. Prueba más tarde.",
                    });
                }
            }

            await interaction.editReply(replyPayload);
            logInfo(`[IA] Respuesta enviada a ${interaction.user.tag} (agente: ${agenteKey})`);
        } catch (err) {
            userCooldowns.delete(userId);
            const msg = err?.message || String(err);
            logError(`[IA] Error respondiendo a ${interaction.user.tag}:`, err);

            let userMsg = "❌ Hubo un error al consultar el agente de IA. Inténtalo de nuevo.";
            const lower = msg.toLowerCase();

            if (lower.includes("timeout")) {
                userMsg = "❌ El agente tardó demasiado en responder. Prueba con una consulta más corta.";
            } else if (lower.includes("quota") || lower.includes("429") || lower.includes("resource_exhausted")) {
                userMsg = "❌ Se ha agotado la cuota de la API. Inténtalo en unos minutos.";
            } else if (lower.includes("503") || lower.includes("high demand") || lower.includes("unavailable")) {
                userMsg = "❌ El servicio de IA está saturado en este momento. Inténtalo en un rato.";
            } else if (lower.includes("safety") || lower.includes("blocked") || lower.includes("prohibited")) {
                userMsg = "❌ Tu consulta fue bloqueada por los filtros de seguridad. Reformula la pregunta.";
            }

            try {
                await interaction.editReply({ content: userMsg });
            } catch (e) {
                logWarn(`[IA] Tampoco se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
