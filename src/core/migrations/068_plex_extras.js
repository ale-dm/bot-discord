// 🍿 Plex, fase 10:
// - plex_wrapped_anual_enviados (#381): a quién se le mandó ya el Wrapped del año (una vez por persona y año).
// - plex_ranking_campeones (#389): el campeón de cada semana del ranking semanal de Plex (una fila por semana y servidor).
// - cine_opciones / cine_votos (#393): las películas propuestas para una sesión y quién vota cada una (votar varias es posible).
// - cine_series (#403): una sesión de cine que se repite cada semana; cine_sesiones.serie_id enlaza cada ocurrencia, y no puede
//   haber dos ocurrencias de la misma serie a la misma hora (así un reinicio no crea la misma dos veces).
const { addColumnIfMissing } = require("./index");

function up(db) {
    addColumnIfMissing(db, "cine_sesiones", "serie_id", "INTEGER");
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cine_sesiones_serie ON cine_sesiones(serie_id, inicio) WHERE serie_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS plex_wrapped_anual_enviados (
            guildId TEXT NOT NULL,
            tautulliUserId TEXT NOT NULL,
            anio TEXT NOT NULL,
            enviado_en INTEGER NOT NULL,
            PRIMARY KEY (guildId, tautulliUserId, anio)
        );
        CREATE TABLE IF NOT EXISTS plex_ranking_campeones (
            guildId TEXT NOT NULL,
            semana TEXT NOT NULL,
            discordUserId TEXT NOT NULL,
            plexUsername TEXT,
            segundos INTEGER NOT NULL,
            PRIMARY KEY (guildId, semana)
        );
        CREATE TABLE IF NOT EXISTS cine_opciones (
            sesion_id INTEGER NOT NULL,
            idx INTEGER NOT NULL,
            titulo TEXT NOT NULL,
            PRIMARY KEY (sesion_id, idx)
        );
        CREATE TABLE IF NOT EXISTS cine_votos (
            sesion_id INTEGER NOT NULL,
            idx INTEGER NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (sesion_id, idx, userId)
        );
        CREATE TABLE IF NOT EXISTS cine_series (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            canalId TEXT NOT NULL,
            organizador TEXT NOT NULL,
            peli TEXT NOT NULL,
            hora TEXT NOT NULL,
            primera TEXT NOT NULL,
            activa INTEGER NOT NULL DEFAULT 1
        );
    `);
}

module.exports = { up };
