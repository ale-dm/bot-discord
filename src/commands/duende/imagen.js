const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { logInfo, logError, logWarn } = require("../../core/logger");
const { generateImageREST, IMAGE_GEN_MODEL, IMAGE_GEN_MAX_RETRIES } = require("../../services/duende/imagenGemini");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";

const IMAGE_GEN_TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS || 120_000);

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

/** Mensaje de error del primer adjunto que no es una imagen válida o pesa más de 10 MB; null si todos están bien. */
function errorDeAdjuntos(attachments) {
    for (const att of attachments) {
        const mime = (att.contentType || "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_MIME_TYPES.has(mime) && !mime.startsWith("image/")) {
            return `❌ El adjunto "${att.name}" no es una imagen válida (PNG, JPG, WebP…).`;
        }
        if (att.size > 10 * 1024 * 1024) {
            return `❌ El adjunto "${att.name}" supera los 10 MB.`;
        }
    }
    return null;
}

/** Descarga los adjuntos de referencia y los devuelve como buffers con su tipo MIME. */
async function descargarAdjuntos(attachments) {
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
    return images;
}

/** Llamada a la API de imagen con un tiempo límite; al vencer, se cancelan la petición y los reintentos pendientes. */
async function generarImagenConTimeout(finalPrompt, images) {
    // AbortSignal en vez de Promise.race: al vencer, se cancela la petición HTTP y
    // los reintentos pendientes, no solo se deja de esperar la respuesta.
    const timeoutSignal = AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS);
    try {
        return await generateImageREST(finalPrompt, images, timeoutSignal);
    } catch (genErr) {
        if (timeoutSignal.aborted) throw new Error(`Timeout tras ${IMAGE_GEN_TIMEOUT_MS / 1000}s esperando respuesta`);
        throw genErr;
    }
}

/** Contenido del mensaje con la imagen adjunta: cabecera con el autor, la descripción y los datos de la petición. */
function construirRespuestaImagen(interaction, { prompt, estilo, images, result }) {
    const ext = EXT_FROM_MIME[result.mimeType] || result.mimeType.split("/")[1] || "png";
    const discordAttachment = new AttachmentBuilder(result.imageBuffer, { name: `imagen_generada.${ext}` });

    const header = `🎨 **Imagen generada** · \`${interaction.user.username}\``;
    const promptLine = `> ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`;
    const estiloLine = estilo ? `\n> 🖌️ Estilo: ${estilo.split(",")[0]}` : "";
    const imgsLine = images.length > 0 ? `\n> 🖼️ Imágenes de referencia: ${images.length}` : "";

    const replyContent = `${header}\n${promptLine}${estiloLine}${imgsLine}`.slice(0, 2000);

    logInfo(`[Imagen] Imagen generada correctamente (${(result.imageBuffer.length / 1024).toFixed(1)} KB) para ${interaction.user.tag}`);

    return { content: replyContent, files: [discordAttachment] };
}

/** Frase para el usuario según la causa del error; la causa se busca en el texto del error. */
function mensajeDeErrorImagen(msg) {
    const lowerMsg = msg.toLowerCase();

    if (lowerMsg.includes("safety") || lowerMsg.includes("prohibited") || lowerMsg.includes("blocked")) {
        return "❌ La descripción fue bloqueada por los filtros de seguridad. Intenta con una descripción diferente.";
    }
    if (lowerMsg.includes("quota") || lowerMsg.includes("resource_exhausted") || lowerMsg.includes("429")) {
        return "❌ Se ha agotado la cuota de la API de imágenes. Inténtalo en unos minutos.";
    }
    if (lowerMsg.includes("timeout")) {
        return `❌ La generación tardó demasiado (>${IMAGE_GEN_TIMEOUT_MS / 1000}s). Prueba con una descripción más sencilla.`;
    }
    if (lowerMsg.includes("503") || lowerMsg.includes("unavailable") || lowerMsg.includes("high demand")) {
        return `❌ El servicio de generación de imágenes está saturado en este momento. Reintentado ${IMAGE_GEN_MAX_RETRIES} veces sin éxito. Prueba de nuevo en un rato.`;
    }
    if (lowerMsg.includes("model") && lowerMsg.includes("not found")) {
        return `❌ El modelo de generación de imágenes no está disponible (\`${IMAGE_GEN_MODEL}\`). Contacta con el administrador del bot.`;
    }
    return "❌ Hubo un error al generar la imagen. Inténtalo de nuevo.";
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

        const errorAdjuntos = errorDeAdjuntos(attachments);
        if (errorAdjuntos) return interaction.editReply({ content: errorAdjuntos });

        // ── Construir prompt final ────────────────────────────────────────────
        let finalPrompt = prompt;
        if (estilo) finalPrompt += `. Estilo: ${estilo}`;

        try {
            const images = await descargarAdjuntos(attachments);
            logInfo(`[Imagen] Solicitando imagen (Nano Banana) para ${interaction.user.tag} — "${finalPrompt.slice(0, 80)}..."`);
            const result = await generarImagenConTimeout(finalPrompt, images);
            await interaction.editReply(construirRespuestaImagen(interaction, { prompt, estilo, images, result }));
        } catch (err) {
            // Liberar cooldown para no penalizar al usuario en errores de API/timeout
            userCooldowns.delete(userId);

            const msg = err?.message || String(err);
            logError(`[Imagen] Error generando imagen para ${interaction.user.tag}:`, err);

            try {
                await interaction.editReply({ content: mensajeDeErrorImagen(msg) });
            } catch (e) {
                logWarn(`[Imagen] Tampoco se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
