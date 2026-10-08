// 🌍 Trofeos por país (#19): el id de TMDB de cada película (de los guids de Tautulli), los países que pide TMDB (sin
// clave no se pide nada; un error para en la siguiente vez) y los trofeos "Viajero de …" a partir de 5 y 10 películas del
// país. TMDB se simula: no se hace ninguna petición real.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexFichas = require("../src/systems/plexFichas");
const tmdbClient = require("../src/services/tmdbClient");
const plexTrofeos = require("../src/systems/plexTrofeos");

let n = 0;
let filaId = 7000;
const nuevoGuild = () => `guild-pais-${++n}`;
const hoy = () => Math.floor(Date.now() / 1000);

function pelicula(g, key, paises, tmdb = null) {
    db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, encontrada, actualizada, tmdb, paises)
         VALUES (?, ?, 'movie', ?, 2000, 1, ?, ?, ?)`,
    ).run(g, key, `Peli ${key}`, Date.now(), tmdb, paises === null ? null : JSON.stringify(paises));
}
function vista(g, user, key) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, titulo, inicio, segundos, visto)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, 7200, 1)`,
    ).run(g, filaId++, String(user), key, `Peli ${key}`, hoy());
}

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TMDB_API_KEY;
});

describe("el id de TMDB", () => {
    test("sale de los guids de Tautulli, con la forma tmdb://", () => {
        expect(plexFichas.tmdbDe({ guids: ["imdb://tt0137523", "tmdb://603"] })).toBe("603");
        expect(plexFichas.tmdbDe({ guid: "tmdb://1234" })).toBe("1234");
        expect(plexFichas.tmdbDe({ guids: ["imdb://tt1"] })).toBeNull();
    });
});

describe("los países de TMDB", () => {
    test("sin clave no se piden", async () => {
        expect(await tmdbClient.paisesDePelicula(603)).toBeNull();
    });

    test("se devuelven en español, y un 404 es que no hay países", async () => {
        process.env.TMDB_API_KEY = "clave";
        global.fetch = jest.fn(async (url) => ({
            status: url.includes("/603") ? 200 : 404,
            ok: url.includes("/603"),
            json: async () => ({ production_countries: [{ iso_3166_1: "US" }, { iso_3166_1: "JP" }] }),
        }));
        expect(await tmdbClient.paisesDePelicula(603)).toEqual(["Estados Unidos", "Japón"]);
        expect(await tmdbClient.paisesDePelicula(999)).toEqual([]);
        expect(global.fetch.mock.calls[0][0]).toMatch(/language=es-ES/);
    });

    test("completarPaises rellena solo las películas con id de TMDB y sin países", async () => {
        const g = nuevoGuild();
        pelicula(g, `c-${n}-a`, null, "603");
        pelicula(g, `c-${n}-b`, ["Francia"], "11"); // ya tiene países
        pelicula(g, `c-${n}-c`, null, null); // sin id de TMDB
        process.env.TMDB_API_KEY = "clave";
        jest.spyOn(tmdbClient, "paisesDePelicula").mockResolvedValue(["Japón"]);
        expect(await plexFichas.completarPaises(g)).toBe(1);
        expect(db.prepare("SELECT paises FROM plex_fichas WHERE guildId = ? AND rating_key = ?").get(g, `c-${n}-a`).paises).toBe(
            '["Japón"]',
        );
        expect(db.prepare("SELECT paises FROM plex_fichas WHERE guildId = ? AND rating_key = ?").get(g, `c-${n}-c`).paises).toBeNull();
    });

    test("sin clave, completarPaises no hace nada", async () => {
        const g = nuevoGuild();
        pelicula(g, `s-${n}`, null, "603");
        const espia = jest.spyOn(tmdbClient, "paisesDePelicula");
        expect(await plexFichas.completarPaises(g)).toBe(0);
        expect(espia).not.toHaveBeenCalled();
    });

    test("si TMDB falla, se para y lo que falta se queda para la siguiente vez", async () => {
        const g = nuevoGuild();
        pelicula(g, `f-${n}-a`, null, "1");
        pelicula(g, `f-${n}-b`, null, "2");
        process.env.TMDB_API_KEY = "clave";
        jest.spyOn(tmdbClient, "paisesDePelicula").mockRejectedValue(new Error("caído"));
        expect(await plexFichas.completarPaises(g)).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS n FROM plex_fichas WHERE guildId = ? AND paises IS NULL").get(g).n).toBe(2);
    });
});

describe("los trofeos por país", () => {
    test("5 películas de un país dan el primero, y 10 el de experto", () => {
        const g = nuevoGuild();
        const u = "ana";
        for (let i = 0; i < 10; i++) {
            pelicula(g, `j-${n}-${i}`, ["Japón"], String(i));
            vista(g, u, `j-${n}-${i}`);
        }
        pelicula(g, `x-${n}`, ["Japón"]); // no la ha visto
        const ctx = plexTrofeos.contexto(g);
        const lista = plexTrofeos.candidatos(plexTrofeos.datosUsuario(g, u, ctx), ctx);
        const japon = lista.filter((t) => t.tipo === "pais");
        expect(japon.map((t) => [t.id, t.recompensa, t.dificultad])).toEqual([
            [`pais:japon:5`, 250, "facil"],
            [`pais:japon:10`, 600, "normal"],
        ]);
        expect(japon[0].nombre).toBe("Viajero de Japón");
    });

    test("con menos de 5 películas de un país no sale ninguno", () => {
        const g = nuevoGuild();
        for (let i = 0; i < 4; i++) {
            pelicula(g, `m-${n}-${i}`, ["Chile"], String(i));
            vista(g, "luis", `m-${n}-${i}`);
        }
        const ctx = plexTrofeos.contexto(g);
        const lista = plexTrofeos.candidatos(plexTrofeos.datosUsuario(g, "luis", ctx), ctx);
        expect(lista.filter((t) => t.tipo === "pais")).toEqual([]);
    });
});
