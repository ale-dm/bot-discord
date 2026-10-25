// 🗳️ Elecciones a la presidencia del servidor: la elección y su fase (inscripción → primarias → programas → generales →
// mandato), los candidatos con su programa, un voto por persona y fase (secreto o público), y lo que hace el presidente
// durante el mandato: los canales que crea, los silencios y sorderas que hay que revertir y el registro de sus acciones.
// Ver systems/elecciones/.
const ELECCIONES = `
        CREATE TABLE IF NOT EXISTS elecciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'inscripcion',
            creada_por TEXT NOT NULL,
            creada_en INTEGER NOT NULL,
            fase_inicio INTEGER NOT NULL,
            fase_fin INTEGER NOT NULL,
            channelId TEXT,
            messageId TEXT,
            presidenteId TEXT,
            cerrada_en INTEGER,
            motivo_cierre TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_elecciones_estado ON elecciones(estado, fase_fin);
        CREATE INDEX IF NOT EXISTS idx_elecciones_guild ON elecciones(guildId, estado);
        CREATE TABLE IF NOT EXISTS elecciones_candidatos (
            eleccion_id INTEGER NOT NULL REFERENCES elecciones(id),
            userId TEXT NOT NULL,
            inscrito_en INTEGER NOT NULL,
            finalista INTEGER NOT NULL DEFAULT 0,
            retirado INTEGER NOT NULL DEFAULT 0,
            programa_titulo TEXT,
            programa_texto TEXT,
            programa_en INTEGER,
            PRIMARY KEY (eleccion_id, userId)
        );
        CREATE TABLE IF NOT EXISTS elecciones_votos (
            eleccion_id INTEGER NOT NULL REFERENCES elecciones(id),
            fase TEXT NOT NULL,
            votanteId TEXT NOT NULL,
            candidatoId TEXT NOT NULL,
            publico INTEGER NOT NULL DEFAULT 0,
            votado_en INTEGER NOT NULL,
            PRIMARY KEY (eleccion_id, fase, votanteId)
        );
        CREATE INDEX IF NOT EXISTS idx_elecciones_votos_candidato ON elecciones_votos(eleccion_id, fase, candidatoId);
`;

const PRESIDENCIA = `
        CREATE TABLE IF NOT EXISTS presidencia_canales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            eleccion_id INTEGER NOT NULL REFERENCES elecciones(id),
            guildId TEXT NOT NULL,
            channelId TEXT NOT NULL,
            creado_en INTEGER NOT NULL,
            borrado_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_presidencia_canales_eleccion ON presidencia_canales(eleccion_id, borrado_en);
        CREATE TABLE IF NOT EXISTS presidencia_sanciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            eleccion_id INTEGER NOT NULL REFERENCES elecciones(id),
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            tipo TEXT NOT NULL,
            inicio INTEGER NOT NULL,
            fin INTEGER NOT NULL,
            revertida_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_presidencia_sanciones_fin ON presidencia_sanciones(revertida_en, fin);
        CREATE TABLE IF NOT EXISTS presidencia_acciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            eleccion_id INTEGER NOT NULL REFERENCES elecciones(id),
            guildId TEXT NOT NULL,
            presidenteId TEXT NOT NULL,
            accion TEXT NOT NULL,
            objetivoId TEXT,
            creada_en INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_presidencia_acciones_objetivo ON presidencia_acciones(eleccion_id, objetivoId, creada_en);
`;

function up(db) {
    db.exec(ELECCIONES);
    db.exec(PRESIDENCIA);
}

module.exports = { up };
