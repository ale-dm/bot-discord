// 📚 Listas de películas de Plex (#575): buscar solo en lo que hay en Plex, crear, editar, cambiar la visibilidad y borrar
// (solo su dueño), añadir sin repetir y con tope, ordenar y quitar, que las privadas solo las vea su dueño, y las pantallas
// con sus botones, menús y formularios desde /plex → ⭐ Reseñas. BD en memoria; sin Tautulli.
const db = require("../src/core/db");
const plexListas = require("../src/systems/plexListas");
const plexResenas = require("../src/systems/plexResenas");
const { pantallaListas, pantallaLista, pantallaBuscar, formularioLista } = require("../src/paneles/plexListas");
const { pantallaResenas, pantallaTitulo } = require("../src/paneles/plexResenas");
const plexCmd = require("../src/commands/plex/plex");

const G = "guild-listas";
const ANA = "ana-listas";
const LUIS = "luis-listas";
const DUNE = plexResenas.clavePeli("Dune", 2021);
const ARRIVAL = plexResenas.clavePeli("Arrival", 2016);
const OPPEN = plexResenas.clavePeli("Oppenheimer", 2023);
const SERIE = plexResenas.claveSerie("Dark");

let n = 0;
function ficha(tipo, titulo, anio, encontrada = 1) {
    db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, encontrada, actualizada)
         VALUES (?, ?, ?, ?, ?, '1', 'Pelis', '[]', '[]', '[]', ?, 1)`,
    ).run(G, `k${++n}`, tipo, titulo, anio, encontrada);
}

const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const nueva = (userId = ANA, extra = {}) => plexListas.crear(G, userId, { titulo: "Ciencia ficción", ...extra }).lista;

beforeEach(() => {
    for (const t of ["plex_lista_items", "plex_listas", "plex_resenas"]) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM plex_fichas WHERE guildId = ?").run(G);
    ficha("movie", "Dune", 2021);
    ficha("movie", "Dune", 2021); // la misma en la biblioteca 4K
    ficha("movie", "Arrival", 2016);
    ficha("movie", "Oppenheimer", 2023);
    ficha("show", "Dark", 2017);
    ficha("movie", "Borrada", 2000, 0);
});

describe("buscar en Plex", () => {
    test("encuentra sin tildes ni mayúsculas, una vez aunque esté en dos bibliotecas, y primero lo que empieza así", () => {
        ficha("movie", "La duna del desierto", 1999);
        expect(plexListas.buscar(G, "DÚN").map((t) => t.titulo)).toEqual(["Dune", "La duna del desierto"]);
        expect(plexListas.buscar(G, "dark")).toEqual([{ clave: SERIE, tipo: "show", titulo: "Dark", anio: 2017 }]);
    });

    test("no encuentra lo que ya no está en Plex ni busca con menos de 2 letras", () => {
        expect(plexListas.buscar(G, "borrada")).toEqual([]);
        expect(plexListas.buscar(G, "d")).toEqual([]);
    });
});

describe("listas", () => {
    test("se crean con título de 3 a 80 caracteres, descripción opcional y un tope por persona", () => {
        expect(plexListas.crear(G, ANA, { titulo: "ab" }).motivo).toMatch(/3 a 80/);
        expect(plexListas.crear(G, ANA, { titulo: "Ok", descripcion: "x".repeat(301) }).ok).toBe(false);
        const l = nueva(ANA, { titulo: "  Top   Nolan ", descripcion: "  " });
        expect(l).toMatchObject({ titulo: "Top Nolan", descripcion: null, publica: true, userId: ANA });
        for (let i = 1; i < plexListas.MAX_LISTAS; i++) nueva();
        expect(plexListas.crear(G, ANA, { titulo: "Una más" }).motivo).toMatch(/Ya tienes 10 listas/);
    });

    test("solo su dueño la edita, la hace privada o la borra", () => {
        const l = nueva();
        expect(plexListas.editar(l.id, LUIS, { titulo: "Mía" }).motivo).toMatch(/no es tuya/);
        expect(plexListas.cambiarVisibilidad(l.id, LUIS).ok).toBe(false);
        expect(plexListas.borrar(l.id, LUIS).ok).toBe(false);
        expect(plexListas.editar(l.id, ANA, { titulo: "Sci-fi", descripcion: "Lo mejor" }).lista).toMatchObject({
            titulo: "Sci-fi",
            descripcion: "Lo mejor",
        });
        plexListas.anadir(l.id, ANA, DUNE);
        expect(plexListas.borrar(l.id, ANA).ok).toBe(true);
        expect(plexListas.obtener(l.id)).toBeNull();
        expect(plexListas.items(l.id)).toEqual([]);
    });

    test("las privadas solo las ve su dueño y no salen entre las públicas", () => {
        const l = nueva();
        plexListas.cambiarVisibilidad(l.id, ANA);
        expect(plexListas.puedeVer(plexListas.obtener(l.id), ANA)).toBe(true);
        expect(plexListas.puedeVer(plexListas.obtener(l.id), LUIS)).toBe(false);
        expect(plexListas.publicas(G)).toEqual([]);
        expect(pantallaLista(G, LUIS, l.id).embeds[0].toJSON().description).toMatch(/no existe o es privada/);
    });
});

describe("títulos de una lista", () => {
    test("solo se añaden títulos que hay en Plex, sin repetir y al final", () => {
        const l = nueva();
        expect(plexListas.anadir(l.id, ANA, plexResenas.clavePeli("Inventada", 2020)).motivo).toMatch(/no está en Plex/);
        expect(plexListas.anadir(l.id, ANA, plexResenas.clavePeli("Borrada", 2000)).ok).toBe(false);
        expect(plexListas.anadir(l.id, LUIS, DUNE).motivo).toMatch(/no es tuya/);
        expect(plexListas.anadir(l.id, ANA, DUNE).ok).toBe(true);
        expect(plexListas.anadir(l.id, ANA, DUNE).motivo).toMatch(/ya está en la lista/);
        plexListas.anadir(l.id, ANA, SERIE);
        expect(plexListas.items(l.id).map((i) => [i.posicion, i.titulo, i.tipo])).toEqual([
            [1, "Dune", "movie"],
            [2, "Dark", "show"],
        ]);
    });

    test("se ordenan subiendo y bajando, sin salirse de la lista, y quitar cierra el hueco", () => {
        const l = nueva();
        [DUNE, ARRIVAL, OPPEN].forEach((c) => plexListas.anadir(l.id, ANA, c));
        expect(plexListas.mover(l.id, ANA, 3, -1)).toEqual({ ok: true, posicion: 2 });
        expect(plexListas.mover(l.id, ANA, 1, -1)).toEqual({ ok: true, posicion: 1 });
        expect(plexListas.items(l.id).map((i) => i.titulo)).toEqual(["Dune", "Oppenheimer", "Arrival"]);
        expect(plexListas.quitar(l.id, ANA, 1).item.titulo).toBe("Dune");
        expect(plexListas.items(l.id).map((i) => [i.posicion, i.titulo])).toEqual([
            [1, "Oppenheimer"],
            [2, "Arrival"],
        ]);
        expect(plexListas.mover(l.id, LUIS, 1, 1).ok).toBe(false);
    });

    test("una lista no pasa de 50 títulos", () => {
        const l = nueva();
        for (let i = 0; i < plexListas.MAX_ITEMS; i++) {
            ficha("movie", `Peli ${i}`, 2000);
            plexListas.anadir(l.id, ANA, plexResenas.clavePeli(`Peli ${i}`, 2000));
        }
        expect(plexListas.anadir(l.id, ANA, DUNE).motivo).toMatch(/ya tiene 50 títulos/);
    });
});

describe("pantallas", () => {
    const boton = (customId, extra = {}) => ({
        customId,
        guildId: G,
        user: { id: ANA },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const filas = (p) => p.components.map((f) => f.toJSON().components);
    const sinPasarse = (p) => {
        expect(p.components.length).toBeLessThanOrEqual(5);
        for (const f of filas(p)) expect(f.length).toBeLessThanOrEqual(5);
        expect(new Set(ids(p)).size).toBe(ids(p).length);
        for (const id of ids(p)) expect(id.length).toBeLessThanOrEqual(100);
    };

    test("⭐ Reseñas trae el botón 📚 Listas sin pasarse de botones, también con páginas", () => {
        for (let i = 0; i < 7; i++) {
            db.prepare(
                `INSERT INTO plex_resenas (guildId, userId, clave, tipo, titulo, anio, nota, creado_en, actualizado_en)
                 VALUES (?, ?, ?, 'movie', ?, 2000, 8, ?, ?)`,
            ).run(G, ANA, `peli:p${i}|2000`, `P${i}`, i, i);
        }
        const p = pantallaResenas(G, ANA, "mias");
        expect(ids(p)).toContain("plex_listas");
        sinPasarse(p);
    });

    test("crear desde el formulario abre la lista nueva; con el título corto, avisa", async () => {
        const campos = { titulo: "Para Halloween", descripcion: "Miedo" };
        const i = boton("plex_modal_lista_nueva", { fields: { getTextInputValue: (k) => campos[k] } });
        await plexCmd.handleModal({}, i);
        expect(ultimo(i.update).embeds[0].toJSON().title).toBe("📚 Para Halloween");
        campos.titulo = "x";
        const mal = boton("plex_modal_lista_nueva", { fields: { getTextInputValue: (k) => campos[k] } });
        await plexCmd.handleModal({}, mal);
        expect(ultimo(mal.update).embeds[0].toJSON().description).toMatch(/❌ El título va de 3 a 80/);
    });

    test("➕ Añadir busca en Plex y el desplegable de resultados lo añade y lo deja elegido", async () => {
        const l = nueva();
        const abrir = boton(`plex_lista_add_${l.id}`);
        await plexCmd.handleButton({}, abrir);
        expect(ultimo(abrir.showModal).toJSON().custom_id).toBe(`plex_modal_lista_buscar_${l.id}`);

        const buscar = boton(`plex_modal_lista_buscar_${l.id}`, { fields: { getTextInputValue: () => "arri" } });
        await plexCmd.handleModal({}, buscar);
        const resultados = ultimo(buscar.update);
        expect(filas(resultados)[0][0].options).toEqual([
            expect.objectContaining({ label: "Arrival (2016)", value: ARRIVAL, description: "Película" }),
        ]);

        const elegir = boton(`plex_sel_lista_add_${l.id}`, { values: [ARRIVAL] });
        await plexCmd.handleSelect({}, elegir);
        const p = ultimo(elegir.update);
        expect(p.embeds[0].toJSON().description).toMatch(/➕ Añadida \*\*Arrival\*\*/);
        expect(ids(p)).toEqual(expect.arrayContaining([`plex_lista_quitar_${l.id}_1`, `plex_lista_ficha_${l.id}_1`]));
        sinPasarse(p);
    });

    test("elegir un título y ⬆️ Subir lo cambia de sitio y lo sigue dejando elegido", async () => {
        const l = nueva();
        [DUNE, ARRIVAL].forEach((c) => plexListas.anadir(l.id, ANA, c));
        const sel = boton(`plex_sel_lista_item_${l.id}`, { values: ["2"] });
        await plexCmd.handleSelect({}, sel);
        expect(ultimo(sel.update).embeds[0].toJSON().description).toContain("👉 **2.** 🎬 **Arrival (2016)**");
        const subir = boton(`plex_lista_sub_${l.id}_2`);
        await plexCmd.handleButton({}, subir);
        expect(ultimo(subir.update).embeds[0].toJSON().description).toContain("👉 **1.** 🎬 **Arrival (2016)**");
    });

    test("en la lista de otro no hay botones de dueño, y ⭐ Ficha abre la ficha aunque no tenga reseñas", async () => {
        const l = nueva();
        plexListas.anadir(l.id, ANA, OPPEN);
        const p = pantallaLista(G, LUIS, l.id, { elegido: 1 });
        expect(ids(p)).not.toContain(`plex_lista_add_${l.id}`);
        expect(ids(p)).not.toContain(`plex_lista_quitar_${l.id}_1`);
        const ficha_ = boton(`plex_lista_ficha_${l.id}_1`, { user: { id: LUIS } });
        await plexCmd.handleButton({}, ficha_);
        expect(ultimo(ficha_.update).embeds[0].toJSON().title).toBe("⭐ Oppenheimer (2023)");
        expect(pantallaTitulo(G, LUIS, OPPEN).embeds[0].toJSON().title).toBe("⭐ Oppenheimer (2023)");
    });

    test("borrar pide confirmación y otro no puede hacerlo con el botón", async () => {
        const l = nueva();
        const ajeno = boton(`plex_lista_borrarsi_${l.id}`, { user: { id: LUIS } });
        await plexCmd.handleButton({}, ajeno);
        expect(ultimo(ajeno.update).embeds[0].toJSON().description).toMatch(/no es tuya/);
        expect(plexListas.obtener(l.id)).not.toBeNull();
        const pedir = boton(`plex_lista_borrar_${l.id}`);
        await plexCmd.handleButton({}, pedir);
        expect(ids(ultimo(pedir.update))).toEqual([`plex_lista_borrarsi_${l.id}`, `plex_lista_ver_${l.id}_0`]);
        await plexCmd.handleButton({}, boton(`plex_lista_borrarsi_${l.id}`));
        expect(plexListas.obtener(l.id)).toBeNull();
    });

    test("🌍 Públicas enseña las listas públicas de todos con su dueño, cinco por página", () => {
        for (let i = 0; i < 6; i++) nueva(i % 2 ? ANA : LUIS, { titulo: `Lista ${i}` });
        const p = pantallaListas(G, ANA, "publicas");
        expect(p.embeds[0].toJSON().description).toMatch(/de <@luis-listas>/);
        expect(filas(p)[1]).toHaveLength(5);
        expect(ids(p)).toContain("plex_listas_pag_publicas_1");
        sinPasarse(p);
    });

    test("una lista larga se pagina de diez en diez y el formulario de editar viene relleno", () => {
        const l = nueva(ANA, { descripcion: "Las mejores" });
        for (let i = 0; i < 12; i++) {
            ficha("movie", `Peli ${i}`, 2001);
            plexListas.anadir(l.id, ANA, plexResenas.clavePeli(`Peli ${i}`, 2001));
        }
        const p = pantallaLista(G, ANA, l.id, { pagina: 1 });
        expect(p.embeds[0].toJSON().description).toMatch(/\*\*11\.\*\*.*\n.*\*\*12\.\*\*/);
        expect(p.embeds[0].toJSON().description).toMatch(/Página 2 de 2/);
        sinPasarse(p);
        const campos = formularioLista(plexListas.obtener(l.id))
            .toJSON()
            .components.map((f) => f.components[0]);
        expect(campos.map((c) => c.value)).toEqual(["Ciencia ficción", "Las mejores"]);
    });

    test("sin resultados lo dice y deja buscar otro", () => {
        const p = pantallaBuscar(nueva(), "zzz", []);
        expect(p.embeds[0].toJSON().description).toMatch(/No hay nada en Plex/);
        expect(ids(p)).toEqual([expect.stringMatching(/^plex_lista_add_/), expect.stringMatching(/^plex_lista_ver_/)]);
    });
});
