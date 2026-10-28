// 🔨 Casa de subastas de objetos (#519): la subasta (objeto retenido, precio de salida, incremento mínimo, cierre con su
// tope de prórroga por anti-sniping y el resultado) y sus pujas, con el dinero retenido hasta que alguien la supera. Ver
// systems/subastas.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS subastas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            vendedor TEXT NOT NULL,
            objetoId INTEGER NOT NULL,
            precio_inicial INTEGER NOT NULL,
            incremento INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'abierta',
            creada INTEGER NOT NULL,
            cierra INTEGER NOT NULL,
            cierre_original INTEGER NOT NULL,
            ganador TEXT,
            precio_final INTEGER,
            comision INTEGER,
            cerrada_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_subastas_estado ON subastas(estado, cierra);
        CREATE INDEX IF NOT EXISTS idx_subastas_vendedor ON subastas(vendedor, estado);
        CREATE TABLE IF NOT EXISTS subasta_pujas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subasta_id INTEGER NOT NULL REFERENCES subastas(id),
            userId TEXT NOT NULL,
            cantidad INTEGER NOT NULL,
            creada INTEGER NOT NULL,
            devuelta INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_subasta_pujas_subasta ON subasta_pujas(subasta_id, cantidad);
        CREATE INDEX IF NOT EXISTS idx_subasta_pujas_usuario ON subasta_pujas(userId, devuelta);
    `);
}

module.exports = { up };
