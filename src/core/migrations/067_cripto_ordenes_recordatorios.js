// 📈 Cripto y recordatorios, fase 9:
// - cripto_ordenes (#298, #341, #351): alertas de precio, stop-loss y compras recurrentes de TTCL. `tipo`: alerta | stoploss |
//   recurrente. `precio` es el umbral (alerta y stop-loss; `sobre` = 1 si la alerta salta al subir hasta él). `monedas` y
//   `periodo_min` son de la compra recurrente, y `proxima` cuándo toca (ms). `estado`: activa | ejecutada | cancelada.
// - recordatorios_personales (#320): los avisos que cada persona se deja con /recordar.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cripto_ordenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            guildId TEXT NOT NULL,
            tipo TEXT NOT NULL,
            precio REAL,
            sobre INTEGER NOT NULL DEFAULT 0,
            monedas INTEGER,
            periodo_min INTEGER,
            proxima INTEGER,
            estado TEXT NOT NULL DEFAULT 'activa',
            creada INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cripto_ordenes_estado ON cripto_ordenes(estado, tipo);
        CREATE INDEX IF NOT EXISTS idx_cripto_ordenes_user ON cripto_ordenes(userId, estado);
        CREATE TABLE IF NOT EXISTS recordatorios_personales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            texto TEXT NOT NULL,
            cuando INTEGER NOT NULL,
            enviado INTEGER NOT NULL DEFAULT 0,
            creado INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recordatorios_pendientes ON recordatorios_personales(enviado, cuando);
    `);
}

module.exports = { up };
