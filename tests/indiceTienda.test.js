// Índice de la clave foránea tienda.objetoId (migración 042): existe, y la consulta del catálogo del panel admin
// (LEFT JOIN de objeto a tienda) lo usa en vez de recorrer la tabla entera.
const db = require("../src/core/db");

describe("migración 042: índice de tienda.objetoId", () => {
    // Con dos filas, SQLite prefiere recorrer la tabla (es más barato). Para que la prueba diga algo, se cargan
    // suficientes objetos a la venta y se recalculan las estadísticas, como en un servidor de verdad.
    beforeAll(() => {
        const alta = db.prepare("INSERT INTO objeto (nombre, descripcion) VALUES (?, ?)");
        const venta = db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, ?, NULL)");
        db.transaction(() => {
            for (let k = 0; k < 400; k++) venta.run(alta.run(`objeto ${k}`, "de prueba").lastInsertRowid, 100 + k);
        })();
        db.exec("ANALYZE");
    });

    test("el índice existe sobre la columna objetoId", () => {
        const indices = db
            .prepare("PRAGMA index_list(tienda)")
            .all()
            .map((i) => i.name);
        expect(indices).toContain("idx_tienda_objetoId");
        const columnas = db
            .prepare("PRAGMA index_info(idx_tienda_objetoId)")
            .all()
            .map((c) => c.name);
        expect(columnas).toEqual(["objetoId"]);
    });

    test("el catálogo del admin busca la tienda por objetoId con el índice", () => {
        const plan = db
            .prepare("EXPLAIN QUERY PLAN SELECT o.id, t.precio FROM objeto o LEFT JOIN tienda t ON t.objetoId = o.id ORDER BY o.id ASC")
            .all()
            .map((r) => r.detail)
            .join(" | ");
        expect(plan).toContain("idx_tienda_objetoId");
    });

    test("la búsqueda de un objeto a la venta usa el índice", () => {
        const plan = db
            .prepare("EXPLAIN QUERY PLAN SELECT * FROM tienda WHERE objetoId = ?")
            .all(1)
            .map((r) => r.detail)
            .join(" | ");
        expect(plan).toContain("idx_tienda_objetoId");
    });
});
