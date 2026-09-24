// Migraciones de la base de datos.
//
// Todo el esquema vive aquí (antes cada comando creaba sus tablas al cargarse, varias repetidas
// y con definiciones distintas). Cada fichero NNN_nombre.js exporta `up(db, ctx)` y se aplica
// una sola vez, en orden, dentro de una transacción. Las aplicadas quedan en `schema_migrations`.
//
// Para cambiar el esquema: añadir un fichero nuevo con el siguiente número. No editar una
// migración que ya se haya aplicado en producción (no se volvería a ejecutar).
const fs = require("fs");
const path = require("path");
const { createLogger } = require("../logger");

const log = createLogger("Migraciones");

function listMigrations() {
    return fs
        .readdirSync(__dirname)
        .map((f) => /^(\d{3})_([\w-]+)\.js$/.exec(f))
        .filter(Boolean)
        .map((m) => ({ version: Number(m[1]), name: m[2], file: path.join(__dirname, m[0]) }))
        .sort((a, b) => a.version - b.version);
}

/**
 * Aplica las migraciones pendientes. Se llama al abrir la BD (core/db.js), así cualquier
 * módulo que use la BD —también los tests— la encuentra con el esquema completo.
 * @returns {number} migraciones aplicadas en esta llamada
 */
function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        )
    `);
    const applied = new Set(
        db
            .prepare("SELECT version FROM schema_migrations")
            .all()
            .map((r) => r.version),
    );
    let count = 0;
    for (const m of listMigrations()) {
        if (applied.has(m.version)) continue;
        const { up } = require(m.file);
        const t0 = Date.now();
        try {
            db.transaction(() => {
                up(db, { log: log.child(m.name) });
                db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, Date.now());
            })();
        } catch (e) {
            log.error(`La migración ${m.version} (${m.name}) falló; la BD queda como estaba antes de ella:`, e);
            throw e;
        }
        log.info(`Aplicada ${String(m.version).padStart(3, "0")}_${m.name} (${Date.now() - t0} ms)`);
        count++;
    }
    return count;
}

// Ayudas para las migraciones.
function hasColumn(db, table, column) {
    return db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, definition) {
    if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

module.exports = { runMigrations, listMigrations, hasColumn, addColumnIfMissing };
