// #470: ningún menú de selección se corta a 25 en silencio. El helper de páginas, el panel de sonidos con 40 sonidos
// (el 40 se puede borrar, editar y probar) y una comprobación del código que falla si vuelve un `slice(0, 25)` suelto.
const fs = require("fs");
const path = require("path");
const db = require("../src/core/db");
const sonidos = require("../src/systems/sonidos");
const { paginaDeLista, filaPaginas, paginaDeId, MAX_OPCIONES } = require("../src/paneles/menuPaginado");
const { handleSonidosButton } = require("../src/adminPanel/sonidos");

const G = "g-menu-paginado";

describe("paginaDeLista y filaPaginas", () => {
    const lista = Array.from({ length: 40 }, (_, i) => i + 1);

    test("reparte 40 en dos páginas de 25 y 15", () => {
        const p0 = paginaDeLista(lista, 0);
        const p1 = paginaDeLista(lista, 1);
        expect(p0.items).toHaveLength(25);
        expect(p1.items).toEqual(lista.slice(25));
        expect(p1).toMatchObject({ pagina: 1, paginas: 2, desde: 26, hasta: 40, total: 40 });
    });

    test("una página fuera de rango se ajusta a la última", () => {
        expect(paginaDeLista(lista, 9).pagina).toBe(1);
        expect(paginaDeLista(lista, -3).pagina).toBe(0);
    });

    test("sin fila de páginas si todo cabe; con contador si no", () => {
        expect(filaPaginas("x_", paginaDeLista(lista.slice(0, 25), 0))).toBeNull();
        const fila = filaPaginas("x_", paginaDeLista(lista, 0)).toJSON();
        expect(fila.components.map((b) => b.custom_id)).toEqual(["x_-1", "x_info", "x_1"]);
        expect(fila.components[1].label).toBe("Mostrando 1–25 de 40");
        expect(fila.components[0].disabled).toBe(true);
    });

    test("paginaDeId solo reconoce números de su prefijo", () => {
        expect(paginaDeId("x_", "x_3")).toBe(3);
        expect(paginaDeId("x_", "x_info")).toBeNull();
        expect(paginaDeId("x_", "y_3")).toBeNull();
    });
});

describe("panel de sonidos con 40 sonidos", () => {
    beforeAll(() => {
        db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G);
        for (let i = 1; i <= sonidos.MAX_SONIDOS; i++)
            db.prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, 'x.mp3', 'a', 0)").run(G, `S${i}`);
    });
    afterAll(() => db.prepare("DELETE FROM sonidos WHERE guildId = ?").run(G));

    const pulsar = async (customId) => {
        let vista = null;
        const interaction = { customId, guildId: G, update: async (v) => (vista = v) };
        expect(await handleSonidosButton(interaction)).toBe(true);
        return vista.components.map((c) => c.toJSON());
    };

    test.each(["borrar", "probar", "editar"])("el sonido 40 se puede %s pasando a la página 2", async (modo) => {
        const primera = await pulsar(`paneladmin_sonidos_${modo}`);
        expect(primera[0].components[0].options).toHaveLength(MAX_OPCIONES);
        expect(primera[1].components[2].custom_id).toBe(`paneladmin_sonidos_${modo}_p_1`);

        const segunda = await pulsar(`paneladmin_sonidos_${modo}_p_1`);
        const opciones = segunda[0].components[0].options.map((o) => o.label);
        expect(opciones).toHaveLength(15);
        expect(opciones).toContain("S40");
        expect(segunda[0].components[0].custom_id).toBe(`paneladmin_sonidos_${modo}_select`);
    });
});

describe("ningún menú nuevo se corta a 25 sin paginar", () => {
    const leer = (dir) =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const ruta = path.join(dir, e.name);
            if (e.isDirectory()) return leer(ruta);
            return e.name.endsWith(".js") ? [ruta] : [];
        });

    test("no hay `slice(0, 25)` en src/: se usa paneles/menuPaginado.js", () => {
        const culpables = leer(path.join(__dirname, "..", "src")).filter((f) => /\.slice\(0,\s*25\)/.test(fs.readFileSync(f, "utf8")));
        expect(culpables).toEqual([]);
    });
});
