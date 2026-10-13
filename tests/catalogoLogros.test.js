// #480: el catálogo de logros está partido por categoría (systems/logros/datos/*.js) y se junta en catalogo.js. El resultado es el
// mismo que antes de partirlo (mismo contenido y mismo orden: importa para los listados y los trofeos) y ningún fichero pasa de
// 400 líneas.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CATALOG } = require("../src/systems/logros/catalogo");

const DIR = path.join(__dirname, "../src/systems/logros");

test("el catálogo exportado es idéntico al de antes de partirlo (125 logros, mismo orden)", () => {
    expect(CATALOG).toHaveLength(125);
    // Huella del contenido y del orden tal como estaba en un solo fichero. Si se cambia un logro a propósito, se actualiza.
    expect(crypto.createHash("sha1").update(JSON.stringify(CATALOG)).digest("hex")).toBe("c85cc415446e9578d01378ab4572d4bef307fcc9");
});

test("las categorías salen juntas y en el orden de siempre, y los ids no se repiten", () => {
    const categorias = CATALOG.map((l) => l.category).filter((c, i, a) => c !== a[i - 1]);
    expect(categorias).toEqual(["social", "xp", "casino", "cripto", "tienda", "plex"]);
    expect(new Set(CATALOG.map((l) => l.id)).size).toBe(CATALOG.length);
});

test("ningún fichero de logros supera 400 líneas", () => {
    const ficheros = [path.join(DIR, "catalogo.js"), ...fs.readdirSync(path.join(DIR, "datos")).map((f) => path.join(DIR, "datos", f))];
    for (const f of ficheros) expect(fs.readFileSync(f, "utf8").split("\n").length).toBeLessThanOrEqual(400);
});
