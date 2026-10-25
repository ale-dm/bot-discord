// 🗳️ El ciclo de una elección: inscripción → primarias → programas → generales → mandato → cerrada (o cancelada). Cada fase
// dura lo que diga Config Global; al acabar, el cron llama a `avanzar`, que decide la siguiente y devuelve qué ha pasado para
// que discord/envios/elecciones.js lo anuncie. Sin Discord.
const repo = require("./repositorio");
const { duracionMs } = require("./ajustes");
const { clasificacion } = require("./votos");

/** Cuántos pasan de las primarias a las generales. */
const FINALISTAS = 4;
/** Con menos inscritos que esto, la elección se cancela. */
const MIN_CANDIDATOS = 2;
const NOMBRE_FASE = {
    inscripcion: "📝 Inscripción de candidatos",
    primarias: "🗳️ Primarias",
    programas: "📜 Programas electorales",
    generales: "🏛️ Elecciones generales",
    mandato: "👑 Mandato",
    cerrada: "🔒 Cerrada",
    cancelada: "✖️ Cancelada",
};

const error = (mensaje) => ({ ok: false, mensaje });

/**
 * Abre unas elecciones nuevas (empiezan en la inscripción). Solo una a la vez por servidor.
 * @returns {{ ok: true, eleccion: object } | { ok: false, mensaje: string }}
 */
function abrir({ guildId, creadaPor, channelId = null, ahora = Date.now() }) {
    if (repo.activa(guildId)) return error("🗳️ Ya hay unas elecciones en marcha en este servidor.");
    const eleccion = repo.crear({ guildId, creadaPor, channelId, ahora, fin: ahora + duracionMs(guildId, "inscripcion") });
    return { ok: true, eleccion };
}

/** Pasa a la fase `a` y devuelve la elección ya cambiada, o null si otra pasada se adelantó. */
function pasar(eleccion, a, ahora, extra = {}) {
    const fin = a === "cerrada" || a === "cancelada" ? ahora : ahora + duracionMs(eleccion.guildId, a);
    if (!repo.cambiarFase(eleccion.id, eleccion.estado, a, { ahora, fin, ...extra })) return null;
    return repo.obtener(eleccion.id);
}

const cancelarPor = (eleccion, motivo, ahora) => {
    const nueva = pasar(eleccion, "cancelada", ahora, { motivo });
    return nueva && { de: eleccion.estado, a: "cancelada", eleccion: nueva, motivo };
};

function cerrarInscripcion(eleccion, ahora) {
    const inscritos = repo.candidatos(eleccion.id);
    if (inscritos.length < MIN_CANDIDATOS) return cancelarPor(eleccion, `Se inscribieron menos de ${MIN_CANDIDATOS} candidatos.`, ahora);
    if (inscritos.length > FINALISTAS) {
        const nueva = pasar(eleccion, "primarias", ahora);
        return nueva && { de: eleccion.estado, a: "primarias", eleccion: nueva, candidatos: inscritos };
    }
    // Sin más candidatos que plazas, no hacen falta primarias: todos son finalistas.
    repo.marcarFinalistas(
        eleccion.id,
        inscritos.map((c) => c.userId),
    );
    const nueva = pasar(eleccion, "programas", ahora);
    return nueva && { de: eleccion.estado, a: "programas", eleccion: nueva, finalistas: inscritos, sinPrimarias: true };
}

function cerrarPrimarias(eleccion, ahora) {
    const tabla = clasificacion(eleccion.id, "primarias");
    if (tabla.length < MIN_CANDIDATOS) return cancelarPor(eleccion, "Quedan menos de 2 candidatos.", ahora);
    const finalistas = tabla.slice(0, FINALISTAS);
    repo.marcarFinalistas(
        eleccion.id,
        finalistas.map((c) => c.userId),
    );
    const nueva = pasar(eleccion, "programas", ahora);
    return nueva && { de: eleccion.estado, a: "programas", eleccion: nueva, clasificacion: tabla, finalistas };
}

function cerrarProgramas(eleccion, ahora) {
    const finalistas = repo.candidatos(eleccion.id, { finalistas: true });
    if (!finalistas.length) return cancelarPor(eleccion, "Todos los finalistas se han retirado.", ahora);
    const nueva = pasar(eleccion, "generales", ahora);
    return nueva && { de: eleccion.estado, a: "generales", eleccion: nueva, finalistas };
}

function cerrarGenerales(eleccion, ahora) {
    const tabla = clasificacion(eleccion.id, "generales");
    if (!tabla.length) return cancelarPor(eleccion, "Todos los finalistas se han retirado.", ahora);
    if (!tabla[0].votos) return cancelarPor(eleccion, "Nadie ha votado en las generales.", ahora);
    const ganador = tabla[0];
    const nueva = pasar(eleccion, "mandato", ahora, { presidenteId: ganador.userId });
    return nueva && { de: eleccion.estado, a: "mandato", eleccion: nueva, clasificacion: tabla, ganador };
}

/**
 * Cierra la fase en curso de una elección y pasa a la siguiente.
 * @returns {{ de: string, a: string, eleccion: object, [k: string]: any } | null} null si ya no estaba en esa fase
 */
function avanzar(eleccion, ahora = Date.now()) {
    switch (eleccion.estado) {
        case "inscripcion":
            return cerrarInscripcion(eleccion, ahora);
        case "primarias":
            return cerrarPrimarias(eleccion, ahora);
        case "programas":
            return cerrarProgramas(eleccion, ahora);
        case "generales":
            return cerrarGenerales(eleccion, ahora);
        case "mandato": {
            const nueva = pasar(eleccion, "cerrada", ahora, { motivo: "Fin del mandato." });
            return nueva && { de: "mandato", a: "cerrada", eleccion: nueva, presidenteId: eleccion.presidenteId };
        }
        default:
            return null;
    }
}

/**
 * Un admin cancela la elección en marcha. Si estaba en el mandato, es destituir al presidente.
 * @returns {{ ok: true, de: string, eleccion: object } | { ok: false, mensaje: string }}
 */
function cancelar(guildId, motivo, ahora = Date.now()) {
    const eleccion = repo.activa(guildId);
    if (!eleccion) return error("🗳️ No hay elecciones en marcha.");
    const destituir = eleccion.estado === "mandato";
    const nueva = pasar(eleccion, destituir ? "cerrada" : "cancelada", ahora, { motivo });
    if (!nueva) return error("🔄 La elección acaba de cambiar de fase: vuelve a intentarlo.");
    return { ok: true, de: eleccion.estado, eleccion: nueva, presidenteId: eleccion.presidenteId };
}

/** Un admin cierra ya la fase en curso: el cron la avanzará en la siguiente pasada (o quien llame, ya). */
function adelantar(guildId, ahora = Date.now()) {
    const eleccion = repo.activa(guildId);
    if (!eleccion) return error("🗳️ No hay elecciones en marcha.");
    repo.adelantarFin(eleccion.id, ahora);
    return { ok: true, eleccion: repo.obtener(eleccion.id) };
}

module.exports = { FINALISTAS, MIN_CANDIDATOS, NOMBRE_FASE, abrir, avanzar, cancelar, adelantar, vencidas: repo.vencidas };
