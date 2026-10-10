// Retos a duelo y contra el Duende: aceptar, rechazar o cancelar, y jugar cada juego (dados, piedra-papel-tijera y
// blackjack) hasta que se resuelve.
const db = require("../../core/db");
const bj = require("../blackjack");
const { createLogger } = require("../../core/logger");
const { MAX_RONDAS_PPT, PPT, DUENDE, SIN_EFECTIVO } = require("./constantes");
const { error, SinEfectivo, esParticipante, jugadaAlAzar, azar } = require("./comun");
const { obtener, guardarDatos, partidoDe } = require("./persistencia");
const { unir, devolver, ganar } = require("./cobros");

const log = createLogger("Retos");

/** El rival acepta: se le cobra y empieza (los dados se tiran en el momento). */
function aceptar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || !["partido", "duelo"].includes(reto.tipo)) return error("❌ Ese reto ya no existe.");
    if (reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.rival !== String(userId)) return error("⛔ Este reto no es para ti.");
    if (reto.expira_en && reto.expira_en <= Date.now()) return error("⌛ Este reto ha caducado.");
    if (reto.tipo === "partido") {
        const p = partidoDe(reto.match_id);
        if (!p || p.estado !== "abierto" || !(p.start_time > new Date().toISOString())) return error("⏱️ El partido ya ha empezado.");
    }
    try {
        db.transaction(() => {
            const r = db
                .prepare("UPDATE retos SET estado = 'en_juego', actualizado_en = ? WHERE id = ? AND estado = 'pendiente'")
                .run(Date.now(), reto.id);
            if (r.changes !== 1) throw new Error("carrera");
            if (!unir(reto, userId, reto.tipo === "partido" ? "en_contra" : null)) throw new SinEfectivo();
            if (reto.juego === "ppt") guardarDatos(reto.id, { ronda: 1, jugadas: {}, empates: [] });
            if (reto.juego === "blackjack") guardarDatos(reto.id, repartirBlackjack(reto));
            if (reto.juego === "dados") jugarDados(reto);
        })();
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        if (e.message === "carrera") return error("Este reto ya no está pendiente.");
        throw e;
    }
    log.info(`Reto ${reto.id} aceptado por ${userId}`);
    return { ok: true, reto: obtener(reto.id) };
}

/** El rival lo rechaza: se devuelve lo del creador. */
function rechazar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.rival !== String(userId)) return error("⛔ Este reto no es para ti.");
    const r = devolver(reto.id, "rechazado");
    return r ? { ok: true, reto: r.reto } : error("Este reto ya no está pendiente.");
}

/** El creador lo retira antes de que lo acepten. */
function cancelar(retoId, userId) {
    const reto = obtener(retoId);
    if (!reto || reto.estado !== "pendiente") return error("Este reto ya no está pendiente.");
    if (reto.creador !== String(userId)) return error("⛔ Solo quien lanzó el reto puede cancelarlo.");
    const r = devolver(reto.id, "cancelado");
    return r ? { ok: true, reto: r.reto } : error("Este reto ya no está pendiente.");
}

// ─── Duelos ──────────────────────────────────────────────────────────────────

function duelo(retoId, userId, juego) {
    const reto = obtener(retoId);
    if (!reto || reto.tipo !== "duelo" || reto.juego !== juego) return { error: error("❌ Ese duelo ya no existe.") };
    if (reto.estado !== "en_juego") return { error: error("Este duelo ya ha terminado.") };
    if (!esParticipante(reto, userId)) return { error: error("⛔ No juegas en este duelo.") };
    return { reto };
}

const tirada = () => [1 + Math.floor(azar() * 6), 1 + Math.floor(azar() * 6)];
const suma = (t) => t[0] + t[1];

/** Dos dados cada uno; gana la suma más alta y, si empatan, se vuelve a tirar. */
function jugarDados(reto) {
    const tiradas = [];
    for (let n = 0; n < 10; n++) {
        const t = { [reto.creador]: tirada(), [reto.rival]: tirada() };
        tiradas.push(t);
        if (suma(t[reto.creador]) !== suma(t[reto.rival])) break;
    }
    guardarDatos(reto.id, { tiradas });
    const ultima = tiradas.at(-1);
    const a = ultima[reto.creador];
    const b = ultima[reto.rival];
    const texto = `🎲 ${a[0]}+${a[1]} = **${suma(a)}** contra ${b[0]}+${b[1]} = **${suma(b)}**${tiradas.length > 1 ? ` (tras ${tiradas.length - 1} empate${tiradas.length > 2 ? "s" : ""})` : ""}`;
    if (suma(a) === suma(b)) return devolver(reto.id, "empate");
    return ganar(reto.id, [suma(a) > suma(b) ? reto.creador : reto.rival], texto);
}

/** Piedra, papel o tijera: cada uno elige en secreto; con las dos jugadas se resuelve. Empate: otra ronda. */
function jugarPpt(retoId, userId, jugada) {
    const { reto, error: e } = duelo(retoId, userId, "ppt");
    if (e) return e;
    if (!PPT[jugada]) return error("❌ Jugada no válida.");
    const datos = reto.datos || { ronda: 1, jugadas: {}, empates: [] };
    if (datos.jugadas[String(userId)]) return error("Ya has elegido en esta ronda: falta el otro.");
    datos.jugadas[String(userId)] = jugada;
    const a = datos.jugadas[reto.creador];
    const b = datos.jugadas[reto.rival];
    if (!a || !b) {
        guardarDatos(reto.id, datos);
        return { ok: true, reto: obtener(reto.id), mensaje: `Has elegido ${PPT[jugada].emoji} **${jugada}**. Falta el otro.` };
    }
    if (a === b) {
        datos.empates.push(a);
        if (datos.empates.length >= MAX_RONDAS_PPT) {
            guardarDatos(reto.id, datos);
            const r = devolver(reto.id, `empate ${MAX_RONDAS_PPT} veces seguidas`);
            return { ok: true, reto: r?.reto || obtener(reto.id) };
        }
        datos.jugadas = {};
        // El Duende vuelve a elegir en cuanto empieza la ronda nueva.
        if (esParticipante(reto, DUENDE)) datos.jugadas[DUENDE] = jugadaAlAzar();
        datos.ronda++;
        guardarDatos(reto.id, datos);
        return { ok: true, reto: obtener(reto.id), mensaje: `🤝 Empate a ${PPT[a].emoji}: otra ronda.` };
    }
    guardarDatos(reto.id, datos);
    const ganador = PPT[a].gana_a === b ? reto.creador : reto.rival;
    const r = ganar(reto.id, [ganador], `${PPT[a].emoji} ${a} contra ${PPT[b].emoji} ${b}`);
    return { ok: true, reto: r?.reto || obtener(reto.id) };
}

// Blackjack: cada uno juega su mano a la vez y sin ver la del otro (se ve en privado); al terminar los dos, gana
// el que más se acerque a 21 sin pasarse. Sin crupier.
function repartirBlackjack(reto) {
    const baraja = bj.crearBaraja(1);
    const robar = () => bj.sacarCarta(baraja, azar);
    const manos = { [reto.creador]: [robar(), robar()], [reto.rival]: [robar(), robar()] };
    // Con 21 de salida no hay nada que hacer: esa mano ya está plantada.
    const plantados = Object.fromEntries(Object.entries(manos).map(([id, m]) => [id, bj.handValue(m) === 21]));
    return { baraja, manos, plantados };
}

/** Valor de la mano de alguien en un duelo de blackjack. */
function valorMano(reto, userId) {
    return bj.handValue(reto.datos?.manos?.[String(userId)] || []);
}

function resolverBlackjack(reto) {
    const { manos } = reto.datos;
    const va = bj.handValue(manos[reto.creador]);
    const vb = bj.handValue(manos[reto.rival]);
    const puntos = (v, mano) => (v > 21 ? -1 : v === 21 && bj.esBlackjack(mano) ? 21.5 : v);
    const pa = puntos(va, manos[reto.creador]);
    const pb = puntos(vb, manos[reto.rival]);
    const txt = (v, mano) => (v > 21 ? `${v} (se pasa)` : bj.esBlackjack(mano) ? "blackjack" : String(v));
    const texto = `🃏 ${txt(va, manos[reto.creador])} contra ${txt(vb, manos[reto.rival])}`;
    if (pa === pb) return devolver(reto.id, va > 21 ? "empate: los dos se pasan" : `empate a ${txt(va, manos[reto.creador])}`);
    return ganar(reto.id, [pa > pb ? reto.creador : reto.rival], texto);
}

/** Pedir carta (`pedir`) o plantarse. Cuando los dos han terminado, se resuelve. */
function jugarBlackjack(retoId, userId, accion) {
    const { reto, error: e } = duelo(retoId, userId, "blackjack");
    if (e) return e;
    const yo = String(userId);
    const datos = reto.datos;
    if (datos.plantados[yo]) return error("Ya has terminado tu mano: falta el otro.");
    if (accion === "pedir") {
        datos.manos[yo].push(bj.sacarCarta(datos.baraja, azar));
        if (bj.handValue(datos.manos[yo]) >= 21) datos.plantados[yo] = true;
    } else {
        datos.plantados[yo] = true;
    }
    return db.transaction(() => {
        guardarDatos(reto.id, datos);
        const actual = obtener(reto.id);
        if (Object.values(datos.plantados).every(Boolean)) {
            const r = resolverBlackjack(actual);
            return { ok: true, reto: r?.reto || obtener(reto.id) };
        }
        return { ok: true, reto: actual };
    })();
}

module.exports = { aceptar, rechazar, cancelar, jugarPpt, jugarBlackjack, valorMano, resolverBlackjack };
