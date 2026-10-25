// 💸 Cash-out anticipado (#529): retirar una apuesta a un partido o una combinada que siguen en juego por lo que valen con las
// cuotas de ahora. Valor = lo apostado × cuota con la que se apostó ÷ cuota actual, menos un margen fijo del 8 %, con un tope
// de 1.000.000. En una combinada, las patas acertadas cuentan con cuota actual 1 y una pata fallada o anulada impide retirarla.
// Sin cuota actual (mercado suspendido, marcador exacto, partido cerrado) o con una cuota de hace más de 30 minutos, no se
// ofrece. La oferta se bloquea 60 segundos; al confirmar se recalcula y, si alguna cuota se ha movido más de un 10 % o ya no
// hay, se invalida. El cobro va por dinero.js y marca la apuesta en la misma transacción: se cobra una sola vez y la
// liquidación ya no la toca.
const crypto = require("crypto");
const db = require("../../core/db");
const dinero = require("../dinero");
const mercados = require("./mercados");
const { createLogger } = require("../../core/logger");

const log = createLogger("Apuestas");

const MARGEN_PCT = 8;
const MAX_VALOR = 1_000_000;
const BLOQUEO_MS = 60 * 1000;
const MOVIMIENTO_MAX_PCT = 10;
const CUOTA_MAX_EDAD_MS = 30 * 60 * 1000;
const ELECCIONES_1X2 = { home: "cuota_home", draw: "cuota_draw", away: "cuota_away" };

const ofertas = new Map(); // token -> { userId, tipo: "a" | "c", id, valor, cuotas: { matchId: cuota }, expira }

/**
 * La cuota de ahora de una elección en un partido, o null si no vale para retirar (cerrado, sin cuota o vieja). En goles y
 * hándicap, `linea` es la de la apuesta: si el partido tiene ahora otra, su cuota no es comparable.
 */
function cuotaActual(partido, eleccion, ahora = Date.now(), linea = undefined) {
    if (!partido || partido.estado !== "abierto") return null;
    if (!partido.cuotas_ts || ahora - partido.cuotas_ts > CUOTA_MAX_EDAD_MS) return null;
    if (mercados.esMercado(eleccion) && linea !== undefined && (mercados.lineaDe(partido, eleccion) ?? null) !== (linea ?? null))
        return null;
    const columna = ELECCIONES_1X2[eleccion];
    const cuota = columna ? partido[columna] : mercados.esMercado(eleccion) ? mercados.cuotaDe(partido, eleccion) : null;
    return cuota && cuota >= 1 ? Number(cuota) : null;
}

/** El valor de retirada: lo apostado × (cuota original ÷ cuota actual), menos el margen, entero y con tope. */
function valor(cantidad, cuotaOriginal, cuotaAhora) {
    if (!cuotaAhora || cuotaAhora < 1) return 0;
    return Math.min(MAX_VALOR, Math.floor(((cantidad * cuotaOriginal) / cuotaAhora) * (1 - MARGEN_PCT / 100)));
}

const partido = (matchId) => db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(String(matchId));

/** La oferta de una apuesta suelta suya y en juego. @returns {{ ok: true, ... } | { ok: false, motivo: string }} */
function calcularApuesta(userId, apuestaId, ahora = Date.now()) {
    const a = db.prepare("SELECT * FROM apuestas_usuario WHERE id = ? AND user_id = ?").get(Number(apuestaId), String(userId));
    if (!a || a.pagado || a.retirada_en) return { ok: false, motivo: "Esa apuesta ya no está en juego." };
    const p = partido(a.match_id);
    const actual = cuotaActual(p, a.eleccion, ahora, a.linea);
    if (!actual) return { ok: false, motivo: "Ahora no hay cuota para esa apuesta (mercado suspendido o sin actualizar)." };
    const v = valor(a.cantidad, a.cuota, actual);
    if (v <= 0) return { ok: false, motivo: "Ahora mismo esa apuesta no vale nada." };
    return {
        ok: true,
        tipo: "a",
        id: a.id,
        valor: v,
        cuotas: { [a.match_id]: actual },
        apuesta: { ...a, home_team: p.home_team, away_team: p.away_team },
    };
}

/** La oferta de una combinada suya y abierta: todas las patas vivas (pendientes con cuota o ya acertadas). */
function calcularCombinada(userId, combinadaId, ahora = Date.now()) {
    const c = db.prepare("SELECT * FROM combinadas WHERE id = ? AND user_id = ?").get(Number(combinadaId), String(userId));
    if (!c || c.estado !== "abierta") return { ok: false, motivo: "Esa combinada ya no está en juego." };
    const patas = db.prepare("SELECT * FROM combinada_patas WHERE combinada_id = ?").all(c.id);
    if (patas.some((pa) => pa.resultado !== "pendiente" && pa.resultado !== "acierta"))
        return { ok: false, motivo: "Esa combinada ya tiene una pata fallada o anulada: no se puede retirar." };
    const cuotas = {};
    let actualTotal = 1;
    for (const pa of patas.filter((x) => x.resultado === "pendiente")) {
        const actual = cuotaActual(partido(pa.match_id), pa.eleccion, ahora, pa.linea);
        if (!actual) return { ok: false, motivo: "Algún partido de la combinada no tiene cuota ahora (suspendido o sin actualizar)." };
        cuotas[pa.match_id] = actual;
        actualTotal *= actual;
    }
    if (!Object.keys(cuotas).length) return { ok: false, motivo: "Esa combinada ya está decidida: se paga al liquidar." };
    const v = valor(c.cantidad, c.cuota, actualTotal);
    if (v <= 0) return { ok: false, motivo: "Ahora mismo esa combinada no vale nada." };
    return { ok: true, tipo: "c", id: c.id, valor: v, cuotas, combinada: { ...c, patas: patas.length } };
}

const calcular = (userId, tipo, id, ahora) => (tipo === "c" ? calcularCombinada(userId, id, ahora) : calcularApuesta(userId, id, ahora));

/** Lo que se puede retirar ahora: [{ tipo, id, valor, ... }] de sus apuestas y combinadas en juego. */
function retirables(userId, ahora = Date.now()) {
    const sueltas = db
        .prepare(
            `SELECT a.id FROM apuestas_usuario a JOIN apuestas_partidos p ON p.match_id = a.match_id
             WHERE a.user_id = ? AND a.pagado = 0 AND p.estado = 'abierto' ORDER BY p.start_time, a.id`,
        )
        .all(String(userId))
        .map((r) => calcularApuesta(userId, r.id, ahora));
    const combinadas = db
        .prepare("SELECT id FROM combinadas WHERE user_id = ? AND estado = 'abierta' ORDER BY creada_en, id")
        .all(String(userId))
        .map((r) => calcularCombinada(userId, r.id, ahora));
    return [...sueltas, ...combinadas].filter((o) => o.ok);
}

/** Bloquea una oferta 60 segundos. @returns {{ ok: true, token, valor, expira, ... } | { ok: false, motivo }} */
function ofrecer(userId, tipo, id, ahora = Date.now()) {
    for (const [t, o] of ofertas) if (o.expira <= ahora) ofertas.delete(t);
    const o = calcular(userId, tipo, id, ahora);
    if (!o.ok) return o;
    const token = crypto.randomBytes(6).toString("hex");
    const expira = ahora + BLOQUEO_MS;
    ofertas.set(token, { userId: String(userId), tipo, id: o.id, valor: o.valor, cuotas: o.cuotas, expira });
    return { ...o, token, expira };
}

const movida = (antes, ahora) => Math.abs(ahora - antes) / antes > MOVIMIENTO_MAX_PCT / 100;

/** Paga la retirada y marca la apuesta o la combinada en la misma transacción. @returns {object | null} lo retirado */
function cobrar(userId, o, ahora) {
    return db.transaction(() => {
        const marcada =
            o.tipo === "c"
                ? db
                      .prepare(
                          "UPDATE combinadas SET estado = 'retirada', premio = ?, retirada_en = ? WHERE id = ? AND user_id = ? AND estado = 'abierta'",
                      )
                      .run(o.valor, ahora, o.id, String(userId)).changes
                : db
                      .prepare(
                          "UPDATE apuestas_usuario SET pagado = 1, premio = ?, retirada_en = ? WHERE id = ? AND user_id = ? AND pagado = 0 AND retirada_en IS NULL",
                      )
                      .run(o.valor, ahora, o.id, String(userId)).changes;
        if (marcada !== 1) return null;
        dinero.pagar(userId, o.valor);
        dinero.apuntar(userId, "apuestas", o.descripcion, o.valor);
        return o;
    })();
}

/**
 * Confirma una oferta. Si caducó o alguna cuota se movió más de un 10 % (o ya no hay), no cobra y devuelve la oferta nueva
 * (si la hay) para enseñarla. @returns {{ ok: true, valor, mensaje } | { ok: false, motivo, nueva? }}
 */
function confirmar(userId, token, ahora = Date.now()) {
    const o = ofertas.get(token);
    // Antes de gastar el token, que sea suyo: si no, otra persona podría invalidar la oferta de alguien.
    if (!o || o.userId !== String(userId)) return { ok: false, motivo: "Esa oferta ya no vale. Vuelve a pedirla." };
    ofertas.delete(token);
    const ahoraMismo = calcular(userId, o.tipo, o.id, ahora);
    const cambio = !ahoraMismo.ok || Object.entries(o.cuotas).some(([m, c]) => !ahoraMismo.cuotas[m] || movida(c, ahoraMismo.cuotas[m]));
    if (o.expira <= ahora || cambio) {
        const nueva = ahoraMismo.ok ? ofrecer(userId, o.tipo, o.id, ahora) : null;
        const motivo = !ahoraMismo.ok ? ahoraMismo.motivo : o.expira <= ahora ? "La oferta ha caducado (60 s)." : "La cuota se ha movido.";
        return { ok: false, motivo, nueva };
    }
    const descripcion =
        o.tipo === "c"
            ? `Cash-out: combinada de ${ahoraMismo.combinada.patas} partidos`
            : `Cash-out: ${ahoraMismo.apuesta.home_team} vs ${ahoraMismo.apuesta.away_team}`;
    const r = cobrar(userId, { ...o, descripcion }, ahora);
    if (!r) return { ok: false, motivo: "Ya no está en juego: no se ha cobrado nada." };
    log.info(`${userId} retiró ${o.tipo === "c" ? "la combinada" : "la apuesta"} ${o.id} por ${o.valor}`);
    return { ok: true, valor: o.valor, mensaje: `💸 Retirada por **${o.valor.toLocaleString("es")}** 🪙. Ya está en tu efectivo.` };
}

module.exports = {
    MARGEN_PCT,
    MAX_VALOR,
    BLOQUEO_MS,
    MOVIMIENTO_MAX_PCT,
    CUOTA_MAX_EDAD_MS,
    cuotaActual,
    valor,
    retirables,
    ofrecer,
    confirmar,
    _vaciarOfertas: () => ofertas.clear(),
};
