// 🛠️ Administración, fase 12:
// - tareas_ejecuciones (#420): la última ejecución de cada tarea programada (cuándo, cuánto tardó, si fue bien o el error).
// - mensajes_programados (#424): los /mensaje con fecha y hora, hasta que salen o se cancelan. El texto se borra al enviarse
//   o cancelarse (la auditoría nunca lo guarda).
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tareas_ejecuciones (
            nombre TEXT PRIMARY KEY,
            inicio INTEGER NOT NULL,
            ms INTEGER NOT NULL,
            ok INTEGER NOT NULL,
            error TEXT
        );
        CREATE TABLE IF NOT EXISTS mensajes_programados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            autorId TEXT NOT NULL,
            destinoId TEXT NOT NULL,
            destinoNombre TEXT,
            texto TEXT,
            enviar_en INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            creado_en INTEGER NOT NULL,
            cerrado_en INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mensajes_programados_estado ON mensajes_programados(estado, enviar_en);
    `);
}

module.exports = { up };
