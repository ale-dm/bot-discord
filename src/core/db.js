const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const { DATA_DIR } = require("./paths");
// DB_PATH permite apuntar a otra BD (los tests usan ':memory:' para no tocar la real).
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "banco.db");

// Asegura que la carpeta data existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Improve concurrency: enable WAL journal mode and set a busy timeout
try {
    db.pragma("journal_mode = WAL");
} catch (e) {
    /* ignore if not supported */
}
try {
    db.pragma("busy_timeout = 5000");
} catch (e) {
    /* ignore */
}

// Caché de sentencias preparadas. El código hace db.prepare(sql) en cada llamada (cada
// mensaje, cada tick de voz...), y better-sqlite3 recompila el SQL cada vez. Reutilizar la
// sentencia es seguro: .get/.all/.run son síncronas (no se usa .iterate()), y los modos que
// cambian el estado de la sentencia (.pluck/.raw/.expand) se resetean cada vez que se entrega,
// así un .pluck() en un sitio no afecta a quien reutilice el mismo SQL en otro.
// LRU con tope por si algún SQL se construye dinámicamente (listas de placeholders).
const STMT_CACHE_MAX = 500;
const stmtCache = new Map();
const rawPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
    let stmt = stmtCache.get(sql);
    if (stmt) {
        stmtCache.delete(sql);
        if (stmt.reader) stmt.raw(false).expand(false).pluck(false);
    } else {
        stmt = rawPrepare(sql);
        if (stmtCache.size >= STMT_CACHE_MAX) stmtCache.delete(stmtCache.keys().next().value);
    }
    stmtCache.set(sql, stmt);
    return stmt;
};

// Esquema: se aplican las migraciones pendientes (src/core/migrations) al abrir la BD, así
// cualquier módulo que la use —también los tests— la encuentra completa.
require("./migrations").runMigrations(db);

module.exports = db;
