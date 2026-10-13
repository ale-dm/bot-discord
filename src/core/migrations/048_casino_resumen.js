// Resumen del casino por jugador (#484): lo ganado y lo perdido, para que el panel de economía no sume toda la tabla
// `casino` en cada render. Lo mantienen triggers sobre `casino` (insertar, borrar o cambiar una jugada), así que se
// actualiza en la misma transacción que la jugada, pase por donde pase. La migración lo rellena con las jugadas que ya
// existen y se puede repetir: vuelve a dejar los mismos números.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS casino_resumen (
            userId TEXT PRIMARY KEY,
            ganado INTEGER NOT NULL DEFAULT 0,
            perdido INTEGER NOT NULL DEFAULT 0
        );

        DROP TRIGGER IF EXISTS casino_resumen_ins;
        CREATE TRIGGER casino_resumen_ins AFTER INSERT ON casino BEGIN
            INSERT INTO casino_resumen (userId, ganado, perdido)
            VALUES (NEW.userId, MAX(NEW.resultado, 0), MAX(-NEW.resultado, 0))
            ON CONFLICT(userId) DO UPDATE SET
                ganado = ganado + MAX(NEW.resultado, 0),
                perdido = perdido + MAX(-NEW.resultado, 0);
        END;

        DROP TRIGGER IF EXISTS casino_resumen_del;
        CREATE TRIGGER casino_resumen_del AFTER DELETE ON casino BEGIN
            UPDATE casino_resumen
               SET ganado = ganado - MAX(OLD.resultado, 0), perdido = perdido - MAX(-OLD.resultado, 0)
             WHERE userId = OLD.userId;
        END;

        DROP TRIGGER IF EXISTS casino_resumen_upd;
        CREATE TRIGGER casino_resumen_upd AFTER UPDATE OF userId, resultado ON casino BEGIN
            UPDATE casino_resumen
               SET ganado = ganado - MAX(OLD.resultado, 0), perdido = perdido - MAX(-OLD.resultado, 0)
             WHERE userId = OLD.userId;
            INSERT INTO casino_resumen (userId, ganado, perdido)
            VALUES (NEW.userId, MAX(NEW.resultado, 0), MAX(-NEW.resultado, 0))
            ON CONFLICT(userId) DO UPDATE SET
                ganado = ganado + MAX(NEW.resultado, 0),
                perdido = perdido + MAX(-NEW.resultado, 0);
        END;

        INSERT INTO casino_resumen (userId, ganado, perdido)
        SELECT userId,
               COALESCE(SUM(CASE WHEN resultado > 0 THEN resultado ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN resultado < 0 THEN -resultado ELSE 0 END), 0)
        FROM casino GROUP BY userId
        ON CONFLICT(userId) DO UPDATE SET ganado = excluded.ganado, perdido = excluded.perdido;
    `);
}

module.exports = { up };
