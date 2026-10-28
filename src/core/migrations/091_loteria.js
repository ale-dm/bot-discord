// 🎟️ Lotería semanal (#524): un sorteo abierto por servidor con su bote y su fecha (domingo a las 21:00 de Madrid), y los
// boletos de cada persona con sus 4 números y lo que ganaron. Si nadie acierta, el bote pasa al sorteo siguiente. Ver
// systems/loteria.js.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS loteria_sorteos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'abierto',
            bote INTEGER NOT NULL DEFAULT 0,
            arrastre INTEGER NOT NULL DEFAULT 0,
            aportacion INTEGER NOT NULL DEFAULT 0,
            combinacion TEXT,
            sorteo_en INTEGER NOT NULL,
            abierto_en INTEGER NOT NULL,
            sorteado_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_loteria_sorteos_estado ON loteria_sorteos(estado, sorteo_en);
        CREATE INDEX IF NOT EXISTS idx_loteria_sorteos_guild ON loteria_sorteos(guildId, estado);
        CREATE TABLE IF NOT EXISTS loteria_boletos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sorteo_id INTEGER NOT NULL REFERENCES loteria_sorteos(id),
            userId TEXT NOT NULL,
            numeros TEXT NOT NULL,
            precio INTEGER NOT NULL,
            comprado_en INTEGER NOT NULL,
            premio INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_loteria_boletos_sorteo ON loteria_boletos(sorteo_id, userId);
    `);
}

module.exports = { up };
