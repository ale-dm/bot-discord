// Sumar XP de pase a alguien, y avisar a quien quiera enterarse cuando sube de nivel (#344). Los avisos van por oyentes que se registran al
// arrancar (index.js), así el pase no depende de Discord.
const db = require("../../core/db");
const { createLogger } = require("../../core/logger");
const { curvaDe } = require("./ajustes");
const { nivelDe } = require("./niveles");

const log = createLogger("Pase");

const oyentes = [];
/** Registra una función que se llama cada vez que alguien sube de nivel: ({ guildId, userId, temporada, nivel, anterior }). */
const alSubirDeNivel = (fn) => void oyentes.push(fn);

/** Suma XP a alguien en una temporada; si con ella sube de nivel, avisa a los oyentes (después de guardar, sin que un fallo suyo afecte al pase). */
function sumarXp(guildId, temporada, userId, xp) {
    const antes =
        db.prepare("SELECT xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND userId = ?").get(guildId, temporada, userId)?.xp ||
        0;
    db.prepare(
        `INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, temporada, userId) DO UPDATE SET xp = xp + excluded.xp`,
    ).run(guildId, temporada, userId, xp);
    const curva = curvaDe(guildId);
    const [anterior, nivel] = [nivelDe(antes, curva), nivelDe(antes + xp, curva)];
    if (nivel <= anterior) return;
    for (const fn of oyentes) {
        try {
            Promise.resolve(fn({ guildId, userId, temporada, nivel, anterior })).catch((e) =>
                log.warn(`Aviso de nivel del pase: ${e.message}`),
            );
        } catch (e) {
            log.warn(`Aviso de nivel del pase: ${e.message}`);
        }
    }
}

module.exports = { sumarXp, alSubirDeNivel };
