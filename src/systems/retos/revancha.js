// 🔁 Revancha (#318): tras un duelo resuelto, uno de los dos propone otro igual al otro: mismo juego, misma cantidad y la misma serie. Solo
// se puede pedir una vez por duelo, si los dos tienen efectivo para la cantidad, y no hay revancha contra el Duende (él propone sus
// retos desde el chat).
const dinero = require("../dinero");
const { DUENDE } = require("./constantes");
const { error, esParticipante } = require("./comun");
const { obtener, guardarDatos } = require("./persistencia");
const { crearDuelo } = require("./crear");

/** ¿Se puede ofrecer la revancha de este reto? Un duelo resuelto entre dos personas y sin revancha pedida. */
function admiteRevancha(reto) {
    return Boolean(
        reto &&
        reto.tipo === "duelo" &&
        reto.estado === "resuelto" &&
        reto.rival &&
        reto.creador !== DUENDE &&
        reto.rival !== DUENDE &&
        !reto.datos?.revancha,
    );
}

/**
 * Pide la revancha de un duelo: crea otro, de `userId` contra el otro jugador, con los mismos datos. El duelo de origen guarda cuál es
 * su revancha, así que no se puede pedir dos veces. `donde`: { guildId, channelId } del mensaje.
 * @returns {{ ok: true, reto: object, origen: object } | { ok: false, mensaje: string }}
 */
function pedirRevancha(retoId, userId, donde = {}) {
    const origen = obtener(retoId);
    if (!origen || origen.tipo !== "duelo") return error("❌ Solo se puede pedir la revancha de un duelo.");
    if (origen.estado !== "resuelto") return error("❌ La revancha se pide cuando el duelo ha terminado.");
    if (!esParticipante(origen, userId)) return error("⛔ Solo quien jugó el duelo puede pedir la revancha.");
    if (origen.creador === DUENDE || origen.rival === DUENDE)
        return error("🧙 Contra el Duende no hay revancha: pídele otro reto en el chat.");
    if (origen.datos?.revancha) return error("🔁 Ya se ha pedido la revancha de este duelo.");

    const rival = String(origen.creador) === String(userId) ? origen.rival : origen.creador;
    if (dinero.efectivo(userId) < origen.cantidad) return error("❌ No te llega el efectivo para la revancha.");
    if (dinero.efectivo(rival) < origen.cantidad) return error("❌ Esa persona no tiene efectivo para la revancha ahora mismo.");

    const nuevo = crearDuelo({
        creador: userId,
        rival,
        juego: origen.juego,
        cantidad: origen.cantidad,
        serie: origen.serie,
        guildId: donde.guildId ?? origen.guildId,
        channelId: donde.channelId ?? origen.channelId,
    });
    if (!nuevo.ok) return nuevo;
    guardarDatos(origen.id, { ...origen.datos, revancha: nuevo.reto.id });
    return { ok: true, reto: nuevo.reto, origen: obtener(origen.id) };
}

module.exports = { admiteRevancha, pedirRevancha };
