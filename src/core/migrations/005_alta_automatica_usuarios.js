// banco, historial, inventario y casino tienen una clave foránea a usuarios(id), y
// better-sqlite3 activa las claves foráneas por defecto. Así que crear la cuenta de banco de
// alguien que aún no estaba en `usuarios` fallaba ("FOREIGN KEY constraint failed"): por
// ejemplo, alguien nuevo que consultaba su saldo al Duende o usaba la cripto sin haber jugado
// antes al casino veía 0 monedas en vez de 1.000.
//
// En vez de parchear los ~30 sitios que insertan en esas tablas, un trigger da de alta al
// usuario justo antes de cada inserción (se ejecuta antes de que SQLite compruebe la clave).
const TABLAS = ["banco", "historial", "inventario", "casino"];

function up(db, { log }) {
    for (const t of TABLAS) {
        db.exec(`
            CREATE TRIGGER IF NOT EXISTS alta_usuario_${t} BEFORE INSERT ON ${t}
            BEGIN
                INSERT OR IGNORE INTO usuarios (id, fechaRegistro) VALUES (NEW.userId, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            END;
        `);
    }

    // Filas que ya existían sin su usuario (de antes de que se aplicara la clave foránea).
    let reparadas = 0;
    for (const t of TABLAS) {
        reparadas += db
            .prepare(
                `
            INSERT OR IGNORE INTO usuarios (id, fechaRegistro)
            SELECT DISTINCT userId, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM ${t}
            WHERE userId NOT IN (SELECT id FROM usuarios)
        `,
            )
            .run().changes;
    }
    if (reparadas) log.info(`${reparadas} usuarios dados de alta que tenían datos pero no estaban en la tabla usuarios`);
}

module.exports = { up };
