const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { logInfo, logError, logWarn } = require("../../core/logger");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";

// gemini-2.0-flash-exp-image-generation genera imágenes nativas via generateContent (v1beta)
const IMAGE_GEN_MODEL = process.env.IMAGE_GEN_MODEL || "gemini-2.0-flash-exp-image-generation";
const IMAGE_GEN_TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS || 120_000);
const IMAGE_GEN_MAX_RETRIES = Number(process.env.IMAGE_GEN_MAX_RETRIES || 3);
const IMAGE_GEN_RETRY_BASE_MS = Number(process.env.IMAGE_GEN_RETRY_BASE_MS || 5_000);

// Cooldown por usuario en ms
const USER_COOLDOWN_MS = Number(process.env.IMAGE_GEN_COOLDOWN_MS || 45_000);
const userCooldowns = new Map();

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/heic", "image/heif"]);

const EXT_FROM_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Llama directamente al endpoint REST de Nano Banana via :generateContent.
 * @param {string} promptStr - Texto del prompt.
 * @param {{ buffer: Buffer, mime: string }[]} images - Imágenes de referencia opcionales.
 */
async function generateImageREST(promptStr, images = [], signal = undefined) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [{ text: promptStr }];
    for (const img of images) {
        parts.push({
            inlineData: {
                mimeType: img.mime,
                data: img.buffer.toString("base64"),
            },
        });
    }

    const payload = {
        contents: [{ role: "user", parts }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
        },
    };

    let lastError;
    for (let attempt = 0; attempt <= IMAGE_GEN_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const backoffMs = IMAGE_GEN_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            logWarn(
                `[Imagen] Reintento ${attempt}/${IMAGE_GEN_MAX_RETRIES} tras ${backoffMs / 1000}s (error previo: ${lastError?.status ?? "?"})`,
            );
            await delay(backoffMs);
            if (signal?.aborted) throw signal.reason || new Error("Abortado");
        }

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal,
        });

        if (res.status === 503 || res.status === 429) {
            const errorText = await res.text();
            lastError = { status: res.status, text: errorText };
            if (attempt < IMAGE_GEN_MAX_RETRIES) continue;
            throw new Error(`Error API (${res.status}): ${errorText}`);
        }

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Error API (${res.status}): ${errorText}`);
        }

        const data = await res.json();
        const parts_out = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts_out.find((p) => p.inlineData?.data);

        if (!imagePart) {
            // Loguear qué devolvió la API para diagnóstico
            const textParts = parts_out
                .filter((p) => p.text)
                .map((p) => p.text)
                .join(" ");
            const finishReason = data.candidates?.[0]?.finishReason || "?";
            const blockReason = data.promptFeedback?.blockReason || null;
            logWarn(
                `[Imagen] Sin imagen en intento ${attempt + 1}/${IMAGE_GEN_MAX_RETRIES + 1} — finishReason: ${finishReason}${blockReason ? ", blockReason: " + blockReason : ""}${textParts ? ", texto: " + textParts.slice(0, 200) : ""}`,
            );

            if (blockReason) {
                throw new Error(`Contenido bloqueado por la API: ${blockReason}`);
            }

            lastError = { status: "NO_IMAGE", text: `finishReason: ${finishReason}` };
            if (attempt < IMAGE_GEN_MAX_RETRIES) continue;
            throw new Error("La API respondió, pero no incluyó ninguna imagen.");
        }

        return {
            imageBuffer: Buffer.from(imagePart.inlineData.data, "base64"),
            mimeType: imagePart.inlineData.mimeType || "image/png",
        };
    }
    // Should never reach here, but satisfy linter
    throw lastError ? new Error(`Error API (${lastError.status}): ${lastError.text}`) : new Error("Error desconocido");
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("imagen")
        .setDescription("Genera o edita una imagen con IA.")
        .addStringOption((option) =>
            option
                .setName("descripcion")
                .setDescription("Describe la imagen que quieres generar o qué cambio aplicar a la imagen adjunta")
                .setRequired(true)
                .setMaxLength(1000),
        )
        .addAttachmentOption((option) =>
            option.setName("imagen1").setDescription("Primera imagen de referencia (opcional)").setRequired(false),
        )
        .addAttachmentOption((option) =>
            option.setName("imagen2").setDescription("Segunda imagen de referencia (opcional)").setRequired(false),
        )
        .addAttachmentOption((option) =>
            option.setName("imagen3").setDescription("Tercera imagen de referencia (opcional)").setRequired(false),
        )
        .addAttachmentOption((option) =>
            option.setName("imagen4").setDescription("Cuarta imagen de referencia (opcional)").setRequired(false),
        )
        .addAttachmentOption((option) =>
            option.setName("imagen5").setDescription("Quinta imagen de referencia (opcional)").setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("estilo")
                .setDescription("Estilo artístico opcional para la imagen")
                .setRequired(false)
                .addChoices(
                    { name: "🎨 Realista", value: "fotorealista, ultra-detailed, high quality" },
                    { name: "🖌️ Pintura al óleo", value: "oil painting style, artistic, detailed brushstrokes" },
                    { name: "✏️ Boceto a lápiz", value: "pencil sketch, black and white drawing, detailed lines" },
                    { name: "🌸 Anime / Manga", value: "anime style, manga, vibrant colors, cel-shaded" },
                    { name: "🎮 Pixel Art", value: "pixel art, 16-bit style, retro game aesthetic" },
                    { name: "🌆 Cyberpunk", value: "cyberpunk, neon lights, futuristic, dark atmosphere" },
                    { name: "🏛️ Fantasía épica", value: "epic fantasy, magical, detailed, dramatic lighting" },
                    { name: "🎭 Caricatura", value: "cartoon style, caricature, exaggerated features, colorful" },
                ),
        ),
    async run(client, interaction) {
        await interaction.deferReply();

        const prompt = interaction.options.getString("descripcion");
        const estilo = interaction.options.getString("estilo");
        const attachments = [1, 2, 3, 4, 5].map((n) => interaction.options.getAttachment(`imagen${n}`)).filter(Boolean);

        if (!GEMINI_API_KEY) {
            return interaction.editReply({ content: "❌ La API de Gemini no está configurada en el servidor." });
        }

        // ── Cooldown por usuario ───────────────────────────────────────────────
        const userId = interaction.user.id;
        const lastUsed = userCooldowns.get(userId) || 0;
        const remaining = USER_COOLDOWN_MS - (Date.now() - lastUsed);
        if (remaining > 0) {
            const secs = Math.ceil(remaining / 1000);
            return interaction.editReply({
                content: `⏳ Espera **${secs}s** antes de generar otra imagen.`,
            });
        }
        userCooldowns.set(userId, Date.now());

        // ── Validar adjuntos ───────────────────────────────────────────────────
        for (const att of attachments) {
            const mime = (att.contentType || "").split(";")[0].trim().toLowerCase();
            if (!ALLOWED_MIME_TYPES.has(mime) && !mime.startsWith("image/")) {
                return interaction.editReply({ content: `❌ El adjunto "${att.name}" no es una imagen válida (PNG, JPG, WebP…).` });
            }
            if (att.size > 10 * 1024 * 1024) {
                return interaction.editReply({ content: `❌ El adjunto "${att.name}" supera los 10 MB.` });
            }
        }

        // ── Construir prompt final ────────────────────────────────────────────
        let finalPrompt = prompt;
        if (estilo) finalPrompt += `. Estilo: ${estilo}`;

        try {
            // ── Descargar adjuntos ────────────────────────────────────────────
            const images = [];
            for (const att of attachments) {
                logInfo(`[Imagen] Descargando adjunto: ${att.name}`);
                const dlRes = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
                if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status} descargando adjunto "${att.name}"`);
                const buffer = Buffer.from(await dlRes.arrayBuffer());
                const mime = (att.contentType || "image/png").split(";")[0].trim();
                images.push({ buffer, mime });
                logInfo(`[Imagen] Adjunto listo: ${mime}, ${(buffer.length / 1024).toFixed(1)} KB`);
            }

            logInfo(`[Imagen] Solicitando imagen (Nano Banana) para ${interaction.user.tag} — "${finalPrompt.slice(0, 80)}..."`);

            // ── Llamada REST directa con timeout ─────────────────────────────
            // AbortSignal en vez de Promise.race: al vencer, se cancela la petición HTTP y
            // los reintentos pendientes, no solo se deja de esperar la respuesta.
            const timeoutSignal = AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS);
            let result;
            try {
                result = await generateImageREST(finalPrompt, images, timeoutSignal);
            } catch (genErr) {
                if (timeoutSignal.aborted) throw new Error(`Timeout tras ${IMAGE_GEN_TIMEOUT_MS / 1000}s esperando respuesta`);
                throw genErr;
            }

            // ── Construir respuesta Discord ───────────────────────────────────
            const ext = EXT_FROM_MIME[result.mimeType] || result.mimeType.split("/")[1] || "png";
            const discordAttachment = new AttachmentBuilder(result.imageBuffer, { name: `imagen_generada.${ext}` });

            const header = `🎨 **Imagen generada** · \`${interaction.user.username}\``;
            const promptLine = `> ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`;
            const estiloLine = estilo ? `\n> 🖌️ Estilo: ${estilo.split(",")[0]}` : "";
            const imgsLine = images.length > 0 ? `\n> 🖼️ Imágenes de referencia: ${images.length}` : "";

            const replyContent = `${header}\n${promptLine}${estiloLine}${imgsLine}`.slice(0, 2000);

            logInfo(
                `[Imagen] Imagen generada correctamente (${(result.imageBuffer.length / 1024).toFixed(1)} KB) para ${interaction.user.tag}`,
            );

            await interaction.editReply({
                content: replyContent,
                files: [discordAttachment],
            });
        } catch (err) {
            // Liberar cooldown para no penalizar al usuario en errores de API/timeout
            userCooldowns.delete(userId);

            const msg = err?.message || String(err);
            logError(`[Imagen] Error generando imagen para ${interaction.user.tag}:`, err);

            let userMsg = "❌ Hubo un error al generar la imagen. Inténtalo de nuevo.";
            const lowerMsg = msg.toLowerCase();

            if (lowerMsg.includes("safety") || lowerMsg.includes("prohibited") || lowerMsg.includes("blocked")) {
                userMsg = "❌ La descripción fue bloqueada por los filtros de seguridad. Intenta con una descripción diferente.";
            } else if (lowerMsg.includes("quota") || lowerMsg.includes("resource_exhausted") || lowerMsg.includes("429")) {
                userMsg = "❌ Se ha agotado la cuota de la API de imágenes. Inténtalo en unos minutos.";
            } else if (lowerMsg.includes("timeout")) {
                userMsg = `❌ La generación tardó demasiado (>${IMAGE_GEN_TIMEOUT_MS / 1000}s). Prueba con una descripción más sencilla.`;
            } else if (lowerMsg.includes("503") || lowerMsg.includes("unavailable") || lowerMsg.includes("high demand")) {
                userMsg = `❌ El servicio de generación de imágenes está saturado en este momento. Reintentado ${IMAGE_GEN_MAX_RETRIES} veces sin éxito. Prueba de nuevo en un rato.`;
            } else if (lowerMsg.includes("model") && lowerMsg.includes("not found")) {
                userMsg = `❌ El modelo de generación de imágenes no está disponible (\`${IMAGE_GEN_MODEL}\`). Contacta con el administrador del bot.`;
            }

            try {
                await interaction.editReply({ content: userMsg });
            } catch (e) {
                logWarn(`[Imagen] Tampoco se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
