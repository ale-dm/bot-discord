const { Type: SchemaType } = require("@google/genai");
const guildSettings = require("../../../systems/guildSettings");
const seerrClient = require("../../seerrClient");
const { resolveNameToDiscordId } = require("../../../systems/duende/personas");
const { resolverSeerrUsuarioPorId } = require("./base");

// Igual que las de Plex: se filtran por canal (ver seerrClient.isChannelAllowed), y en
// canales no permitidos ni siquiera se le declaran al modelo.
const DUENDE_SEERR_TOOL_DECLARATIONS = [
    {
        name: "buscar_contenido_seerr",
        description:
            "Busca una película o serie por título para ver si existe, si ya está disponible en Plex, o si se puede pedir. Úsala siempre antes de 'solicitar_contenido_seerr' — nunca inventes un tmdbId, solo puedes pedir uno que haya salido de esta búsqueda. Es gratis y rápida: si en algún momento vas a pedir algo y no tienes el tmdbId a mano (por ejemplo porque la búsqueda fue en un mensaje anterior y ya no lo recuerdas), simplemente vuelve a buscar el mismo título aquí antes de pedirlo — nunca le pidas el ID a un humano, ellos no lo tienen ni tienen por qué saberlo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                titulo: { type: SchemaType.STRING, description: "Título a buscar" },
            },
            required: ["titulo"],
        },
    },
    {
        name: "solicitar_contenido_seerr",
        description:
            "Pide una película o serie concreta para que se descargue. Solo se puede llamar con un tmdbId y mediaType que hayan salido de una llamada reciente a 'buscar_contenido_seerr' en esta misma conversación — si no has buscado antes, o si buscaste hace varios mensajes y ya no tienes el tmdbId a la vista, vuelve a llamar a 'buscar_contenido_seerr' con el mismo título justo antes de esta llamada (es instantáneo). Nunca le preguntes el ID a la persona que te habla — eso lo sacas tú buscando, no ellos. Por defecto la petición se atribuye a quien te está hablando ahora mismo. Si el mensaje nombra a otra persona en relación con el pedido — 'pide X para Y', 'pídesela a Y', 'que Y pida X', 'haz que Y pida X', 'en nombre de Y'... cualquier forma de decir que el pedido es de esa otra persona — pon su nombre en 'persona' y se atribuye a ella en Seerr (le avisará a ella, no a quien te habló, cuando esté listo). No te niegues a hacerlo pensando que no puedes actuar en nombre de otro: para eso está el parámetro 'persona', úsalo sin más. IMPORTANTE: nunca digas 'ya lo he pedido' o similar si no has llamado literalmente a esta función en este turno — decirlo sin haberla llamado es mentir sobre una acción real que no ha pasado.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                tmdbId: { type: SchemaType.NUMBER, description: "El tmdbId exacto devuelto por buscar_contenido_seerr" },
                mediaType: { type: SchemaType.STRING, description: "'movie' o 'tv', tal cual lo devolvió buscar_contenido_seerr" },
                persona: {
                    type: SchemaType.STRING,
                    description:
                        "Opcional. Nombre o apodo de la persona en cuyo nombre se pide, tal cual se ha usado en el mensaje. Si se omite, se pide en nombre de quien habla.",
                },
            },
            required: ["tmdbId", "mediaType"],
        },
    },
    {
        name: "consultar_solicitudes_seerr",
        description:
            "Consulta las últimas peticiones de contenido hechas en Seerr (qué se pidió, quién y en qué estado: pendiente, procesando, disponible...).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cantidad: { type: SchemaType.NUMBER, description: "Cuántas peticiones recientes traer (por defecto 5)" },
            },
        },
    },
];

const DUENDE_SEERR_EXECUTORS = {
    async buscar_contenido_seerr(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const titulo = String(args?.titulo || "").trim();
        if (!titulo) return { error: "Falta el título a buscar." };
        const results = await seerrClient.searchMulti(ctx.guildId, titulo);
        if (!results.length) return { encontrado: false, titulo };
        const top = results.slice(0, 5);
        seerrClient.cacheSearchResults(ctx.channelId, top);
        return { encontrado: true, resultados: top };
    },
    async solicitar_contenido_seerr(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const tmdbId = Number(args?.tmdbId);
        const mediaType = String(args?.mediaType || "").toLowerCase();
        if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) {
            return { error: "Faltan tmdbId/mediaType válidos." };
        }

        const cached = seerrClient.getCachedSearchResult(ctx.channelId, tmdbId, mediaType);
        if (!cached) {
            return {
                error: "Ese tmdbId no viene de una búsqueda reciente en este canal. Llama primero a buscar_contenido_seerr con el título.",
            };
        }
        if (cached.estadoCodigo === 5) return { ya_disponible: true, titulo: cached.titulo };
        if (cached.estadoCodigo === 2 || cached.estadoCodigo === 3 || cached.estadoCodigo === 4) {
            return { ya_solicitado: true, titulo: cached.titulo, estado: cached.estado };
        }

        // El límite diario protege siempre a quien está hablando con el bot (evita que una
        // sola persona spamee peticiones aunque las reparta "en nombre de" varios amigos).
        const { dailyRequestLimit } = seerrClient.getConfig(ctx.guildId);
        // Solo se comprueba aquí: el cupo se gasta cuando la petición sale de verdad (más abajo).
        const limitCheck = guildSettings.checkAndConsumeLimit(ctx.guildId, "seerr_request", ctx.userId, {
            dailyLimit: dailyRequestLimit,
            consume: false,
        });
        if (!limitCheck.ok) {
            return { error: "Límite diario de peticiones de contenido alcanzado. Que lo pida mañana." };
        }

        let targetDiscordId = ctx.userId;
        let personaLabel = null;
        if (args?.persona) {
            if (!ctx.guild) return { error: "Solo disponible en servidores." };
            const resolvedId = resolveNameToDiscordId(args.persona, ctx.guild);
            if (!resolvedId) return { error: `No identifico a "${args.persona}" entre los miembros del server.` };
            targetDiscordId = resolvedId;
            personaLabel = args.persona;
        }

        const seerrUser = await resolverSeerrUsuarioPorId(targetDiscordId, ctx.guildId);
        if (!seerrUser) {
            return {
                error: `${personaLabel || "Esta persona"} no tiene su Discord vinculado en Seerr ni en Plex, no puedo pedir contenido en su nombre. Que vincule su cuenta con un admin.`,
            };
        }

        try {
            await seerrClient.createRequest(ctx.guildId, { mediaType, tmdbId, userId: seerrUser.id });
            guildSettings.checkAndConsumeLimit(ctx.guildId, "seerr_request", ctx.userId, { dailyLimit: dailyRequestLimit });
            return { pedido: true, titulo: cached.titulo, pedido_por: seerrUser.displayName };
        } catch (e) {
            return { error: `No se pudo pedir: ${e.seerrMessage || e.message}` };
        }
    },
    async consultar_solicitudes_seerr(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const cantidad = Math.max(1, Math.min(15, Math.floor(Number(args?.cantidad) || 5)));
        const requests = await seerrClient.getRequests(ctx.guildId, { take: cantidad });
        return { solicitudes: requests };
    },
};

module.exports = { DUENDE_SEERR_TOOL_DECLARATIONS, DUENDE_SEERR_EXECUTORS };
