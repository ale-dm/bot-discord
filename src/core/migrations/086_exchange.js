// 🔁 Exchange de apuestas entre jugadores (#533): `exchange_ordenes` son las órdenes «a favor» (back) que se publican en el libro
// de un partido, con cuánto se ha casado y cuánto se ha devuelto; `exchange_cruces` son los cruces con quien va en contra, con
// la garantía de cada parte (la apuesta y el riesgo), y cómo se liquidaron (ganador, comisión y pago). Fechas en ms.
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_ordenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            match_id TEXT NOT NULL,
            eleccion TEXT NOT NULL,                 -- home | draw | away
            cuota REAL NOT NULL,
            cantidad INTEGER NOT NULL,              -- lo apostado (retenido al publicar)
            casado INTEGER NOT NULL DEFAULT 0,      -- lo ya cruzado con otros
            devuelto INTEGER NOT NULL DEFAULT 0,    -- lo no cruzado que se devolvió (cancelar o empezar el partido)
            estado TEXT NOT NULL DEFAULT 'abierta', -- abierta | parcial | casada | cancelada | liquidada
            creada_en INTEGER NOT NULL,
            cerrada_en INTEGER
        );
        CREATE TABLE IF NOT EXISTS exchange_cruces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orden_id INTEGER NOT NULL,
            contraparte_id TEXT NOT NULL,           -- quien va en contra (lay)
            cantidad INTEGER NOT NULL,              -- parte de la orden cruzada
            cuota REAL NOT NULL,
            riesgo INTEGER NOT NULL,                -- lo que retiene la contraparte: cantidad × (cuota − 1)
            estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | liquidado | anulado
            ganador_id TEXT,
            comision INTEGER,
            pago INTEGER,
            creado_en INTEGER NOT NULL,
            liquidado_en INTEGER,
            FOREIGN KEY(orden_id) REFERENCES exchange_ordenes(id)
        );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_exchange_libro ON exchange_ordenes (match_id, eleccion, estado, cuota, creada_en)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exchange_ordenes_usuario ON exchange_ordenes (user_id, estado)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exchange_cruces_orden ON exchange_cruces (orden_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exchange_cruces_contraparte ON exchange_cruces (contraparte_id, estado)");
}

module.exports = { up };
