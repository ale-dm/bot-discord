// Combinadas (#1): un boleto con varios partidos (de 2 a 5), con la cuota de cada pata. Ver systems/apuestas/combinadas.js.
// combinadas: el boleto (importe, cuota total, estado y premio). combinada_patas: cada partido del boleto, con su elección
// y cómo ha quedado. combinada_borrador: lo que cada uno va sumando antes de apostar (privado).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS combinadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            cuota REAL NOT NULL,
            estado TEXT NOT NULL DEFAULT 'abierta',
            premio INTEGER,
            creada_en TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS combinada_patas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            combinada_id INTEGER NOT NULL,
            match_id TEXT NOT NULL,
            eleccion TEXT NOT NULL,
            cuota REAL NOT NULL,
            linea REAL,
            resultado TEXT NOT NULL DEFAULT 'pendiente',
            FOREIGN KEY(combinada_id) REFERENCES combinadas(id)
        );
        CREATE INDEX IF NOT EXISTS idx_combinada_patas_partido ON combinada_patas (match_id, resultado);
        CREATE TABLE IF NOT EXISTS combinada_borrador (
            user_id TEXT NOT NULL,
            match_id TEXT NOT NULL,
            eleccion TEXT NOT NULL,
            cuota REAL NOT NULL,
            linea REAL,
            PRIMARY KEY (user_id, match_id)
        );
    `);
}

module.exports = { up };
