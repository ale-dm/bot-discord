// Herramientas (function calling) que el Duende puede usar al responder: datos del bot, Plex y Seerr.
const { Type: SchemaType } = require("@google/genai");
const guildSettings = require("../../systems/guildSettings");
const xpSystem = require("../../systems/xpSystem");
const achievementsSystem = require("../../systems/achievementsSystem");
const plexLinks = require("../../systems/plexLinks");
const tautulliClient = require("../tautulliClient");
const seerrClient = require("../seerrClient");
const { resolveNameToDiscordId, buildPersonProfileText } = require("../../systems/duende/personas");
const perfiles = require("../../systems/duende/perfiles");
const { getTtclPrecio } = require("../../systems/cripto/mercado");

// ─── Herramientas del Duende (function calling) ────────────────────────────
// Todas de solo lectura a propósito: el modelo puede CONSULTAR datos reales del
// bot, pero ninguna herramienta escribe/modifica nada. El userId/guildId que
// reciben viene siempre del contexto real de Discord (toolContext), nunca de
// algo que el modelo extraiga o invente del texto — así no hay forma de que
// alguien le pida a Duende el saldo o el nivel de otra persona y se lo dé.
// Las de 🧙 economía (F-DU-03) tampoco mueven dinero: solo PROPONEN (un reto, una
// apuesta o un préstamo) y la propuesta sale con botones debajo de la respuesta;
// el dinero solo se mueve si quien habla pulsa ✅ (juegos/retos/duende).
// ─── Herramientas de Plex/Tautulli ──────────────────────────────────────────
// Aquí sí se consulta actividad de OTRA persona (a quien se refiera "persona" en
// la pregunta), a diferencia de las herramientas de arriba que solo miran al que
// pregunta. Es intencional: es un grupo de amigos sin restricciones de privacidad
// entre ellos. La única persona nunca se resuelve por un ID que el modelo invente:
// siempre pasa por resolveNameToDiscordId() contra miembros reales del server, y
// de ahí por plexLinks (solo gente que el admin haya vinculado explícitamente).
function periodoADias(periodo) {
    const p = String(periodo || "semana").toLowerCase();
    if (p.includes("mes")) return 30;
    if (p.includes("año") || p.includes("ano") || p.includes("year")) return 365;
    if (p.includes("total") || p.includes("siempre") || p.includes("all")) return 0;
    return 7;
}

function formatFecha(unixSeconds) {
    const n = Number(unixSeconds);
    if (!n) return null;
    return new Date(n * 1000).toISOString().slice(0, 10);
}

function formatHoras(totalSeconds) {
    return Math.round(((Number(totalSeconds) || 0) / 3600) * 10) / 10;
}

function summarizeWatchHistory(rows) {
    const shows = new Map();
    const movies = [];
    for (const r of rows || []) {
        const ts = Number(r.date || r.started || 0);
        if (r.media_type === "episode") {
            const key = r.grandparent_title || r.title || "Desconocido";
            const cur = shows.get(key) || { episodios_vistos: 0, ultima_vez: 0 };
            cur.episodios_vistos += 1;
            if (ts > cur.ultima_vez) cur.ultima_vez = ts;
            shows.set(key, cur);
        } else {
            movies.push({ titulo: r.title, fecha: formatFecha(ts) });
        }
    }
    const series = [...shows.entries()]
        .map(([titulo, v]) => ({ titulo, episodios_vistos: v.episodios_vistos, ultima_vez: formatFecha(v.ultima_vez) }))
        .sort((a, b) => b.episodios_vistos - a.episodios_vistos);
    return { series, peliculas: movies };
}

async function resolverPersonaVinculada(nombre, ctx) {
    if (!ctx.guild) return { error: "Solo disponible en servidores." };
    const discordId = resolveNameToDiscordId(nombre, ctx.guild);
    if (!discordId) return { error: `No identifico a "${nombre}" entre los miembros del server.` };
    const link = plexLinks.getLinkByDiscordId(ctx.guildId, discordId);
    if (!link) return { error: `${nombre} no tiene su cuenta de Plex vinculada.` };
    return { discordId, link };
}

// Resuelve el usuario de Seerr correspondiente a un Discord ID *real* (nunca inventado por
// el modelo: siempre viene de ctx.userId o de resolveNameToDiscordId sobre un miembro real
// del server): primero por el Discord ID que tenga guardado en su propio perfil de Seerr, y
// si no lo tiene puesto ahí, por el vínculo de Plex ya existente.
async function resolverSeerrUsuarioPorId(discordId, guildId) {
    const porDiscord = await seerrClient.resolveSeerrUserByDiscordId(guildId, discordId);
    if (porDiscord) return porDiscord;
    const plexLink = plexLinks.getLinkByDiscordId(guildId, discordId);
    if (plexLink?.plexUsername) {
        const porPlex = await seerrClient.resolveSeerrUserByPlexUsername(guildId, plexLink.plexUsername);
        if (porPlex) return porPlex;
    }
    return null;
}

// Separadas de las generales porque estas se filtran por canal (ver isChannelAllowed
// más abajo): en canales no permitidos, ni siquiera se le declaran a Gemini.
const DUENDE_PLEX_TOOL_DECLARATIONS = [
    {
        name: "consultar_actividad_plex",
        description:
            "Consulta qué ha visto alguien en Plex en los últimos N días (series con nº de episodios, películas sueltas). Llámala con cualquier nombre o apodo que se use para referirse a esa persona, aunque no sepas si tiene Plex vinculado — la propia herramienta te dice si no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description:
                        "Nombre o apodo de la persona sobre la que se pregunta, tal cual se ha usado en el mensaje (ej. 'el perro', 'Coneyo')",
                },
                dias: { type: SchemaType.NUMBER, description: "Número de días hacia atrás a consultar (por defecto 7)" },
            },
            required: ["persona"],
        },
    },
    {
        name: "consultar_viendo_ahora",
        description: "Consulta qué se está reproduciendo en Plex ahora mismo y quién lo está viendo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_tiempo_visto",
        description:
            "Consulta cuántas horas ha visto alguien en Plex en un periodo. Llámala con cualquier nombre o apodo, aunque no sepas si tiene Plex vinculado — la propia herramienta te dice si no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description: "Nombre o apodo de la persona sobre la que se pregunta, tal cual se ha usado en el mensaje",
                },
                periodo: { type: SchemaType.STRING, description: "semana, mes, año o total" },
            },
            required: ["persona"],
        },
    },
    {
        name: "consultar_ultima_conexion",
        description:
            "Consulta cuándo fue la última vez que alguien vio algo en Plex (cuánto tiempo lleva sin ver nada). Llámala con cualquier nombre o apodo, aunque no sepas si tiene Plex vinculado — la propia herramienta te dice si no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description:
                        "Nombre o apodo de la persona sobre la que se pregunta, tal cual se ha usado en el mensaje (ej. 'el perro', 'Coneyo')",
                },
            },
            required: ["persona"],
        },
    },
    {
        name: "consultar_novedades_plex",
        description: "Consulta las últimas películas/episodios añadidos a la biblioteca de Plex del servidor.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cantidad: { type: SchemaType.NUMBER, description: "Cuántas novedades traer (por defecto 5)" },
            },
        },
    },
    {
        name: "comparar_actividad_plex",
        description:
            "Compara el tiempo visto en Plex entre dos personas en un periodo. Llámala con cualquier nombre o apodo para cada una, aunque no sepas si tienen Plex vinculado — la propia herramienta te dice si alguna no lo tiene.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona1: {
                    type: SchemaType.STRING,
                    description: "Primera persona a comparar (nombre o apodo tal cual se ha usado en el mensaje)",
                },
                persona2: {
                    type: SchemaType.STRING,
                    description: "Segunda persona a comparar (nombre o apodo tal cual se ha usado en el mensaje)",
                },
                periodo: { type: SchemaType.STRING, description: "semana, mes, año o total" },
            },
            required: ["persona1", "persona2"],
        },
    },
    {
        name: "consultar_top_visto_server",
        description:
            "Consulta qué películas y series se han visto más en Plex en este servidor en un periodo (entre todo el mundo, no solo los vinculados).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                periodo: { type: SchemaType.STRING, description: "semana, mes o año" },
            },
        },
    },
    {
        name: "buscar_en_plex",
        description: "Busca si una película o serie existe en la biblioteca de Plex del servidor, con su sinopsis, año y nota.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                titulo: { type: SchemaType.STRING, description: "Título a buscar" },
            },
            required: ["titulo"],
        },
    },
    {
        name: "consultar_ranking_plex",
        description:
            "Consulta el ranking de quién más ha visto Plex en este servidor en un periodo (entre todo el mundo, no solo los vinculados).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                periodo: { type: SchemaType.STRING, description: "semana, mes o año" },
            },
        },
    },
    {
        name: "consultar_bibliotecas_plex",
        description: "Consulta cuántas películas, series u otro contenido hay en cada biblioteca de Plex del servidor.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_patron_visionado",
        description: "Consulta qué día de la semana y a qué hora se ve más Plex en este servidor en un periodo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                periodo: { type: SchemaType.STRING, description: "semana, mes o año" },
            },
        },
    },
    {
        name: "consultar_trofeos_plex",
        description:
            "Consulta los logros y trofeos de Plex del servidor (los del bot: series terminadas, sagas, idiomas, 🎰 Gordos del Plex...). Con 'persona': los que tiene esa persona. Con 'titulo': quién tiene el trofeo de esa serie, saga, película o director (p. ej. '¿quién ha terminado Breaking Bad?'). Sin nada: quién tiene más. Llámala con cualquier nombre o apodo.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description: "Nombre o apodo de la persona por la que se pregunta, tal cual se ha usado en el mensaje (opcional)",
                },
                titulo: {
                    type: SchemaType.STRING,
                    description: "Serie, saga, película o director por el que se pregunta, p. ej. 'Breaking Bad' (opcional)",
                },
            },
        },
    },
];

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

const DUENDE_CORE_TOOL_DECLARATIONS = [
    {
        name: "consultar_nivel_y_racha",
        description: "Consulta el nivel, XP, rango y racha diaria del usuario que te está hablando ahora mismo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_saldo",
        description:
            "Consulta el dinero del usuario que te está hablando ahora mismo: efectivo (lo que gasta) y banco (lo que tiene guardado).",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "precio_ttcl",
        description: "Consulta el precio actual de la criptomoneda TTCL en este servidor.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_logros",
        description: "Consulta cuántos logros ha completado el usuario que te está hablando ahora mismo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "tirar_dado",
        description: "Tira un dado de N caras y devuelve el resultado.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                caras: { type: SchemaType.NUMBER, description: "Número de caras del dado (por defecto 6)" },
            },
        },
    },
    {
        name: "consultar_tienda",
        description: "Consulta qué objetos hay a la venta en la tienda del bot (/tienda): nombre, precio, stock, tipo y rareza.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                busqueda: { type: SchemaType.STRING, description: "Opcional: texto para filtrar por nombre o tipo" },
            },
        },
    },
    {
        name: "consultar_inventario",
        description: "Consulta los objetos que tiene en su inventario el usuario que te está hablando ahora mismo.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_mis_apuestas",
        description:
            "Consulta las apuestas de fútbol del usuario que te está hablando ahora mismo: las que tiene en juego (partido, a qué apostó, cuánto y cuánto ganaría), sus quinielas abiertas con los aciertos que lleva y su balance de apuestas.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_partidas_casino",
        description:
            "Consulta las últimas partidas de casino (blackjack, ruleta, tragaperras, adivinar, piedra-papel-tijera) del usuario que te está hablando ahora mismo y cuánto lleva ganado y perdido en el casino.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cantidad: { type: SchemaType.NUMBER, description: "Cuántas partidas recientes traer (por defecto 5, máximo 15)" },
            },
        },
    },
    {
        name: "consultar_recompensa_diaria",
        description:
            "Consulta si el usuario que te está hablando ahora mismo puede cobrar hoy la recompensa diaria (🎁 Diario, en /perfil → Economía) y cuánto le daría según su racha. Solo consulta: cobrarla la tiene que hacer él con el botón.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "consultar_perfil_persona",
        description:
            "Consulta qué sabes de una persona del servidor por su nombre o apodo: su descripción y las notas que tengas sobre ella. Úsala cuando te pregunten quién es alguien, o te hablen de alguien y no la ubiques de memoria — incluida la persona que te está hablando ahora, si pregunta por sí misma.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                persona: {
                    type: SchemaType.STRING,
                    description: "Nombre o apodo de la persona, tal cual se ha usado en la conversación (o 'yo' si pregunta por sí misma)",
                },
            },
            required: ["persona"],
        },
    },
];

// 🧙 El Duende en la economía (F-DU-03): proponer un reto, una apuesta o un préstamo al que habla. Solo se ofrecen
// donde la propuesta puede salir con botones (toolContext.propuestas: el chat de texto, no la voz).
const DUENDE_ECONOMIA_TOOL_DECLARATIONS = [
    {
        name: "retar_piedra_papel_tijera",
        description:
            "Reta al usuario que te está hablando a piedra, papel o tijera por monedas (también si te reta él). No mueve dinero: debajo de tu respuesta sale un mensaje con botones y el duelo solo empieza si lo acepta. Tu jugada se elige al azar. De 10 a 1.000 monedas.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { cantidad: { type: SchemaType.NUMBER, description: "Monedas que se juega cada uno (10 a 1.000)" } },
            required: ["cantidad"],
        },
    },
    {
        name: "apostar_partido_con_duende",
        description:
            "Propón al usuario que te está hablando una apuesta 1 contra 1 contigo a un partido de fútbol de los de ⚽ Apuestas: él va con un resultado y tú con lo contrario (p. ej. 'te apuesto 200 a que gana el Betis'). No mueve dinero: debajo de tu respuesta sale un mensaje con botones y la apuesta solo empieza si la acepta. De 10 a 1.000 monedas.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                equipo: {
                    type: SchemaType.STRING,
                    description:
                        "El equipo que el usuario dice que gana, con su nombre oficial (p. ej. 'Barcelona', no 'Barça'), o 'empate'",
                },
                partido: {
                    type: SchemaType.STRING,
                    description:
                        "Los equipos del partido (p. ej. 'Betis Sevilla'), si hace falta para encontrarlo; obligatorio si apuesta al empate",
                },
                cantidad: { type: SchemaType.NUMBER, description: "Monedas que se juega cada uno (10 a 1.000)" },
            },
            required: ["equipo", "cantidad"],
        },
    },
    {
        name: "ofrecer_prestamo",
        description:
            "Ofrece al usuario que te está hablando un préstamo de monedas cuando te pida dinero: de 10 a 1.000, con un 10 % de interés, a devolver en 7 días. No mueve dinero: debajo de tu respuesta sale un mensaje con botones y el préstamo solo se hace si lo acepta. Uno a la vez.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { cantidad: { type: SchemaType.NUMBER, description: "Monedas que le prestas (10 a 1.000)" } },
            required: ["cantidad"],
        },
    },
];

/** Deja una propuesta del Duende para que salga con botones debajo de su respuesta (duende.js). */
function proponer(ctx, propuesta) {
    if (!Array.isArray(ctx.propuestas)) return { error: "Esto solo se puede proponer por el chat de texto, con botones." };
    if (ctx.propuestas.length >= 3) return { error: "Ya has propuesto bastante en esta respuesta." };
    ctx.propuestas.push({ ...propuesta, userId: ctx.userId });
    return {
        propuesta_enviada: true,
        aviso: "Debajo de tu respuesta sale un mensaje con ✅ Acepto / ❌ No. Hasta que no lo acepte no se mueve dinero: no digas que ya está hecho.",
    };
}

const cantidadDe = (args) => Math.floor(Number(args?.cantidad));
const sinNegritas = (texto) => String(texto).replace(/\*\*/g, "");

const DUENDE_TOOL_EXECUTORS = {
    retar_piedra_papel_tijera(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const cantidad = cantidadDe(args);
        const motivo = require("../../systems/retos").motivoNoContraDuende(ctx.userId, cantidad);
        if (motivo) return { error: sinNegritas(motivo) };
        return proponer(ctx, { tipo: "ppt", cantidad });
    },
    apostar_partido_con_duende(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const retos = require("../../systems/retos");
        const cantidad = cantidadDe(args);
        const partido = retos.buscarPartido(`${args?.partido || ""} ${args?.equipo || ""}`);
        const proximos = () =>
            retos
                .partidosParaRetar(8)
                .map(
                    (p) =>
                        `${p.home_team} vs ${p.away_team} (${new Date(p.start_time).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })})`,
                );
        if (!partido) {
            return { error: "No encuentro ese partido entre los próximos de ⚽ Apuestas.", proximos_partidos: proximos() };
        }
        const eleccion = retos.eleccionPara(partido, args?.equipo);
        if (!eleccion) {
            return {
                error: `En ${partido.home_team} vs ${partido.away_team} no sé por cuál va: di uno de los dos equipos o 'empate'.`,
                proximos_partidos: proximos(),
            };
        }
        const motivo = retos.motivoNoContraDuende(ctx.userId, cantidad, { matchId: partido.match_id, eleccion });
        if (motivo) return { error: sinNegritas(motivo) };
        return proponer(ctx, { tipo: "partido", cantidad, matchId: partido.match_id, eleccion });
    },
    ofrecer_prestamo(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const cantidad = cantidadDe(args);
        const motivo = require("../../systems/prestamos").motivoNoPrestar(ctx.userId, cantidad);
        if (motivo) return { error: sinNegritas(motivo) };
        return proponer(ctx, { tipo: "prestamo", cantidad });
    },
    consultar_nivel_y_racha(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const p = xpSystem.getProfile(ctx.guildId, ctx.userId);
        return {
            nivel: p.nivel,
            xp: p.xp,
            xp_necesaria_siguiente_nivel: p.xp_need,
            rango: p.title?.title || "sin rango",
            racha_dias: p.streak,
            racha_bonus_xp_pct: p.streakBonusPct,
            ranking_servidor: p.rank,
        };
    },
    consultar_saldo(args, ctx) {
        const c = require("../../systems/dinero").cuenta(ctx.userId);
        const p = require("../../systems/prestamos").abierto(ctx.userId);
        return {
            efectivo: c.efectivo,
            banco: c.banco,
            total: c.total,
            ...(p
                ? {
                      prestamo_del_duende: {
                          le_falta_devolver: p.falta,
                          vence: new Date(p.vence_en).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
                          vencido_y_en_deuda: p.estado === "deuda",
                      },
                  }
                : {}),
        };
    },
    precio_ttcl(args, ctx) {
        return { precio_ttcl_en_coins: getTtclPrecio(ctx.guildId) };
    },
    consultar_logros(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        // Como en su perfil: sin Plex vinculado, los de Plex que no tiene no cuentan.
        const opciones = require("../../systems/plexTrofeos").opcionesPerfil(ctx.guildId, ctx.userId, true);
        const s = achievementsSystem.getSummary(ctx.guildId, ctx.userId, opciones);
        return { logros_completados: s.completed, logros_totales: s.total, porcentaje: s.completionPct };
    },
    tirar_dado(args) {
        const caras = Math.max(2, Math.min(1000, Math.floor(Number(args?.caras) || 6)));
        return { caras, resultado: 1 + Math.floor(Math.random() * caras) };
    },
    consultar_tienda(args) {
        const busqueda = String(args?.busqueda || "").trim() || undefined;
        const items = require("../../systems/tienda").itemsTienda({ busqueda });
        return {
            a_la_venta: items.slice(0, 15).map((i) => ({
                nombre: i.nombre,
                precio: i.precio,
                stock: i.stock === null ? "ilimitado" : i.stock,
                tipo: i.tipo || null,
                rareza: i.rareza || null,
                solo_uno_por_persona: Boolean(i.unico),
                descripcion: i.descripcion ? String(i.descripcion).slice(0, 150) : null,
            })),
            total: items.length,
        };
    },
    consultar_inventario(args, ctx) {
        const objetos = require("../../systems/objetos");
        const items = objetos.inventarioDe(ctx.userId);
        return {
            objetos: items.slice(0, 20).map((o) => ({
                nombre: o.nombre,
                cantidad: o.cantidad,
                tipo: o.tipo || null,
                rareza: o.rareza || null,
                se_puede_usar: objetos.esUsable(o),
            })),
            distintos: items.length,
        };
    },
    consultar_mis_apuestas(args, ctx) {
        const misJugadas = require("../../systems/apuestas/misJugadas");
        const { marcadorDe } = require("../../systems/apuestas/marcador");
        const eleccion = (a) =>
            marcadorDe(a.eleccion)
                ? `marcador exacto ${marcadorDe(a.eleccion)}`
                : a.eleccion === "home"
                  ? a.home_team
                  : a.eleccion === "away"
                    ? a.away_team
                    : "empate";
        const stats = misJugadas.estadisticas(ctx.userId);
        return {
            partidos_en_juego: misJugadas.partidosDe(ctx.userId, { pendientes: true, limite: 10 }).map((a) => ({
                partido: `${a.home_team} vs ${a.away_team}`,
                empieza: a.start_time,
                apostado_a: eleccion(a),
                cantidad: a.cantidad,
                cuota: a.cuota,
                ganaria: Math.round(a.cantidad * a.cuota),
            })),
            quinielas_abiertas: misJugadas.quinielasDe(ctx.userId, { abiertas: true, limite: 3 }).map((q) => ({
                jornada: q.jornada,
                apostado: q.cantidad,
                aciertos_hasta_ahora: q.detalle.aciertos,
                partidos_jugados: q.detalle.jugados,
                partidos_total: q.detalle.total,
            })),
            balance_partidos: { apostado: stats.partidos.apostado, ganado: stats.partidos.ganado, en_juego: stats.partidos.enJuego },
            balance_quinielas: { apostado: stats.quinielas.apostado, ganado: stats.quinielas.ganado, en_juego: stats.quinielas.enJuego },
        };
    },
    consultar_partidas_casino(args, ctx) {
        const cantidad = Math.max(1, Math.min(15, Math.floor(Number(args?.cantidad) || 5)));
        const { ganado, perdido } = require("../../core/db")
            .prepare(
                `SELECT COALESCE(SUM(CASE WHEN resultado > 0 THEN resultado ELSE 0 END), 0) AS ganado,
                        COALESCE(SUM(CASE WHEN resultado < 0 THEN -resultado ELSE 0 END), 0) AS perdido
                 FROM casino WHERE userId = ?`,
            )
            .get(ctx.userId);
        return {
            ultimas_partidas: require("../../systems/apuestas/misJugadas")
                .ultimasCasino(ctx.userId, cantidad)
                .map((p) => ({ juego: p.juego, apostado: p.apuesta, resultado_neto: p.resultado })),
            total_ganado: ganado,
            total_perdido: perdido,
        };
    },
    consultar_recompensa_diaria(args, ctx) {
        const e = require("../../systems/diario").estado(ctx.guildId, ctx.userId);
        if (!e.activo) return { activa: false };
        return {
            activa: true,
            puede_cobrar_hoy: e.disponible,
            cantidad: e.cantidad,
            racha_dias: e.racha,
            veces_cobrada: e.veces,
            donde: "/perfil → 💰 Economía → 🎁 Diario",
        };
    },
    consultar_perfil_persona(args, ctx) {
        if (!ctx.guild) return { error: "Solo disponible en servidores." };
        const nombre = String(args?.persona || "").trim();
        if (!nombre) return { error: "Falta el nombre de la persona." };

        const esQuienHabla = /^(yo|y[oó]\s*mism[oa]|m[ií])$/i.test(nombre);
        const discordId = esQuienHabla ? ctx.userId : resolveNameToDiscordId(nombre, ctx.guild);
        if (!discordId) return { encontrado: false, nota: `No identifico a "${nombre}" entre los miembros del server.` };

        const perfil = perfiles.perfilPorDiscordId(discordId);
        const info = perfil ? buildPersonProfileText(perfil) : "";
        if (!info) return { encontrado: false, nota: "No tengo ninguna nota ni descripción guardada de esa persona." };

        const member = ctx.guild.members.cache.get(discordId);
        return { encontrado: true, nombre: member?.displayName || perfil?.name || nombre, info };
    },

    async consultar_actividad_plex(args, ctx) {
        const r = await resolverPersonaVinculada(args?.persona, ctx);
        if (r.error) return r;
        const dias = Math.max(1, Math.min(365, Math.floor(Number(args?.dias) || 7)));
        const afterDate = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
        const rows = await tautulliClient.getHistory(ctx.guildId, { userId: r.link.tautulliUserId, afterDate, length: 200 });
        return { persona: args.persona, dias, ...summarizeWatchHistory(rows) };
    },

    async consultar_viendo_ahora(args, ctx) {
        const sessions = await tautulliClient.getActivity(ctx.guildId);
        if (!sessions.length) return { viendo_ahora: [] };
        return {
            viendo_ahora: sessions.map((s) => ({
                usuario: s.friendly_name || s.user || "desconocido",
                titulo: s.grandparent_title ? `${s.grandparent_title} - ${s.title}` : s.full_title || s.title,
                progreso_pct: Number(s.progress_percent) || 0,
                estado: s.state || "reproduciendo",
            })),
        };
    },

    async consultar_tiempo_visto(args, ctx) {
        const r = await resolverPersonaVinculada(args?.persona, ctx);
        if (r.error) return r;
        const dias = periodoADias(args?.periodo);
        const stats = await tautulliClient.getUserWatchTimeStats(ctx.guildId, r.link.tautulliUserId, `${dias}`);
        const entry = stats.find((s) => Number(s.query_days) === dias) || stats[0];
        return {
            persona: args.persona,
            periodo: args?.periodo || "semana",
            horas_vistas: formatHoras(entry?.total_time),
            reproducciones: Number(entry?.total_plays) || 0,
        };
    },

    async consultar_ultima_conexion(args, ctx) {
        const r = await resolverPersonaVinculada(args?.persona, ctx);
        if (r.error) return r;
        const rows = await tautulliClient.getHistory(ctx.guildId, { userId: r.link.tautulliUserId, length: 1 });
        if (!rows.length) return { persona: args.persona, sin_actividad: true };
        const last = rows[0];
        return {
            persona: args.persona,
            fecha: formatFecha(last.date || last.started),
            titulo: last.grandparent_title ? `${last.grandparent_title} - ${last.title}` : last.title,
        };
    },

    async consultar_novedades_plex(args, ctx) {
        const cantidad = Math.max(1, Math.min(20, Math.floor(Number(args?.cantidad) || 5)));
        const items = await tautulliClient.getRecentlyAdded(ctx.guildId, cantidad);
        return {
            novedades: items.map((i) => ({
                titulo: i.grandparent_title ? `${i.grandparent_title} - ${i.title}` : i.title,
                tipo: i.media_type,
                anyo: i.year || null,
            })),
        };
    },

    async comparar_actividad_plex(args, ctx) {
        const [r1, r2] = await Promise.all([resolverPersonaVinculada(args?.persona1, ctx), resolverPersonaVinculada(args?.persona2, ctx)]);
        if (r1.error) return r1;
        if (r2.error) return r2;
        const dias = periodoADias(args?.periodo);
        const [s1, s2] = await Promise.all([
            tautulliClient.getUserWatchTimeStats(ctx.guildId, r1.link.tautulliUserId, `${dias}`),
            tautulliClient.getUserWatchTimeStats(ctx.guildId, r2.link.tautulliUserId, `${dias}`),
        ]);
        const e1 = s1.find((s) => Number(s.query_days) === dias) || s1[0];
        const e2 = s2.find((s) => Number(s.query_days) === dias) || s2[0];
        return {
            periodo: args?.periodo || "semana",
            [args.persona1]: { horas_vistas: formatHoras(e1?.total_time), reproducciones: Number(e1?.total_plays) || 0 },
            [args.persona2]: { horas_vistas: formatHoras(e2?.total_time), reproducciones: Number(e2?.total_plays) || 0 },
        };
    },

    async consultar_top_visto_server(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const dias = periodoADias(args?.periodo || "mes") || 30;
        const stats = await tautulliClient.getHomeStats(ctx.guildId, dias, 5);
        const pelis = stats.find((s) => s.stat_id === "top_movies");
        const series = stats.find((s) => s.stat_id === "top_tv");
        const format = (s) =>
            (s?.rows || []).map((r) => ({
                titulo: r.grandparent_title || r.title,
                reproducciones: r.total_plays,
                horas: formatHoras(r.total_duration),
            }));
        return { periodo: args?.periodo || "mes", top_peliculas: format(pelis), top_series: format(series) };
    },

    async buscar_en_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const titulo = String(args?.titulo || "").trim();
        if (!titulo) return { error: "Falta el título a buscar." };
        const results = await tautulliClient.search(ctx.guildId, titulo);
        const items = [...(results.movie || []), ...(results.show || [])].slice(0, 5);
        if (!items.length) return { encontrado: false, titulo };
        return {
            encontrado: true,
            resultados: items.map((i) => ({
                titulo: i.title,
                tipo: i.media_type,
                anyo: i.year || null,
                nota: i.rating || null,
                sinopsis: i.summary ? String(i.summary).slice(0, 400) : null,
            })),
        };
    },

    async consultar_ranking_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const dias = periodoADias(args?.periodo || "mes") || 30;
        const data = await tautulliClient.getPlaysByTopUsers(ctx.guildId, dias);
        const categories = data.categories || [];
        const totalsPerUser = categories.map((_, idx) =>
            (data.series || []).reduce((sum, serie) => sum + (Number(serie.data?.[idx]) || 0), 0),
        );
        const ranking = categories
            .map((usuario, idx) => ({ usuario, reproducciones: totalsPerUser[idx] }))
            .sort((a, b) => b.reproducciones - a.reproducciones)
            .slice(0, 10);
        return { periodo: args?.periodo || "mes", ranking };
    },

    async consultar_bibliotecas_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const libs = await tautulliClient.getLibraries(ctx.guildId);
        return {
            bibliotecas: libs.map((l) => ({ nombre: l.section_name, tipo: l.section_type, items: Number(l.count) || 0 })),
        };
    },

    async consultar_patron_visionado(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const dias = periodoADias(args?.periodo || "mes") || 30;
        const [dow, hod] = await Promise.all([
            tautulliClient.getPlaysByDayOfWeek(ctx.guildId, dias),
            tautulliClient.getPlaysByHourOfDay(ctx.guildId, dias),
        ]);
        const sumPerCategory = (data) =>
            (data.categories || []).map((_, idx) => (data.series || []).reduce((sum, serie) => sum + (Number(serie.data?.[idx]) || 0), 0));
        const dowTotals = sumPerCategory(dow);
        const hodTotals = sumPerCategory(hod);
        const diaMasActivo = dow.categories?.[dowTotals.indexOf(Math.max(...dowTotals))] || null;
        const horaMasActiva = hod.categories?.[hodTotals.indexOf(Math.max(...hodTotals))] || null;
        return {
            periodo: args?.periodo || "mes",
            dia_mas_activo: diaMasActivo,
            hora_mas_activa: horaMasActiva ? `${horaMasActiva}:00` : null,
        };
    },

    async consultar_trofeos_plex(args, ctx) {
        if (!ctx.guildId) return { error: "Solo disponible en servidores." };
        const plexTrofeos = require("../../systems/plexTrofeos");
        const plexIdiomas = require("../../systems/plexIdiomas");
        const nombre = (discordId) =>
            ctx.guild?.members?.cache?.get(discordId)?.displayName ||
            plexLinks.getLinkByDiscordId(ctx.guildId, discordId)?.plexUsername ||
            "alguien";
        const dificultad = (d) => plexIdiomas.DIFICULTADES[d]?.nombre || null;

        if (args?.persona) {
            const r = await resolverPersonaVinculada(args.persona, ctx);
            if (r.error) return r;
            // Quien oculta sus logros de Plex no los enseña (salvo a sí mismo).
            if (r.discordId !== ctx.userId && plexTrofeos.oculto(ctx.guildId, r.discordId)) {
                return { persona: args.persona, oculto: true, error: `${args.persona} tiene sus logros de Plex ocultos.` };
            }
            const plex = achievementsSystem.listUserAchievements(ctx.guildId, r.discordId).filter((a) => a.category === "plex");
            const hechos = plex.filter((a) => a.completed).sort((a, b) => b.completedAt - a.completedAt);
            const rarezas = plexTrofeos.rarezas(ctx.guildId);
            const porDificultad = (d) => hechos.filter((a) => a.dificultad === d).length;
            return {
                persona: args.persona,
                logros_de_plex_completados: hechos.length,
                logros_de_plex_totales: plex.length,
                por_dificultad: { facil: porDificultad("facil"), normal: porDificultad("normal"), gordo_del_plex: porDificultad("gordo") },
                trofeos: hechos
                    .filter((a) => a.trofeo)
                    .slice(0, 15)
                    .map((a) => ({
                        nombre: a.name,
                        de_que_es: a.desc,
                        dificultad: dificultad(a.dificultad),
                        lo_tiene_el_pct_del_servidor: rarezas.get(a.id) || null,
                    })),
                ultimos_conseguidos: hechos.slice(0, 10).map((a) => ({
                    nombre: a.name,
                    descripcion: a.desc,
                    fecha: new Date(a.completedAt).toISOString().slice(0, 10),
                })),
                sin_reclamar: hechos.filter((a) => a.claimable).length,
            };
        }

        if (args?.titulo) {
            const lista = plexTrofeos.buscar(ctx.guildId, args.titulo);
            if (!lista.length) {
                return {
                    titulo: args.titulo,
                    encontrado: false,
                    nota: "Nadie tiene todavía un trofeo de eso (los de cada serie, saga o director se crean cuando alguien lo consigue).",
                };
            }
            return {
                titulo: args.titulo,
                trofeos: lista.map((t) => ({
                    nombre: t.nombre,
                    de_que_es: t.descripcion,
                    dificultad: dificultad(t.dificultad),
                    quien_lo_tiene: t.quienes.map(nombre),
                })),
            };
        }

        const r = require("../../systems/plexRankings").rankings(ctx.guildId);
        if (!r) return { error: "Nadie tiene la cuenta de Plex vinculada todavía." };
        return {
            mas_logros_de_plex: r.logros.map((x) => ({ persona: nombre(x.discordUserId), logros: x.n })),
            mas_gordos_del_plex: r.gordos.map((x) => ({ persona: nombre(x.discordUserId), gordos: x.n })),
            mas_poliglota: r.poliglota.map((x) => ({ persona: nombre(x.discordUserId), logros_de_idioma: x.n })),
        };
    },

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
        const limitCheck = guildSettings.checkAndConsumeLimit(ctx.guildId, "seerr_request", ctx.userId, { dailyLimit: dailyRequestLimit });
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

module.exports = {
    DUENDE_CORE_TOOL_DECLARATIONS,
    DUENDE_PLEX_TOOL_DECLARATIONS,
    DUENDE_SEERR_TOOL_DECLARATIONS,
    DUENDE_ECONOMIA_TOOL_DECLARATIONS,
    DUENDE_TOOL_EXECUTORS,
};
