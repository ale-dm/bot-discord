// Registro persistente de partidas de casino en curso.
// El estado de juego (cartas, rondas...) vive en memoria, pero el dinero ya cobrado
// se apunta aquí: si el bot se reinicia a mitad de partida, al arrancar se devuelve
// lo apostado en vez de perderse sin más.
const db = require("../core/db");
const { createLogger } = require("../core/logger");

const log = createLogger("Casino");

// Tras este tiempo sin tocar la partida se da por abandonada (el token de una
// interacción de Discord caduca a los 15 min, así que los botones ya no funcionarían).
const ABANDON_MS = 15 * 60 * 1000;

function registrar(userId, juego, guildId, apuesta) {
    db.prepare(
        `
        INSERT INTO casino_partidas_activas (userId, juego, guildId, apuesta, creada_en)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(userId, juego) DO UPDATE SET
            guildId = excluded.guildId, apuesta = excluded.apuesta, creada_en = excluded.creada_en
    `,
    ).run(userId, juego, guildId || null, apuesta, Date.now());
}

function sumarApuesta(userId, juego, extra) {
    db.prepare("UPDATE casino_partidas_activas SET apuesta = apuesta + ? WHERE userId = ? AND juego = ?").run(extra, userId, juego);
}

function cerrar(userId, juego) {
    db.prepare("DELETE FROM casino_partidas_activas WHERE userId = ? AND juego = ?").run(userId, juego);
}

function estaAbandonada(ultimaAccionTs) {
    return Date.now() - Number(ultimaAccionTs || 0) > ABANDON_MS;
}

/**
 * Devuelve lo apostado en todas las partidas registradas. Pensado para llamarse al
 * arrancar, antes de aceptar interacciones: en ese momento cualquier fila que quede
 * es de una partida cuyo estado en memoria se perdió con el reinicio.
 * @returns {number} partidas reembolsadas
 */
function reembolsarPendientes() {
    const filas = db.prepare("SELECT * FROM casino_partidas_activas").all();
    if (!filas.length) return 0;
    const tx = db.transaction(() => {
        for (const f of filas) {
            db.prepare("UPDATE banco SET saldo = saldo + ? WHERE userId = ?").run(f.apuesta, f.userId);
            db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad) VALUES (?, ?, ?, ?)").run(
                f.userId,
                new Date().toISOString(),
                `Reembolso: partida de ${f.juego} interrumpida por reinicio`,
                f.apuesta,
            );
            db.prepare("DELETE FROM casino_partidas_activas WHERE userId = ? AND juego = ?").run(f.userId, f.juego);
        }
    });
    try {
        tx();
        for (const f of filas) log.info(`Reembolsadas ${f.apuesta} monedas a ${f.userId} (partida de ${f.juego} interrumpida)`);
        return filas.length;
    } catch (e) {
        log.error("Error reembolsando partidas interrumpidas:", e);
        return 0;
    }
}

module.exports = {
    ABANDON_MS,
    registrar,
    sumarApuesta,
    cerrar,
    estaAbandonada,
    reembolsarPendientes,
};
