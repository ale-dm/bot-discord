// Creación de índices para las migraciones: si una BD antigua no tiene alguna columna del índice, se omite y se avisa
// (el bot tiene que arrancar igual; el índice se puede añadir después con otra migración). Sin número: no es una
// migración, la usan las de índices (040, 041...).
const { createLogger } = require("../logger");

const log = createLogger("Migraciones");

// Tabla y columnas de un índice, leídas de su propio SQL.
function columnasDe(sql) {
    const m = /ON (\w+)\(([^)]*)\)/.exec(sql);
    return { tabla: m[1], columnas: m[2].split(",").map((c) => c.trim()) };
}

function crearIndices(db, sqls) {
    for (const sql of sqls) {
        const { tabla, columnas } = columnasDe(sql);
        const existentes = db
            .prepare(`PRAGMA table_info(${tabla})`)
            .all()
            .map((c) => c.name);
        const faltan = columnas.filter((c) => !existentes.includes(c));
        if (faltan.length) {
            log.warn(`Índice omitido en ${tabla}: faltan las columnas ${faltan.join(", ")} (BD antigua)`);
            continue;
        }
        db.exec(sql);
    }
}

module.exports = { crearIndices };
