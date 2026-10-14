// 🔔 Sonidos ligados a eventos del bot (#326): el admin asocia un sonido a un evento (un logro desbloqueado, una apuesta ganada
// grande) y suena solo, en el canal donde está el bot por /conectar. Si el bot no está en voz o ya suena otro sonido, no pasa nada,
// y un evento no suena más de una vez cada N minutos (ajuste `sonidos.eventos_minutos`).
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const { createLogger } = require("../../core/logger");

const log = createLogger("Sonidos").child("Eventos");

/** Una apuesta ganada con un premio de al menos esto (monedas) dispara el evento `apuesta_grande`. */
const UMBRAL_APUESTA_GRANDE = 1000;

const EVENTOS = {
    logro: "🏆 Logro desbloqueado",
    apuesta_grande: `💰 Apuesta ganada grande (desde ${UMBRAL_APUESTA_GRANDE.toLocaleString("es")} 🪙)`,
};

// Quien toca los sonidos (systems/sonidos y systems/presencia), que se conecta al arrancar (index.js): así los sistemas que
// disparan eventos (logros, apuestas) no dependen del audio ni de la voz.
let reproductor = null;

/** Conecta el reproductor: { sonidos, presencia }. */
function conectar(puerto) {
    reproductor = puerto;
}

/** El sonido de cada evento del servidor: { evento, sonidoId, nombre } (solo los que tienen sonido). */
const asociados = (guildId) =>
    db
        .prepare(
            "SELECT e.evento, e.sonidoId, s.nombre FROM sonidos_eventos e JOIN sonidos s ON s.id = e.sonidoId WHERE e.guildId = ? ORDER BY e.evento",
        )
        .all(String(guildId));

/** Asocia un sonido a un evento (sustituye al que hubiera). @returns {boolean} si el evento existe */
function asociar(guildId, evento, sonidoId) {
    if (!EVENTOS[evento]) return false;
    db.prepare(
        "INSERT INTO sonidos_eventos (guildId, evento, sonidoId, ultimo_en) VALUES (?, ?, ?, 0) ON CONFLICT (guildId, evento) DO UPDATE SET sonidoId = excluded.sonidoId",
    ).run(String(guildId), evento, Number(sonidoId));
    return true;
}

/** Quita el sonido de un evento. @returns {boolean} si había uno */
const quitar = (guildId, evento) =>
    db.prepare("DELETE FROM sonidos_eventos WHERE guildId = ? AND evento = ?").run(String(guildId), evento).changes > 0;

/**
 * Hace sonar el sonido del evento si toca: tiene sonido asociado, no ha sonado hace menos de N minutos, el bot está en voz por
 * /conectar y no suena otro sonido. Nunca lanza: un fallo se queda en el log. `deps` es para los tests.
 * @returns {Promise<boolean>} si se pidió el sonido
 */
async function disparar(guildId, evento, deps = {}) {
    try {
        if (!reproductor) return false;
        const { sonidos, presencia } = reproductor;
        const id = String(guildId);
        const fila = db.prepare("SELECT sonidoId, ultimo_en FROM sonidos_eventos WHERE guildId = ? AND evento = ?").get(id, evento);
        if (!fila) return false;
        const ahora = deps.ahora ?? Date.now();
        const minutos = Math.max(0, Number(guildSettings.getSettings(id).sonidos.eventos_minutos) || 0);
        if (ahora - fila.ultimo_en < minutos * 60 * 1000) return false;
        if (!(deps.presencia !== undefined ? deps.presencia : presencia.actual(id)) || sonidos.sonando(id)) return false;
        const sonido = sonidos.obtener(id, fila.sonidoId);
        if (!sonido) return false;
        db.prepare("UPDATE sonidos_eventos SET ultimo_en = ? WHERE guildId = ? AND evento = ?").run(ahora, id, evento);
        const r = await sonidos.reproducir(id, null, sonido, { ...deps, sinCola: true });
        if (!r.ok) log.debug(`No sonó «${sonido.nombre}» por ${evento} en ${id}: ${r.motivo}`);
        return r.ok;
    } catch (e) {
        log.warn(`No se pudo sonar el evento ${evento} en ${guildId}: ${e.message}`);
        return false;
    }
}

module.exports = { conectar, UMBRAL_APUESTA_GRANDE, EVENTOS, asociados, asociar, quitar, disparar };
