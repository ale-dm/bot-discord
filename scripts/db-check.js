// Revisa la base de datos sin modificarla: integridad, tablas con su nº de filas e índices.
// Uso: node scripts/db-check.js [ruta a la BD]   (por defecto data/banco.db)
const path = require("path");
const Database = require("better-sqlite3");
const { DATA_DIR } = require("../src/core/paths");

const dbPath = process.argv[2] || process.env.DB_PATH || path.join(DATA_DIR, "banco.db");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log(`BD: ${dbPath}\n`);
console.log("Integridad:", db.prepare("PRAGMA integrity_check").pluck().get());
console.log("Modo journal:", db.pragma("journal_mode", { simple: true }));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
console.log(`\n${tables.length} tablas:`);
console.table(tables.map((name) => ({ tabla: name, filas: db.prepare(`SELECT COUNT(*) FROM "${name}"`).pluck().get() })));

const indexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name").all();
console.log(`${indexes.length} índices:`);
console.table(indexes.map((i) => ({ indice: i.name, tabla: i.tbl_name })));

db.close();
