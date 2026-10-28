// 🔔 Avisos por DM (#431): todos los DM que el bot manda a una persona pasan por `enviarAviso`, que mira antes si esa persona
// los tiene apagados (`/avisos`). Las alertas de administración (resumen semanal, alertas, recuerdos propuestos) no son avisos
// de este tipo: se mandan con `sendDm` y no se pueden apagar. Las preferencias son globales (todos los servidores).
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Avisos");

/** Los tipos de DM que se pueden apagar. `id` es lo que se guarda; el orden es el del panel de /avisos. */
const TIPOS = [
    { id: "racha_peligro", emoji: "⏳", nombre: "Racha en peligro", detalle: "Si no has ganado XP hoy y tu racha va a romperse" },
    { id: "racha_perdida", emoji: "💔", nombre: "Racha perdida", detalle: "Una sola vez, cuando pierdes una racha de 3 días o más" },
    { id: "racha_activa", emoji: "🔥", nombre: "Racha activa", detalle: "Cuando sumas un día más a tu racha" },
    {
        id: "logros_pendientes",
        emoji: "🏅",
        nombre: "Logros sin reclamar",
        detalle: "Los domingos, si tienes logros completados sin reclamar",
    },
    { id: "recordatorio_partido", emoji: "⏰", nombre: "Recordatorio de partido", detalle: "Antes de un partido al que has apostado" },
    {
        id: "equipo_favorito",
        emoji: "⭐",
        nombre: "Equipos favoritos",
        detalle: "Cuando aparece un partido de un equipo que sigues en /favoritos",
    },
    { id: "apuesta_cobrada", emoji: "🏆", nombre: "Apuesta cobrada", detalle: "Cuando ganas o te devuelven una apuesta" },
    {
        id: "pase_recompensas",
        emoji: "🛡️",
        nombre: "Recompensas del pase",
        detalle: "El último día de la temporada, si tienes niveles del pase sin cobrar",
    },
    {
        id: "quiniela_recordatorio",
        emoji: "🧾",
        nombre: "Quiniela sin enviar",
        detalle: "Unas horas antes de que se cierre una quiniela que no has enviado",
    },
    {
        id: "resumen_apuestas",
        emoji: "📊",
        nombre: "Resumen semanal de apuestas",
        detalle: "Tu balance de apuestas de la semana, los lunes",
    },
    { id: "alerta_cuota", emoji: "🔔", nombre: "Alertas de cuota", detalle: "Cuando la cuota que vigilas llega al valor que pusiste" },
    { id: "wrapped", emoji: "🎞️", nombre: "Wrapped mensual", detalle: "Tu resumen de Plex del mes, el día 1" },
    { id: "plex_series", emoji: "📺", nombre: "Series seguidas", detalle: "Episodios nuevos de las series que sigues" },
    { id: "plex_quiero_ver", emoji: "🍿", nombre: "Quiero ver", detalle: "Cuando llega a Plex algo de tu lista" },
    {
        id: "plex_resenas",
        emoji: "⭐",
        nombre: "Reseñas de Plex",
        detalle: "El DM para puntuar lo que terminas de ver",
    },
    {
        id: "tienda_deseos",
        emoji: "⭐",
        nombre: "Lista de deseos",
        detalle: "Cuando un objeto que sigues en la tienda vuelve a tener stock o baja de precio",
    },
    {
        id: "clasificacion_domingo",
        emoji: "🏆",
        nombre: "Clasificación del domingo",
        detalle: "Si lo activas en tu perfil: el domingo, si vas primero en la clasificación semanal",
    },
    { id: "pedido_seerr", emoji: "📥", nombre: "Pedidos de Seerr", detalle: "Cuando lo que pediste ya está disponible" },
    { id: "robo", emoji: "🥷", nombre: "Robos", detalle: "Cuando alguien intenta robarte" },
    {
        id: "cripto_ordenes",
        emoji: "🔔",
        nombre: "Órdenes de TTCL",
        detalle: "Alertas de precio, stop-loss ejecutados y compras recurrentes que se saltan",
    },
    { id: "cripto_evento", emoji: "📈", nombre: "Eventos de TTCL", detalle: "Cuando el mercado sube o baja por un evento" },
    { id: "prestamo", emoji: "🧙", nombre: "Préstamos del Duende", detalle: "Cuando vence un préstamo" },
    { id: "retos", emoji: "⚔️", nombre: "Retos", detalle: "Te toca jugar o un reto tuyo está a punto de caducar" },
    { id: "cooldown", emoji: "🔔", nombre: "Cooldowns", detalle: "Cuando /trabajar o /robar vuelven a estar disponibles" },
    { id: "sugerencia", emoji: "💡", nombre: "Sugerencias", detalle: "Cuando un admin acepta o descarta una idea tuya" },
    { id: "subastas", emoji: "🔨", nombre: "Subastas", detalle: "Si te superan en una puja, ganas una subasta o se cierra una tuya" },
    { id: "loteria", emoji: "🎟️", nombre: "Lotería", detalle: "Si uno de tus boletos gana el sorteo del domingo" },
    { id: "elecciones", emoji: "🗳️", nombre: "Elecciones", detalle: "Los programas de los candidatos cuando empiezan las generales" },
];

const NO_MOLESTAR = "no_molestar";
const ids = new Set(TIPOS.map((t) => t.id));

function tipoValido(tipo) {
    return ids.has(tipo);
}

/** Cada vez que se añade un tipo nuevo hay que registrarlo en TIPOS: un tipo desconocido es un fallo del código, no de quien recibe. */
function exigirTipo(tipo) {
    if (!tipoValido(tipo)) throw new Error(`Tipo de aviso desconocido: ${tipo}`);
}

const filaDe = (userId, tipo) => db.prepare("SELECT activo FROM preferencias_dm WHERE userId = ? AND tipo = ?").get(String(userId), tipo);

/** ¿Tiene "no molestar"? */
function noMolestar(userId) {
    return filaDe(userId, NO_MOLESTAR)?.activo === 1;
}

/** ¿Debe recibir este tipo de aviso? Sí salvo que lo haya apagado o tenga "no molestar". */
function activo(userId, tipo) {
    exigirTipo(tipo);
    if (noMolestar(userId)) return false;
    return filaDe(userId, tipo)?.activo !== 0;
}

/** Enciende o apaga un tipo de aviso. */
function fijar(userId, tipo, valor) {
    exigirTipo(tipo);
    db.prepare(
        "INSERT INTO preferencias_dm (userId, tipo, activo) VALUES (?, ?, ?) ON CONFLICT(userId, tipo) DO UPDATE SET activo = excluded.activo",
    ).run(String(userId), tipo, valor ? 1 : 0);
}

/** Enciende o apaga "no molestar". */
function fijarNoMolestar(userId, valor) {
    db.prepare(
        "INSERT INTO preferencias_dm (userId, tipo, activo) VALUES (?, ?, ?) ON CONFLICT(userId, tipo) DO UPDATE SET activo = excluded.activo",
    ).run(String(userId), NO_MOLESTAR, valor ? 1 : 0);
}

/** El estado de cada tipo para pintar /avisos. `activo` es lo que ha elegido, aunque "no molestar" lo tape. */
function estado(userId) {
    const filas = new Map(
        db
            .prepare("SELECT tipo, activo FROM preferencias_dm WHERE userId = ?")
            .all(String(userId))
            .map((f) => [f.tipo, f.activo]),
    );
    return {
        noMolestar: filas.get(NO_MOLESTAR) === 1,
        tipos: TIPOS.map((t) => ({ ...t, activo: filas.get(t.id) !== 0 })),
    };
}

/**
 * ¿Hay que callarse? Es true (y lo anota en el log) si la persona tiene apagado ese aviso o "no molestar". Para quien
 * ya tiene su propio envío con su propio manejo de errores: pregunta esto antes y no manda nada si es true.
 */
function silenciado(userId, tipo) {
    if (activo(userId, tipo)) return false;
    log.debug(`Aviso «${tipo}» no enviado a ${userId}: lo tiene apagado`);
    return true;
}

/** Manda un DM sin mirar preferencias. Para lo que no se puede apagar (alertas de administración). */
async function sendDm(client, userId, payload) {
    return (await intentarDm(client, userId, payload)) === "ok";
}

/**
 * Como sendDm, pero distingue por qué no llegó (#423): "ok", "cerrado" (tiene los DMs cerrados, código 50007: no es un error del
 * bot) o "error" (cualquier otro motivo).
 * @returns {Promise<"ok" | "cerrado" | "error">}
 */
async function intentarDm(client, userId, payload) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(payload);
        return "ok";
    } catch (e) {
        // Lo normal es que tenga los DMs cerrados (código 50007): no es un error del bot.
        log.debug(`No se pudo enviar DM a ${userId}: ${e.code === 50007 ? "DMs cerrados" : e.message}`);
        return e.code === 50007 ? "cerrado" : "error";
    }
}

/**
 * Manda un aviso por DM si la persona no lo tiene apagado. Si lo tiene apagado, no manda nada, lo anota en el log y
 * devuelve false (nunca lanza). Con `usuario` (un User ya cargado) no hace falta pedirlo a Discord.
 * @returns {Promise<boolean>} true si el DM salió
 */
async function enviarAviso(client, userId, tipo, payload, { usuario } = {}) {
    if (silenciado(userId, tipo)) return false;
    if (usuario) {
        try {
            await usuario.send(payload);
            return true;
        } catch (e) {
            log.debug(`No se pudo enviar DM a ${userId}: ${e.code === 50007 ? "DMs cerrados" : e.message}`);
            return false;
        }
    }
    return sendDm(client, userId, payload);
}

module.exports = {
    TIPOS,
    NO_MOLESTAR,
    tipoValido,
    activo,
    noMolestar,
    fijar,
    fijarNoMolestar,
    estado,
    silenciado,
    sendDm,
    intentarDm,
    enviarAviso,
};
