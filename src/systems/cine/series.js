// 🔁 Sesión de cine semanal fija (#403): quien convoca puede repetirla cada semana, el mismo día y a la misma hora. El cron de las
// sesiones de cine (cada 5 minutos) crea la siguiente cuando empieza la anterior, y cada una tiene su recordatorio de 10 minutos
// antes como las demás. Cada ocurrencia tiene su propio mensaje y sus propios apuntados. 🛑 en una sesión de una serie la cancela y
// para la serie: solo se cancela la siguiente, las anteriores se quedan. Un índice único (serie, hora) evita crear dos veces la
// misma ocurrencia aunque el bot se reinicie.
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { momentoMadrid, fechaMadridAMs, sumarDias } = require("../../core/zonaMadrid");

const log = createLogger("Cine");

const serie = (id) =>
    db.prepare("SELECT id, guildId, canalId, organizador, peli, hora, primera, activa FROM cine_series WHERE id = ?").get(Number(id)) ||
    null;

/** Crea una serie semanal cuya primera sesión es `primera` (ms) a las `hora` («HH:MM»). @returns {number} id de la serie */
function crear({ guildId, canalId, organizador, peli, hora, primera }) {
    return Number(
        db
            .prepare("INSERT INTO cine_series (guildId, canalId, organizador, peli, hora, primera, activa) VALUES (?, ?, ?, ?, ?, ?, 1)")
            .run(String(guildId), String(canalId), String(organizador), peli, hora, new Date(primera).toISOString()).lastInsertRowid,
    );
}

/** Para la serie: no se crean más sesiones. */
function parar(id) {
    return db.prepare("UPDATE cine_series SET activa = 0 WHERE id = ? AND activa = 1").run(Number(id)).changes === 1;
}

/** El mismo día de la semana siguiente (o la siguiente que sea futura) a la misma hora de Madrid, en ms. */
function siguienteSemana(inicioMs, hora, ahora) {
    let { dia } = momentoMadrid(inicioMs);
    for (let i = 0; i < 520; i++) {
        dia = sumarDias(dia, 7);
        const [a, m, d] = dia.split("-");
        const ms = fechaMadridAMs(`${d}/${m}/${a} ${hora}`);
        if (ms > ahora) return ms;
    }
    return null;
}

/** La última sesión (por hora) de una serie, o null. */
const ultima = (serieId) =>
    db.prepare("SELECT id, inicio FROM cine_sesiones WHERE serie_id = ? ORDER BY inicio DESC LIMIT 1").get(Number(serieId)) || null;

/**
 * Cron: crea la siguiente sesión de cada serie activa cuando la anterior ya ha empezado, la publica en su canal con `pantalla(id)`
 * y apunta al organizador. `cine` es systems/cine (se pasa para no crear un ciclo).
 * @returns {Promise<number>} sesiones creadas
 */
async function crearSiguientes(client, cine, pantalla, ahora = Date.now()) {
    let creadas = 0;
    for (const { id: serieId } of db.prepare("SELECT id FROM cine_series WHERE activa = 1").all()) {
        const s = serie(serieId);
        const previa = ultima(s.id);
        const primera = new Date(s.primera).getTime();
        let cuando;
        if (!previa) cuando = primera > ahora ? primera : siguienteSemana(primera, s.hora, ahora);
        else if (new Date(previa.inicio).getTime() <= ahora) cuando = siguienteSemana(new Date(previa.inicio).getTime(), s.hora, ahora);
        if (!cuando) continue; // la anterior aún no ha empezado
        try {
            const id = cine.crear({
                guildId: s.guildId,
                canalId: s.canalId,
                organizador: s.organizador,
                peli: s.peli,
                inicio: cuando,
                serieId: s.id,
            });
            if (!id) continue; // esa ocurrencia ya existía
            const canal = await client.channels.fetch(s.canalId);
            const mensaje = await canal.send(pantalla(id));
            cine.guardarMensaje(id, mensaje.id);
            creadas++;
        } catch (e) {
            log.warn(`No se pudo crear la sesión semanal de la serie ${s.id}: ${e.message}`);
        }
    }
    return creadas;
}

module.exports = { serie, crear, parar, siguienteSemana, ultima, crearSiguientes };
