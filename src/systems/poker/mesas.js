// 🃏 Las mesas de póker y el dinero (#531): abrir una mesa pública en un canal, sentarse comprando fichas con efectivo (de 10 a
// 100 ciegas grandes: 1.000 a 10.000 con ciegas fijas de 50/100), levantarse cobrando las fichas, guardar las fichas al
// acabar cada mano y las estadísticas, y cerrar la mesa devolviendo todo. El dinero solo entra al sentarse y sale al
// levantarse o al cerrar: dentro de la mesa se juega con fichas. Sin rake. Si al arrancar el bot queda alguna mesa abierta
// (un reinicio la cortó), se cierra devolviendo a cada uno las fichas que tenía al empezar la mano. Sin Discord.
const db = require("../../core/db");
const dinero = require("../dinero");
const autoexclusion = require("../casinoAutoexclusion");
const { fmtNumero } = require("../../core/formato");

const CIEGAS = { sb: 50, bb: 100 };
const COMPRA_MIN = 10 * CIEGAS.bb;
const COMPRA_MAX = 100 * CIEGAS.bb;
const MIN_JUGADORES = 2;
const MAX_JUGADORES = 6;
const ESPERA_MS = 2 * 60 * 1000;
const TIEMPOS_FUERA = 3;
const INACTIVA_MS = 10 * 60 * 1000;

const error = (motivo) => ({ ok: false, motivo });

const obtener = (id) => db.prepare("SELECT * FROM poker_mesas WHERE id = ?").get(Number(id)) || null;
const asientos = (mesaId) => db.prepare("SELECT * FROM poker_asientos WHERE mesa_id = ? ORDER BY sentado_en, userId").all(Number(mesaId));
const asiento = (mesaId, userId) =>
    db.prepare("SELECT * FROM poker_asientos WHERE mesa_id = ? AND userId = ?").get(Number(mesaId), String(userId)) || null;

/** La mesa abierta del servidor (una a la vez), o null. */
const activa = (guildId) =>
    db
        .prepare("SELECT * FROM poker_mesas WHERE guildId = ? AND estado IN ('esperando', 'jugando') ORDER BY id DESC LIMIT 1")
        .get(String(guildId)) || null;

/** Se sienta comprando `compra` fichas con efectivo. */
function sentarse(mesaId, userId, compra, ahora = Date.now()) {
    const bloqueo = autoexclusion.mensajeBloqueo(userId, ahora);
    if (bloqueo) return error(String(bloqueo).replace(/^❌\s*/, ""));
    if (!Number.isInteger(compra) || compra < COMPRA_MIN || compra > COMPRA_MAX) {
        return error(`Te sientas con de ${fmtNumero(COMPRA_MIN)} a ${fmtNumero(COMPRA_MAX)} fichas (ciegas de ${CIEGAS.sb}/${CIEGAS.bb}).`);
    }
    return db.transaction(() => {
        const m = obtener(mesaId);
        if (!m || m.estado === "cerrada") return error("Esta mesa ya está cerrada.");
        if (asiento(m.id, userId)) return error("Ya estás sentado.");
        if (asientos(m.id).length >= MAX_JUGADORES) return error(`La mesa está llena (${MAX_JUGADORES}).`);
        if (!dinero.cobrar(userId, compra)) return error("No te llega el efectivo para esas fichas.");
        dinero.apuntar(userId, "casino", `Póker: fichas en la mesa #${m.id}`, -compra);
        db.prepare("INSERT INTO poker_asientos (mesa_id, userId, fichas, compra, sentado_en) VALUES (?, ?, ?, ?, ?)").run(
            m.id,
            String(userId),
            compra,
            compra,
            ahora,
        );
        return { ok: true, mesa: obtener(m.id) };
    })();
}

/** Abre una mesa en un canal y sienta a quien la abre. */
function abrir({ guildId, channelId, userId, compra }, ahora = Date.now()) {
    if (activa(guildId)) return error("Ya hay una mesa de póker abierta en este servidor.");
    const { lastInsertRowid } = db
        .prepare("INSERT INTO poker_mesas (guildId, channelId, abierta_por, creada, cierra_espera) VALUES (?, ?, ?, ?, ?)")
        .run(String(guildId), channelId, String(userId), ahora, ahora + ESPERA_MS);
    const r = sentarse(lastInsertRowid, userId, compra, ahora);
    if (!r.ok) {
        db.prepare("DELETE FROM poker_mesas WHERE id = ?").run(lastInsertRowid);
        return r;
    }
    return { ok: true, mesa: obtener(lastInsertRowid) };
}

function guardarMensaje(id, messageId) {
    db.prepare("UPDATE poker_mesas SET messageId = ? WHERE id = ?").run(messageId, Number(id));
}

/** Paga sus fichas a un asiento y lo quita. */
function cobrarAsiento(mesaId, a, motivo) {
    if (a.fichas > 0) {
        dinero.pagar(a.userId, a.fichas);
        dinero.apuntar(a.userId, "casino", `Póker: ${motivo} (mesa #${mesaId})`, a.fichas);
    }
    db.prepare("DELETE FROM poker_asientos WHERE mesa_id = ? AND userId = ?").run(Number(mesaId), a.userId);
}

/** Se levanta y cobra sus fichas (entre manos; durante una mano lo decide quien llama). */
function levantarse(mesaId, userId) {
    return db.transaction(() => {
        const a = asiento(mesaId, userId);
        if (!a) return error("No estás sentado en esta mesa.");
        cobrarAsiento(mesaId, a, "te levantas de la mesa");
        return { ok: true, fichas: a.fichas, quedan: asientos(mesaId).length };
    })();
}

/** Cierra la mesa devolviendo las fichas a todos. */
function cerrar(mesaId, motivo = "mesa cerrada", ahora = Date.now()) {
    return db.transaction(() => {
        const m = obtener(mesaId);
        if (!m || m.estado === "cerrada") return null;
        for (const a of asientos(m.id)) cobrarAsiento(m.id, a, motivo);
        db.prepare("UPDATE poker_mesas SET estado = 'cerrada', cerrada_en = ? WHERE id = ?").run(ahora, m.id);
        return obtener(m.id);
    })();
}

/** Quienes juegan la siguiente mano: sentados, dentro y con fichas para la ciega grande. */
const jugadoresDeMano = (mesaId) => asientos(mesaId).filter((a) => !a.fuera && a.fichas >= CIEGAS.bb);

/** Marca la mesa como jugando y mueve el botón. @returns {number} el índice del botón entre los que juegan */
function empezarMano(mesaId, numeroJugadores) {
    const m = obtener(mesaId);
    const boton = m.manos === 0 ? 0 : (m.boton + 1) % numeroJugadores;
    db.prepare("UPDATE poker_mesas SET estado = 'jugando', boton = ?, manos = manos + 1 WHERE id = ?").run(boton, m.id);
    return boton;
}

/**
 * Guarda las fichas de cada uno al terminar la mano, los tiempos agotados (3 seguidos dejan al jugador sentado fuera) y las
 * estadísticas. `jugadores`: [{ userId, fichas, ganado, agotoTiempo }].
 */
function guardarMano(mesaId, jugadores, ahora = Date.now()) {
    db.transaction(() => {
        for (const j of jugadores) {
            const a = asiento(mesaId, j.userId);
            if (!a) continue;
            const tiempos = j.agotoTiempo ? a.tiempos + 1 : 0;
            db.prepare("UPDATE poker_asientos SET fichas = ?, tiempos = ?, fuera = ? WHERE mesa_id = ? AND userId = ?").run(
                j.fichas,
                tiempos,
                tiempos >= TIEMPOS_FUERA ? 1 : a.fuera,
                Number(mesaId),
                j.userId,
            );
            db.prepare(
                `INSERT INTO poker_stats (userId, manos, ganadas, fichas_ganadas) VALUES (?, 1, ?, ?)
                 ON CONFLICT(userId) DO UPDATE SET manos = manos + 1, ganadas = ganadas + excluded.ganadas, fichas_ganadas = fichas_ganadas + excluded.fichas_ganadas`,
            ).run(j.userId, j.ganado > 0 ? 1 : 0, Math.max(0, j.ganado));
        }
        // Si en 10 minutos no se juega otra mano (no quedan 2 con fichas), el cron cierra la mesa y devuelve las fichas.
        db.prepare("UPDATE poker_mesas SET estado = 'esperando', cierra_espera = ? WHERE id = ? AND estado = 'jugando'").run(
            ahora + INACTIVA_MS,
            Number(mesaId),
        );
    })();
}

/** Vuelve a la mesa quien estaba sentado fuera. */
function volver(mesaId, userId) {
    const r = db
        .prepare("UPDATE poker_asientos SET fuera = 0, tiempos = 0 WHERE mesa_id = ? AND userId = ?")
        .run(Number(mesaId), String(userId));
    return r.changes === 1;
}

const stats = (userId) =>
    db.prepare("SELECT * FROM poker_stats WHERE userId = ?").get(String(userId)) || { manos: 0, ganadas: 0, fichas_ganadas: 0 };

/** Las mesas sin mano en juego que han agotado su espera (la inicial, o 10 minutos sin otra mano). */
const esperasVencidas = (ahora = Date.now()) =>
    db.prepare("SELECT id FROM poker_mesas WHERE estado = 'esperando' AND cierra_espera <= ?").pluck().all(ahora);

/** Al arrancar: cierra las mesas que quedaron abiertas, devolviendo las fichas (las de antes de la mano cortada). */
function cerrarHuerfanas(ahora = Date.now()) {
    const ids = db.prepare("SELECT id FROM poker_mesas WHERE estado IN ('esperando', 'jugando')").pluck().all();
    for (const id of ids) cerrar(id, "mesa cerrada por un reinicio", ahora);
    return ids.length;
}

module.exports = {
    CIEGAS,
    COMPRA_MIN,
    COMPRA_MAX,
    MIN_JUGADORES,
    MAX_JUGADORES,
    ESPERA_MS,
    TIEMPOS_FUERA,
    obtener,
    asientos,
    asiento,
    activa,
    abrir,
    sentarse,
    guardarMensaje,
    levantarse,
    cerrar,
    jugadoresDeMano,
    empezarMano,
    guardarMano,
    volver,
    stats,
    esperasVencidas,
    cerrarHuerfanas,
};
