// ⭐ Equipos favoritos y aviso de partidos (#530):
// - equipos_favoritos: los equipos que sigue cada persona (global, como las apuestas). `equipo_key` es el nombre
//   normalizado para comparar sin mayúsculas, tildes ni signos; `equipo` guarda el nombre tal y como lo da la API.
// - equipos_favoritos_avisos: los partidos de equipos seguidos de los que ya se ha avisado por DM, para avisar una
//   sola vez por partido y persona aunque falle el envío o el bot se reinicie.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS equipos_favoritos (
            userId TEXT NOT NULL,
            equipo_key TEXT NOT NULL,
            equipo TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            PRIMARY KEY (userId, equipo_key)
        );
        CREATE INDEX IF NOT EXISTS idx_equipos_favoritos_key ON equipos_favoritos(equipo_key);
        CREATE TABLE IF NOT EXISTS equipos_favoritos_avisos (
            userId TEXT NOT NULL,
            match_id TEXT NOT NULL,
            avisado_en INTEGER NOT NULL,
            PRIMARY KEY (userId, match_id)
        );
    `);
}

module.exports = { up };
