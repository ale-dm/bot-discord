// 📺 Reseñas de series y temporadas (#572): qué se considera terminado (con los datos de trofeos, desde la activación),
// que se guarda con su temporada, que el DM dice «la temporada N de X», y que un episodio suelto no genera ningún aviso.
// Sin Tautulli ni fichas reales: los datos de visionado llegan por dobles con la forma que devuelve datosUsuario.
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const guildSettings = require("../src/systems/guildSettings");
const plexResenas = require("../src/systems/plexResenas");
const series = require("../src/systems/plexResenas/series");
const pedidos = require("../src/systems/plexResenas/pedidos");
const { mensajeResena } = require("../src/discord/mensajes/resena");

const G = "guild-series-resenas";

beforeEach(() => {
    db.prepare("DELETE FROM plex_resenas WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM plex_resenas_pedidas WHERE guildId = ?").run(G);
    guildSettings.setSetting(G, "plex.resenas_activo", false);
    guildSettings.setSetting(G, "plex.resenas_desde", 0);
    jest.restoreAllMocks();
});

describe("qué está terminado", () => {
    const visto = (sr) => ({ ficha: { titulo: "Breaking Bad", anio: 2008 }, ...sr });
    const ctx = {};

    test("una temporada completa da su clave; la serie entera solo si está completa", () => {
        const deps = {
            contexto: () => ctx,
            datosUsuario: () => ({ series: [visto({ terminadas: [{ n: 1 }, { n: 2 }], completa: true })] }),
        };
        const claves = series.terminadasDe(G, "1", { deps }).map((t) => t.clave);
        expect(claves).toEqual(["serie:breaking bad|t1", "serie:breaking bad|t2", "serie:breaking bad"]);

        const incompleta = { contexto: () => ctx, datosUsuario: () => ({ series: [visto({ terminadas: [{ n: 1 }], completa: false })] }) };
        expect(series.terminadasDe(G, "1", { deps: incompleta }).map((t) => t.clave)).toEqual(["serie:breaking bad|t1"]);
    });

    test("un episodio suelto no cuenta: sin temporada terminada no sale nada", () => {
        const deps = { contexto: () => ctx, datosUsuario: () => ({ series: [visto({ terminadas: [], completa: false })] }) };
        expect(series.terminadasDe(G, "1", { deps })).toEqual([]);
    });

    test("solo cuenta lo visto desde la activación (rango desde `desde`, sin fin)", () => {
        const datosUsuario = jest.fn(() => ({ series: [] }));
        series.terminadasDe(G, "1", { desde: 500, deps: { contexto: () => ctx, datosUsuario } });
        expect(datosUsuario).toHaveBeenCalledWith(G, "1", ctx, { desde: 500, hasta: Number.MAX_SAFE_INTEGER });
    });

    test("haTerminado mira una temporada concreta, o la serie entera sin temporada", () => {
        const deps = { contexto: () => ctx, datosUsuario: () => ({ series: [visto({ terminadas: [{ n: 2 }], completa: false })] }) };
        expect(series.haTerminado(G, "1", { titulo: "Breaking Bad", temporada: 2 }, deps)).toBe(true);
        expect(series.haTerminado(G, "1", { titulo: "Breaking Bad", temporada: 1 }, deps)).toBe(false);
        expect(series.haTerminado(G, "1", { titulo: "Breaking Bad" }, deps)).toBe(false);
    });
});

describe("guardar una serie", () => {
    beforeEach(() => plexLinks.setLink(G, "ana", "7", "ana"));

    test("se guarda con su temporada: el título se ve con «· temporada N» y la clave sale del título base", () => {
        jest.spyOn(series, "haTerminado").mockReturnValue(true);
        const r = plexResenas.guardar(G, "ana", { tipo: "show", titulo: "Breaking Bad", temporada: 1, nota: 8 });
        expect(r.ok).toBe(true);
        const fila = plexResenas.de(G, "ana", "serie:breaking bad|t1");
        expect(fila).toMatchObject({ titulo: "Breaking Bad · temporada 1", tipo: "show" });
    });

    test("una temporada que no ha terminado no se puede valorar", () => {
        jest.spyOn(series, "haTerminado").mockReturnValue(false);
        const r = plexResenas.guardar(G, "ana", { tipo: "show", titulo: "Breaking Bad", temporada: 3, nota: 8 });
        expect(r).toEqual({ ok: false, motivo: "Solo puedes valorar lo que has visto." });
    });
});

describe("el DM y a quién se pregunta", () => {
    test("una temporada dice «la temporada N de X»; la serie entera o una película, el título", () => {
        const temporada = mensajeResena({ id: 1, clave: "serie:breaking bad|t2", titulo: "Breaking Bad", anio: 2008 });
        expect(temporada.embeds[0].data.description).toContain("Has terminado la temporada 2 de **Breaking Bad**.");
        const entera = mensajeResena({ id: 2, clave: "serie:breaking bad", titulo: "Breaking Bad", anio: 2008 });
        expect(entera.embeds[0].data.description).toContain("Has terminado **Breaking Bad** (2008).");
    });

    test("pendientes incluye la temporada terminada, con el mismo tope y sin repetirla", () => {
        guildSettings.setSetting(G, "plex.resenas_activo", true);
        guildSettings.setSetting(G, "plex.resenas_desde", 1);
        plexLinks.setLink(G, "ana", "7", "ana");
        jest.spyOn(series, "terminadasDe").mockReturnValue([
            { titulo: "Breaking Bad", anio: 2008, temporada: 1, clave: "serie:breaking bad|t1" },
        ]);
        const primera = pedidos.pendientes(G);
        expect(primera.map((p) => p.clave)).toEqual(["serie:breaking bad|t1"]);
        pedidos.registrar(primera[0]);
        expect(pedidos.pendientes(G)).toEqual([]);
    });

    test("helpers de claves y títulos", () => {
        expect(plexResenas.temporadaDeClave("serie:x|t12")).toBe(12);
        expect(plexResenas.temporadaDeClave("peli:x|2024")).toBeNull();
        expect(plexResenas.etiquetaTemporada("X", 3)).toBe("X · temporada 3");
        expect(plexResenas.tituloBase("X · temporada 3")).toBe("X");
        expect(plexResenas.tituloBase("X")).toBe("X");
    });
});
