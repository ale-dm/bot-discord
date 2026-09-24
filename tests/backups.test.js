const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-backups-"));
process.env.BACKUP_DIR = dir;
process.env.BACKUP_KEEP = "3";

const Database = require("better-sqlite3");
const { hacerBackup, listarBackups } = require("../src/systems/backups");

test("hace la copia del día, es una BD válida y solo conserva las últimas BACKUP_KEEP", async () => {
    for (const d of ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]) fs.writeFileSync(path.join(dir, `banco-${d}.db`), "viejo");
    fs.writeFileSync(path.join(dir, "otra-copia-manual.db"), "no se toca");

    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42);");
    const r = await hacerBackup(db);

    const nombres = listarBackups().map((b) => b.fichero);
    expect(nombres).toHaveLength(3);
    expect(nombres).toContain(r.fichero);
    expect(nombres).not.toContain("banco-2026-01-01.db");
    expect(fs.existsSync(path.join(dir, "otra-copia-manual.db"))).toBe(true); // las que no siguen el patrón no se rotan

    const copia = new Database(path.join(dir, r.fichero), { readonly: true });
    expect(copia.prepare("SELECT x FROM t").get().x).toBe(42);
    copia.close();
});
