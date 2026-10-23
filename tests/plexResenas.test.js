// 🍿 Núcleo de las reseñas de Plex (#565): guardar, media, votos, histograma, rankings y privacidad.
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const plexResenas = require("../src/systems/plexResenas");

const G = "guild-resenas";
let siguiente = 1;

function visto(tautulliUserId, titulo, anio) {
    db.prepare(
        `INSERT INTO plex_reproducciones
            (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, porcentaje, visto)
         VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, ?, 100, 1)`,
    ).run(G, siguiente, String(tautulliUserId), `k${siguiente}`, titulo, anio, 1000 + siguiente, 7200);
    siguiente++;
}

beforeAll(() => {
    plexLinks.setLink(G, "u1", "1", "ana");
    plexLinks.setLink(G, "u2", "2", "luis");
    visto(1, "Dune: Parte dos", 2024);
    visto(2, "Dune: Parte dos", 2024);
    visto(1, "Otra película", 2020);
});

describe("notas y claves", () => {
    test("las medias estrellas se pintan como en Letterboxd", () => {
        expect(plexResenas.estrellasTexto(1)).toBe("½");
        expect(plexResenas.estrellasTexto(2)).toBe("★");
        expect(plexResenas.estrellasTexto(3)).toBe("★½");
        expect(plexResenas.estrellasTexto(9)).toBe("★★★★½");
        expect(plexResenas.estrellasTexto(10)).toBe("★★★★★");
    });

    test("la clave de una película no cambia con mayúsculas, tildes ni otra biblioteca", () => {
        expect(plexResenas.clavePeli("Dune: Parte dos", 2024)).toBe(plexResenas.clavePeli("dune: parte DOS", 2024));
        expect(plexResenas.clavePeli("Amélie", 2001)).toBe(plexResenas.clavePeli("amelie", 2001));
    });
});

describe("guardar", () => {
    test("solo se puede valorar lo que se ha visto", () => {
        const r = plexResenas.guardar(G, "u1", { tipo: "movie", titulo: "No la he visto", anio: 2025, nota: 8 });
        expect(r).toEqual({ ok: false, motivo: "Solo puedes valorar lo que has visto." });
    });

    test("una nota fuera de rango no se guarda", () => {
        const r = plexResenas.guardar(G, "u1", { tipo: "movie", titulo: "Dune: Parte dos", anio: 2024, nota: 11 });
        expect(r.ok).toBe(false);
    });

    test("se guarda, se cambia y se borra", () => {
        const r = plexResenas.guardar(G, "u1", {
            tipo: "movie",
            titulo: "Dune: Parte dos",
            anio: 2024,
            nota: 8,
            texto: "  Me ha encantado  ",
        });
        expect(r.ok).toBe(true);
        expect(r.resena).toMatchObject({ nota: 8, texto: "Me ha encantado", spoilers: false, meGusta: false });

        const cambiada = plexResenas.guardar(G, "u1", {
            tipo: "movie",
            titulo: "Dune: Parte dos",
            anio: 2024,
            nota: 9,
            texto: "",
            spoilers: true,
            meGusta: true,
        });
        expect(cambiada.resena).toMatchObject({ nota: 9, texto: null, spoilers: true, meGusta: true });

        expect(plexResenas.borrar(G, "u1", plexResenas.clavePeli("Dune: Parte dos", 2024))).toBe(true);
        expect(plexResenas.de(G, "u1", plexResenas.clavePeli("Dune: Parte dos", 2024))).toBeNull();
    });
});

describe("media, rankings y privacidad", () => {
    beforeAll(() => {
        plexResenas.guardar(G, "u1", { tipo: "movie", titulo: "Dune: Parte dos", anio: 2024, nota: 8, texto: "Muy buena" });
        plexResenas.guardar(G, "u2", { tipo: "movie", titulo: "Dune: Parte dos", anio: 2024, nota: 9 });
        plexResenas.guardar(G, "u1", { tipo: "movie", titulo: "Otra película", anio: 2020, nota: 5 });
    });

    test("media, votos e histograma del título", () => {
        const t = plexResenas.titulo(G, plexResenas.clavePeli("Dune: Parte dos", 2024));
        expect(t).toMatchObject({ media: 4.3, votos: 2 });
        expect(t.histograma[7]).toEqual({ nota: 8, votos: 1 });
        expect(t.histograma[8]).toEqual({ nota: 9, votos: 1 });
        expect(t.resenas).toHaveLength(2);
    });

    test("las mejores piden un mínimo de votos", () => {
        expect(plexResenas.mejores(G, { minVotos: 2 }).map((m) => m.titulo)).toEqual(["Dune: Parte dos"]);
        expect(plexResenas.mejores(G, { minVotos: 3 })).toEqual([]);
    });

    test("quien oculta sus reseñas sale de medias, últimas y rankings", () => {
        plexResenas.setOculto(G, "u1", true);
        expect(plexResenas.oculto(G, "u1")).toBe(true);

        const t = plexResenas.titulo(G, plexResenas.clavePeli("Dune: Parte dos", 2024));
        expect(t).toMatchObject({ media: 4.5, votos: 1 });
        expect(t.resenas.map((r) => r.userId)).toEqual(["u2"]);
        expect(plexResenas.ultimas(G).every((r) => r.userId !== "u1")).toBe(true);
        expect(plexResenas.rankingValoradores(G)).toEqual([{ userId: "u2", n: 1 }]);
        // Sus propias reseñas las sigue viendo.
        expect(plexResenas.deUsuario(G, "u1")).toHaveLength(2);

        plexResenas.setOculto(G, "u1", false);
        expect(plexResenas.titulo(G, plexResenas.clavePeli("Dune: Parte dos", 2024)).votos).toBe(2);
    });

    test("quién más valora", () => {
        expect(plexResenas.rankingValoradores(G)).toEqual([
            { userId: "u1", n: 2 },
            { userId: "u2", n: 1 },
        ]);
    });
});
