/**
 * /ia — Comando de consulta a agentes de inteligencia artificial especializados.
 *
 * Parámetros:
 *   - prompt      (requerido) Texto de la consulta
 *   - agente      (opcional)  Tipo de agente IA (selector)
 *   - generar_imagen (opcional) Booleano — genera también una imagen basada en la consulta
 *
 * El selector de agente es una opción de slash command: Discord admite hasta 25 opciones y hoy hay 8 (ver AGENTES).
 * Las llamadas a Gemini (texto e imagen) viven en services/duende/consultaIA.js.
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { llamarGemini, generarImagenREST } = require("../../services/duende/consultaIA");
const { logInfo, logError, logWarn } = require("../../core/logger");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const IMAGE_GEN_TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS || 120_000);
const IA_COOLDOWN_MS = Number(process.env.IA_COOLDOWN_MS || 15_000);

const userCooldowns = new Map();

const { AGENTES } = require("../../systems/duende/agentesIA");

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

/** Embed principal con la consulta y, si la respuesta es larga, un embed de continuación por cada trozo extra. */
function construirRespuesta(client, interaction, agente, promptText, respuesta) {
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

    return { mainEmbed, replyPayload };
}

/** Genera la imagen opcional y la añade al mensaje. Si falla, el aviso sale en el embed y la respuesta de texto igual. */
async function adjuntarImagen(promptText, mainEmbed, replyPayload) {
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

/** Frase para el usuario según la causa del error; la causa se busca en el texto del error. */
function mensajeDeErrorIA(msg) {
    const lower = msg.toLowerCase();

    if (lower.includes("timeout")) {
        return "❌ El agente tardó demasiado en responder. Prueba con una consulta más corta.";
    }
    if (lower.includes("quota") || lower.includes("429") || lower.includes("resource_exhausted")) {
        return "❌ Se ha agotado la cuota de la API. Inténtalo en unos minutos.";
    }
    if (lower.includes("503") || lower.includes("high demand") || lower.includes("unavailable")) {
        return "❌ El servicio de IA está saturado en este momento. Inténtalo en un rato.";
    }
    if (lower.includes("safety") || lower.includes("blocked") || lower.includes("prohibited")) {
        return "❌ Tu consulta fue bloqueada por los filtros de seguridad. Reformula la pregunta.";
    }
    return "❌ Hubo un error al consultar el agente de IA. Inténtalo de nuevo.";
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

            // ── Embeds de respuesta y, opcionalmente, la imagen ──────────────
            const { mainEmbed, replyPayload } = construirRespuesta(client, interaction, agente, promptText, respuesta);
            if (generarImagen) await adjuntarImagen(promptText, mainEmbed, replyPayload);

            await interaction.editReply(replyPayload);
            logInfo(`[IA] Respuesta enviada a ${interaction.user.tag} (agente: ${agenteKey})`);
        } catch (err) {
            userCooldowns.delete(userId);
            const msg = err?.message || String(err);
            logError(`[IA] Error respondiendo a ${interaction.user.tag}:`, err);

            try {
                await interaction.editReply({ content: mensajeDeErrorIA(msg) });
            } catch (e) {
                logWarn(`[IA] Tampoco se pudo avisar del error: ${e.message}`);
            }
        }
    },
};
