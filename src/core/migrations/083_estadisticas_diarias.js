// 📊 Estadísticas del servidor (#538): mensajes y XP por día (hora de Madrid) para las gráficas de 7, 30 y 90 días. El bot no
// guardaba los mensajes y `xp_diaria` se borra a las dos semanas, así que se cuentan aquí desde ahora; la XP arranca con lo que
// aún queda en `xp_diaria`. El índice de `historial.fecha` es para las gráficas de economía y apuestas por rango de fechas.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS estadisticas_diarias (
            guildId TEXT NOT NULL,
            dia TEXT NOT NULL,          -- AAAA-MM-DD, hora de Madrid
            metrica TEXT NOT NULL,      -- mensajes | xp
            valor INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guildId, metrica, dia)
        );
        INSERT OR IGNORE INTO estadisticas_diarias (guildId, dia, metrica, valor)
            SELECT guildId, dia, 'xp', SUM(xp) FROM xp_diaria GROUP BY guildId, dia;
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial (fecha)");
}

module.exports = { up };
