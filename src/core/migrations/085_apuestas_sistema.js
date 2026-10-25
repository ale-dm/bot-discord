// 🎛️ Apuestas de sistema (#534): combinadas parciales («2 de 3», «3 de 4», «3 de 5») que pagan cada subcombinación acertada.
// `sistemas` es la jugada (tamaño, importe por combinación, coste total, estado y premio), `sistema_patas` cada partido con
// su elección y cuota, y `sistema_combinaciones` cada subcombinación (los índices de sus patas, su cuota y lo que cobró).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sistemas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            k INTEGER NOT NULL,                       -- patas de cada combinación
            m INTEGER NOT NULL,                       -- patas del sistema
            cantidad INTEGER NOT NULL,                -- importe por combinación
            combinaciones INTEGER NOT NULL,
            coste INTEGER NOT NULL,                   -- cantidad × combinaciones, lo que se cobró
            estado TEXT NOT NULL DEFAULT 'abierta',   -- abierta | resuelta | reembolsada
            premio INTEGER,
            creada_en TEXT NOT NULL,
            resuelta_en TEXT
        );
        CREATE TABLE IF NOT EXISTS sistema_patas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sistema_id INTEGER NOT NULL,
            orden INTEGER NOT NULL,
            match_id TEXT NOT NULL,
            eleccion TEXT NOT NULL,
            cuota REAL NOT NULL,
            linea REAL,
            resultado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | acierta | falla | anulada
            FOREIGN KEY(sistema_id) REFERENCES sistemas(id)
        );
        CREATE TABLE IF NOT EXISTS sistema_combinaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sistema_id INTEGER NOT NULL,
            indices TEXT NOT NULL,                    -- órdenes de sus patas: "0,2"
            cuota REAL NOT NULL,
            premio INTEGER,
            FOREIGN KEY(sistema_id) REFERENCES sistemas(id)
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_sistema_patas_partido ON sistema_patas (match_id, resultado)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sistemas_usuario ON sistemas (user_id, estado)");
}

module.exports = { up };
