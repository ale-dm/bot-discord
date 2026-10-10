// Porras: una pregunta con opciones en la que se entra con una cantidad, y un admin decide cuál gana.
const db = require("../../core/db");
const { error, SinEfectivo } = require("./comun");
const { SIN_EFECTIVO } = require("./constantes");
const { obtener } = require("./persistencia");
const { unir, devolver, ganar } = require("./cobros");

// ─── Porras ──────────────────────────────────────────────────────────────────

function porra(retoId) {
    const reto = obtener(retoId);
    return reto && reto.tipo === "porra" ? reto : null;
}

/** Entrar en la porra con la opción `indice`. Una vez dentro no se cambia. */
function entrarPorra(retoId, userId, indice) {
    const reto = porra(retoId);
    if (!reto) return error("❌ Esa porra ya no existe.");
    if (reto.estado !== "abierta") return error("🔒 Esta porra ya no admite apuestas.");
    if (!reto.opciones[indice]) return error("❌ Esa opción no existe.");
    const yaDentro = reto.participantes.find((p) => p.userId === String(userId));
    if (yaDentro) return error(`Ya estás dentro: vas con **${reto.opciones[Number(yaDentro.opcion)]}**.`);
    try {
        db.transaction(() => {
            if (!unir(reto, userId, String(indice))) throw new SinEfectivo();
            db.prepare("UPDATE retos SET actualizado_en = ? WHERE id = ?").run(Date.now(), reto.id);
        })();
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        throw e;
    }
    return {
        ok: true,
        reto: obtener(reto.id),
        mensaje: `✅ Vas con **${reto.opciones[indice]}** (${reto.cantidad.toLocaleString("es")} 🪙).`,
    };
}

/** No se admiten más apuestas (quien la creó o un admin). */
function cerrarPorra(retoId, userId, esAdmin) {
    const reto = porra(retoId);
    if (!reto || reto.estado !== "abierta") return error("Esta porra ya no está abierta.");
    if (reto.creador !== String(userId) && !esAdmin) return error("⛔ Solo quien creó la porra o un admin pueden cerrarla.");
    db.prepare("UPDATE retos SET estado = 'cerrada', actualizado_en = ? WHERE id = ? AND estado = 'abierta'").run(Date.now(), reto.id);
    return { ok: true, reto: obtener(reto.id) };
}

/** Un admin dice qué opción ha ganado: el bote, entre los que la eligieron (si nadie la eligió, se devuelve). */
function resolverPorra(retoId, indice, esAdmin) {
    const reto = porra(retoId);
    if (!reto || !["abierta", "cerrada"].includes(reto.estado)) return error("Esta porra ya está resuelta.");
    if (!esAdmin) return error("⛔ Solo un admin puede decidir el resultado.");
    const opcion = reto.opciones[indice];
    if (!opcion) return error("❌ Esa opción no existe.");
    const ganadores = reto.participantes.filter((p) => p.opcion === String(indice)).map((p) => p.userId);
    const r = ganadores.length
        ? ganar(reto.id, ganadores, `ganó «${opcion}»`)
        : devolver(reto.id, reto.participantes.length ? `ganó «${opcion}» y nadie la eligió` : "sin participantes");
    return r ? { ok: true, reto: r.reto, pagos: r.pagos } : error("Esta porra ya está resuelta.");
}

/** Anular y devolverlo todo: un admin, o quien la creó si nadie más ha entrado. */
function anularPorra(retoId, userId, esAdmin) {
    const reto = porra(retoId);
    if (!reto || !["abierta", "cerrada"].includes(reto.estado)) return error("Esta porra ya está resuelta.");
    const soloSuya = reto.participantes.every((p) => p.userId === reto.creador);
    if (!esAdmin && !(reto.creador === String(userId) && soloSuya)) {
        return error("⛔ Solo un admin puede anularla (o quien la creó, si no ha entrado nadie más).");
    }
    const r = devolver(reto.id, "anulada");
    return r ? { ok: true, reto: r.reto, pagos: r.pagos } : error("Esta porra ya está resuelta.");
}

module.exports = { entrarPorra, cerrarPorra, resolverPorra, anularPorra };
