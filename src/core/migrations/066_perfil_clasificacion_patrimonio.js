// 👤 Perfil, clasificación y patrimonio, fase 8:
// - clasificacion_historial (#360): el ganador de cada categoría de cada semana (`semana` = el lunes, «AAAA-MM-DD»).
// - clasificacion_aviso (#394): quién quiere el aviso del domingo (opt-in) y la última semana en que se le avisó.
// - patrimonio_diario (#388): efectivo + banco de cada persona al empezar cada día (hora de Madrid); se guardan 35 días.
// - economia_privada (#377): quien tiene una fila oculta su economía a los demás.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS clasificacion_historial (
            guildId TEXT NOT NULL,
            semana TEXT NOT NULL,
            categoria TEXT NOT NULL,
            userId TEXT NOT NULL,
            valor REAL NOT NULL,
            PRIMARY KEY (guildId, semana, categoria)
        );
        CREATE TABLE IF NOT EXISTS clasificacion_aviso (
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            activo INTEGER NOT NULL DEFAULT 0,
            ultima_semana TEXT,
            PRIMARY KEY (guildId, userId)
        );
        CREATE TABLE IF NOT EXISTS patrimonio_diario (
            userId TEXT NOT NULL,
            dia TEXT NOT NULL,
            total INTEGER NOT NULL,
            PRIMARY KEY (userId, dia)
        );
        CREATE TABLE IF NOT EXISTS economia_privada (
            userId TEXT PRIMARY KEY
        );
    `);
}

module.exports = { up };
