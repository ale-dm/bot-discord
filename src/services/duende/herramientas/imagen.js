// Herramienta del Duende para generar una imagen desde el chat (#367): "dibújame…", "hazme una imagen de…". Comparte con /imagen el
// cooldown y la cuota diaria por persona (systems/duende/imagenes), así que el chat no es una forma de saltárselos. La imagen no se
// envía aquí: se deja en `ctx.imagenes` y la manda el chat (chat/enviar) después del texto. Solo donde el chat puede adjuntar (no por voz).
const { Type: SchemaType } = require("@google/genai");
const imagenes = require("../../../systems/duende/imagenes");

const DUENDE_IMAGEN_TOOL_DECLARATIONS = [
    {
        name: "generar_imagen",
        description:
            'Genera una imagen con IA y la envía al canal. Úsala SOLO cuando el usuario te pida dibujar, crear o generar una imagen ("dibújame…", "hazme una imagen de…"). Tiene cooldown y un límite diario por persona: si falla, díselo tal cual y no digas que la has enviado.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                descripcion: {
                    type: SchemaType.STRING,
                    description: "Qué hay que dibujar, con el máximo detalle que haya dado el usuario",
                },
                estilo: { type: SchemaType.STRING, description: "Opcional: estilo artístico (óleo, anime, pixel art, realista…)" },
            },
            required: ["descripcion"],
        },
    },
];

const REALES_IMAGEN = { imagenes };

const DUENDE_IMAGEN_EXECUTORS = {
    async generar_imagen(args, ctx, d = REALES_IMAGEN) {
        if (!Array.isArray(ctx.imagenes)) return { error: "Aquí no puedo enviar imágenes." };
        const descripcion = String(args?.descripcion || "")
            .trim()
            .slice(0, 1000);
        if (!descripcion) return { error: "Falta la descripción de la imagen." };
        if (ctx.imagenes.length) return { error: "Solo puedo generar una imagen por mensaje." };
        const reserva = d.imagenes.reservar(ctx.userId);
        if (!reserva.ok) return { error: d.imagenes.mensajeDeLimite(reserva).replace(/<t:\d+:R>/, "mañana") };
        const estilo = String(args?.estilo || "")
            .trim()
            .slice(0, 100);
        try {
            const result = await d.imagenes.generarConTimeout(estilo ? `${descripcion}. Estilo: ${estilo}` : descripcion, []);
            ctx.imagenes.push({ buffer: result.imageBuffer, mimeType: result.mimeType, descripcion });
            return { ok: true, nota: "La imagen se enviará al canal junto a tu respuesta." };
        } catch (e) {
            d.imagenes.liberar(ctx.userId);
            return { error: `No se ha podido generar la imagen (${String(e.message || e).slice(0, 120)}). No se ha enviado nada.` };
        }
    },
};

module.exports = { DUENDE_IMAGEN_TOOL_DECLARATIONS, DUENDE_IMAGEN_EXECUTORS };
