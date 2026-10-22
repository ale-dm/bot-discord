// Seguro antirrobo (#526): suscripción por persona, global como el dinero (sin guildId). Guarda cuándo se
// compró (para el cooldown), cuándo empezó y cuándo vence. No se acumula: renovar mueve el vencimiento,
// con un tope de días por delante que se controla en systems/seguroAntirrobo.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS seguros_antirrobo (
            userId TEXT PRIMARY KEY,
            inicio INTEGER NOT NULL,
            vencimiento INTEGER NOT NULL,
            comprado INTEGER NOT NULL
        )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_seguros_vencimiento ON seguros_antirrobo (vencimiento)");
}

module.exports = { up };
