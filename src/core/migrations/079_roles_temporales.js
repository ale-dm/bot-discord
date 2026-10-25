// ⏳ Roles temporales (#543): un admin da un rol con caducidad y el bot lo quita al vencer (también tras un reinicio). Cada
// fila es una asignación: activa hasta que vence, se quita antes de tiempo o se cancela porque el rol ya no existe. Se
// guarda el id del rol, así que renombrarlo no afecta. Fechas en ms.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS roles_temporales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId TEXT NOT NULL,
            userId TEXT NOT NULL,
            roleId TEXT NOT NULL,
            asignadoPor TEXT NOT NULL,
            inicio INTEGER NOT NULL,
            vence INTEGER NOT NULL,
            avisar INTEGER NOT NULL DEFAULT 1,
            estado TEXT NOT NULL DEFAULT 'activo',  -- activo | vencido | quitado | cancelado
            terminadoEn INTEGER,
            terminadoPor TEXT
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_roles_temporales_vence ON roles_temporales (estado, vence)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_roles_temporales_guild ON roles_temporales (guildId, estado, vence)");
}

module.exports = { up };
