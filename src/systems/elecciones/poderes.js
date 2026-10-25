// 👑 Las reglas de los poderes del presidente: quién lo es, sobre quién puede actuar, cuánto puede durar un silencio, la espera
// entre acciones sobre la misma persona y el tope de canales. Sin Discord: quien llama pasa los datos del miembro ya mirados
// (si es bot, admin o staff, y la posición de su rol más alto).
const repo = require("./repositorio");
const presidencia = require("./repositorioPresidencia");
const { ajustes, MIN_MS } = require("./ajustes");

const TIPOS_SANCION = { silencio: "🔇 silencio", sordera: "🙉 sordera" };
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 50;

const error = (mensaje) => ({ ok: false, mensaje });

/** La elección cuyo mandato tiene ahora `userId`, o null si no es el presidente. */
function mandatoDe(guildId, userId) {
    const eleccion = repo.activa(guildId);
    return eleccion?.estado === "mandato" && eleccion.presidenteId === String(userId) ? eleccion : null;
}

/** El presidente en ejercicio del servidor (su id y su elección), o null. */
function presidenteActual(guildId) {
    const eleccion = repo.activa(guildId);
    return eleccion?.estado === "mandato" ? { userId: eleccion.presidenteId, eleccion } : null;
}

/**
 * ¿Puede el presidente actuar sobre esta persona? Nunca sobre sí mismo, bots, admins, staff ni quien tenga un rol más alto que
 * el suyo.
 * @param {{ id: string, esBot: boolean, esAdmin: boolean, esStaff: boolean, posicion: number }} objetivo
 * @param {{ id: string, posicion: number }} presidente `posicion`: la del rol más alto de cada uno
 */
function validarObjetivo(objetivo, presidente) {
    if (!objetivo) return error("❌ Esa persona no está en el servidor.");
    if (objetivo.id === presidente.id) return error("🙃 No puedes usar tus poderes contigo mismo.");
    if (objetivo.esBot) return error("🤖 Los bots están fuera del alcance del presidente.");
    if (objetivo.esAdmin || objetivo.esStaff) return error("🛡️ Los admins y el staff están fuera del alcance del presidente.");
    if (objetivo.posicion > presidente.posicion) return error("⛔ Esa persona tiene un rol por encima del tuyo.");
    return { ok: true };
}

/** Los minutos de un silencio o una sordera: de 1 al máximo del servidor. */
function validarMinutos(guildId, minutos) {
    const max = ajustes(guildId).maxSancionMin;
    if (!Number.isInteger(minutos) || minutos < 1 || minutos > max) return error(`⏱️ La duración va de 1 a ${max} minutos.`);
    return { ok: true, minutos };
}

/** Cuánto le falta (ms) al presidente para poder volver a actuar sobre esa persona; 0 si ya puede. */
function espera(eleccion, objetivoId, ahora = Date.now()) {
    const cooldown = ajustes(eleccion.guildId).cooldownMin * MIN_MS;
    const ultima = presidencia.ultimaAccionSobre(eleccion.id, objetivoId);
    return ultima === null ? 0 : Math.max(0, ultima + cooldown - ahora);
}

/** Apunta una acción del presidente (cuenta para la espera y sale en el panel). */
function registrar(eleccion, accion, objetivoId = null, ahora = Date.now()) {
    presidencia.registrarAccion({
        eleccionId: eleccion.id,
        guildId: eleccion.guildId,
        presidenteId: eleccion.presidenteId,
        accion,
        objetivoId,
        ahora,
    });
}

/**
 * Apunta un silencio o una sordera para revertirlos al acabar. No se acumulan: si ya tiene una del mismo tipo, error.
 * @returns {{ ok: true, id: number, fin: number } | { ok: false, mensaje: string }}
 */
function sancionar(eleccion, userId, tipo, minutos, ahora = Date.now()) {
    if (!TIPOS_SANCION[tipo]) throw new Error(`Tipo de sanción no válido: ${tipo}`);
    const m = validarMinutos(eleccion.guildId, minutos);
    if (!m.ok) return m;
    if (presidencia.sancionActiva(eleccion.guildId, userId, tipo))
        return error(`⏳ Esa persona ya tiene un ${TIPOS_SANCION[tipo]} en curso.`);
    const fin = ahora + minutos * MIN_MS;
    const id = presidencia.registrarSancion({ eleccionId: eleccion.id, guildId: eleccion.guildId, userId, tipo, ahora, fin });
    return { ok: true, id, fin };
}

/** Limpia el nombre de un canal nuevo: de 2 a 50 caracteres, sin saltos de línea. */
function validarNombreCanal(nombre) {
    const n = String(nombre ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (n.length < NOMBRE_MIN || n.length > NOMBRE_MAX)
        return error(`❌ El nombre del canal va de ${NOMBRE_MIN} a ${NOMBRE_MAX} caracteres.`);
    return { ok: true, nombre: n };
}

/** ¿Puede crear otro canal? Hace falta la categoría configurada y no pasarse del tope. */
function puedeCrearCanal(eleccion) {
    const a = ajustes(eleccion.guildId);
    if (!a.categoria) return error("📁 Los admins todavía no han elegido la categoría para los canales del presidente.");
    const usados = presidencia.canalesActivos(eleccion.id).length;
    if (usados >= a.maxCanales) return error(`📁 Ya has creado ${usados} de ${a.maxCanales} canales: borra uno antes.`);
    return { ok: true, categoria: a.categoria };
}

module.exports = {
    TIPOS_SANCION,
    mandatoDe,
    presidenteActual,
    validarObjetivo,
    validarMinutos,
    espera,
    registrar,
    sancionar,
    validarNombreCanal,
    puedeCrearCanal,
};
