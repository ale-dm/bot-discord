// 🃏 Una mano de Texas hold'em (#531), sin Discord ni dinero: repartir, ciegas, turnos, las acciones válidas (retirarse,
// pasar, igualar, subir y all-in), las calles (flop, turn y river), los botes laterales y el showdown. El estado es un objeto
// plano que cada función recibe y modifica; las fichas son las de la mesa (el dinero solo se mueve al sentarse y al
// levantarse, en systems/poker/mesas.js). La baraja y el azar se inyectan en los tests.
const { crearBaraja, sacar, mejorMano, comparar } = require("./cartas");

const CALLES = ["preflop", "flop", "turn", "river"];
const CARTAS_CALLE = { flop: 3, turn: 1, river: 1 };

const error = (motivo) => ({ ok: false, motivo });
const puedeActuar = (j) => !j.retirado && !j.allIn;
const vivos = (e) => e.jugadores.filter((j) => !j.retirado);

/** El siguiente asiento después de `desde` que cumple `cumple`, o -1. */
function siguiente(e, desde, cumple = puedeActuar) {
    const n = e.jugadores.length;
    for (let k = 1; k <= n; k++) {
        const i = (desde + k) % n;
        if (cumple(e.jugadores[i])) return i;
    }
    return -1;
}

/** Pone `cantidad` fichas del jugador en el bote (como mucho las que tiene: entonces queda all-in). */
function poner(j, cantidad) {
    const real = Math.min(cantidad, j.fichas);
    j.fichas -= real;
    j.apostadoCalle += real;
    j.apostadoTotal += real;
    if (j.fichas === 0) j.allIn = true;
    return real;
}

/**
 * Empieza una mano. `asientos`: [{ userId, fichas }] en el orden de la mesa (al menos 2 con fichas); `boton`: índice del
 * botón. Con dos jugadores, el botón pone la ciega pequeña y habla primero antes del flop.
 */
function nuevaMano({ asientos, boton = 0, sb = 50, bb = 100, rng = Math.random, baraja = crearBaraja() }) {
    const e = {
        jugadores: asientos.map((a) => ({
            userId: a.userId,
            fichas: a.fichas,
            cartas: [],
            apostadoCalle: 0,
            apostadoTotal: 0,
            retirado: false,
            allIn: false,
            haActuado: false,
        })),
        boton,
        sb,
        bb,
        baraja,
        rng,
        mesa: [],
        calle: "preflop",
        turno: -1,
        apuestaActual: 0,
        minSubida: bb,
        fin: false,
        resultado: null,
    };
    for (let r = 0; r < 2; r++) for (const j of e.jugadores) j.cartas.push(sacar(e.baraja, rng));
    const n = e.jugadores.length;
    const sbIdx = n === 2 ? boton : (boton + 1) % n;
    const bbIdx = (sbIdx + 1) % n;
    poner(e.jugadores[sbIdx], sb);
    poner(e.jugadores[bbIdx], bb);
    e.apuestaActual = Math.max(e.jugadores[sbIdx].apostadoCalle, e.jugadores[bbIdx].apostadoCalle);
    e.turno = siguiente(e, bbIdx);
    progresar(e);
    return e;
}

/** Lo que puede hacer quien tiene el turno: { pasar, igualar, subirMin, subirMax, puedeSubir }. */
function acciones(e) {
    const j = e.jugadores[e.turno];
    if (!j || e.fin) return null;
    const falta = e.apuestaActual - j.apostadoCalle;
    const subirMax = j.apostadoCalle + j.fichas;
    const subirMin = Math.min(e.apuestaActual + e.minSubida, subirMax);
    return {
        userId: j.userId,
        pasar: falta <= 0,
        igualar: Math.max(0, Math.min(falta, j.fichas)),
        subirMin,
        subirMax,
        puedeSubir: subirMax > e.apuestaActual,
    };
}

/** Una subida hasta `total` (lo que lleva puesto en la calle): sube la apuesta y obliga a los demás a hablar otra vez. */
function subir(e, j, total) {
    poner(j, total - j.apostadoCalle);
    if (total > e.apuestaActual) {
        e.minSubida = Math.max(e.minSubida, total - e.apuestaActual);
        e.apuestaActual = total;
        for (const otro of e.jugadores) if (otro !== j) otro.haActuado = false;
    }
}

/**
 * Hace la acción de `userId` si es su turno y es válida: { tipo: 'retirarse'|'pasar'|'igualar'|'subir'|'allin', total? }.
 * `total` en una subida es lo que quiere tener puesto en esta calle. @returns {{ ok: true } | { ok: false, motivo }}
 */
function actuar(e, userId, { tipo, total }) {
    if (e.fin) return error("La mano ya ha terminado.");
    const j = e.jugadores[e.turno];
    if (!j || j.userId !== String(userId)) return error("No es tu turno.");
    const a = acciones(e);
    if (tipo === "retirarse") j.retirado = true;
    else if (tipo === "pasar") {
        if (!a.pasar) return error("No puedes pasar: hay una apuesta que igualar.");
    } else if (tipo === "igualar") {
        if (a.pasar) return error("No hay nada que igualar: puedes pasar.");
        poner(j, a.igualar);
    } else if (tipo === "subir") {
        if (!a.puedeSubir) return error("No te quedan fichas para subir.");
        if (!Number.isInteger(total) || total < a.subirMin || total > a.subirMax)
            return error(`Puedes subir hasta un total de ${a.subirMin} a ${a.subirMax}.`);
        subir(e, j, total);
    } else if (tipo === "allin") {
        if (j.fichas <= 0) return error("No te quedan fichas.");
        subir(e, j, j.apostadoCalle + j.fichas);
    } else return error("Acción desconocida.");
    j.haActuado = true;
    progresar(e);
    return { ok: true };
}

/** Si se agota el tiempo: pasa si puede y, si no, se retira. */
function actuarPorTiempo(e) {
    const a = acciones(e);
    if (!a) return null;
    actuar(e, a.userId, { tipo: a.pasar ? "pasar" : "retirarse" });
    return a.pasar ? "pasar" : "retirarse";
}

const rondaCompleta = (e) => e.jugadores.filter(puedeActuar).every((j) => j.haActuado && j.apostadoCalle >= e.apuestaActual);

/** Saca las cartas de la siguiente calle y empieza su ronda de apuestas. */
function siguienteCalle(e) {
    e.calle = CALLES[CALLES.indexOf(e.calle) + 1];
    for (let k = 0; k < CARTAS_CALLE[e.calle]; k++) e.mesa.push(sacar(e.baraja, e.rng));
    for (const j of e.jugadores) Object.assign(j, { apostadoCalle: 0, haActuado: false });
    e.apuestaActual = 0;
    e.minSubida = e.bb;
}

/** Después de cada acción: pasa el turno, cambia de calle o termina la mano. */
function progresar(e) {
    if (vivos(e).length === 1) return terminar(e);
    const quedan = e.jugadores.filter(puedeActuar);
    const solo = quedan.length <= 1 && quedan.every((j) => j.apostadoCalle >= e.apuestaActual);
    if (!solo && !rondaCompleta(e)) {
        const actual = e.jugadores[e.turno];
        if (!actual || !puedeActuar(actual) || (actual.haActuado && actual.apostadoCalle >= e.apuestaActual)) {
            e.turno = siguiente(e, e.turno, (j) => puedeActuar(j) && (!j.haActuado || j.apostadoCalle < e.apuestaActual));
        }
        return undefined;
    }
    if (e.calle === "river") return terminar(e);
    siguienteCalle(e);
    if (e.jugadores.filter(puedeActuar).length <= 1) return progresar(e);
    e.turno = siguiente(e, e.boton);
    return undefined;
}

/**
 * Reparte los botes: uno por cada nivel de lo puesto (los laterales de los all-in), entre los que siguen vivos y pusieron
 * hasta ese nivel. Si nadie vivo llega a un nivel (lo puso alguien que se retiró), va con el bote anterior.
 * @returns {Map<string, number>} lo que gana cada uno
 */
function repartirBotes(e) {
    const pagos = new Map();
    const niveles = [...new Set(e.jugadores.map((j) => j.apostadoTotal).filter((x) => x > 0))].sort((a, b) => a - b);
    const manos = new Map(vivos(e).map((j) => [j.userId, mejorMano([...j.cartas, ...e.mesa])]));
    const orden = (i) => (i - e.boton - 1 + e.jugadores.length) % e.jugadores.length;
    let anterior = 0;
    let arrastre = 0;
    for (const nivel of niveles) {
        const monto =
            e.jugadores.reduce((s, j) => s + Math.min(j.apostadoTotal, nivel) - Math.min(j.apostadoTotal, anterior), 0) + arrastre;
        anterior = nivel;
        const elegibles = e.jugadores.map((j, i) => ({ j, i })).filter(({ j }) => !j.retirado && j.apostadoTotal >= nivel);
        if (!elegibles.length) {
            arrastre = monto;
            continue;
        }
        arrastre = 0;
        const mejor = elegibles.reduce((m, x) => (comparar(manos.get(x.j.userId).valor, manos.get(m.j.userId).valor) > 0 ? x : m));
        const ganan = elegibles
            .filter((x) => comparar(manos.get(x.j.userId).valor, manos.get(mejor.j.userId).valor) === 0)
            .sort((a, b) => orden(a.i) - orden(b.i));
        const parte = Math.floor(monto / ganan.length);
        ganan.forEach((x, k) => pagos.set(x.j.userId, (pagos.get(x.j.userId) || 0) + parte + (k === 0 ? monto - parte * ganan.length : 0)));
    }
    if (arrastre) {
        const ultimo = vivos(e)[0];
        pagos.set(ultimo.userId, (pagos.get(ultimo.userId) || 0) + arrastre);
    }
    return { pagos, manos };
}

/** Cierra la mano: sin showdown si solo queda uno; si no, con las manos de los que siguen. Suma lo ganado a las fichas. */
function terminar(e) {
    e.fin = true;
    e.turno = -1;
    const quedan = vivos(e);
    let pagos;
    let manos = new Map();
    if (quedan.length === 1) {
        pagos = new Map([[quedan[0].userId, e.jugadores.reduce((s, j) => s + j.apostadoTotal, 0)]]);
    } else {
        while (e.mesa.length < 5) e.mesa.push(sacar(e.baraja, e.rng));
        ({ pagos, manos } = repartirBotes(e));
    }
    for (const j of e.jugadores) j.fichas += pagos.get(j.userId) || 0;
    e.resultado = { pagos, manos, showdown: quedan.length > 1 };
    return undefined;
}

/** Lo que hay en el bote ahora. */
const bote = (e) => e.jugadores.reduce((s, j) => s + j.apostadoTotal, 0);

module.exports = { CALLES, nuevaMano, acciones, actuar, actuarPorTiempo, repartirBotes, bote };
