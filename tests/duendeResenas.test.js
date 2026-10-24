// ⭐ La herramienta de reseñas del Duende (#570): datos reales de reseñas públicas, sin inventar títulos ni ids, y sin el texto
// de las reseñas con spoilers. Se prueba con dobles inyectados: sin base de datos ni Discord.
const { DUENDE_PLEX_EXECUTORS: plex } = require("../src/services/duende/herramientas/plex");

const resena = (over = {}) => ({
    userId: "u1",
    nota: 8,
    meGusta: false,
    spoilers: false,
    texto: "Muy buena",
    titulo: "Dune",
    anio: 2024,
    ...over,
});
const guild = { members: { cache: new Map([["u1", { displayName: "Ana" }]]) } };
const ctx = { guildId: "g", guild, userId: "u9", channelId: "c" };

function dobles(over = {}) {
    return {
        plexResenas: {
            publicasDe: jest.fn(() => []),
            titulosLlamados: jest.fn(() => []),
            titulo: jest.fn(() => ({ media: null, votos: 0, resenas: [] })),
            mejores: jest.fn(() => []),
        },
        resolveNameToDiscordId: jest.fn(() => null),
        minVotosResenas: jest.fn(() => 3),
        ...over,
    };
}

describe("consultar_resenas_plex", () => {
    test("sin servidor no consulta nada", () => {
        const d = dobles();
        expect(plex.consultar_resenas_plex({}, { userId: "u9" }, d)).toEqual({ error: "Solo disponible en servidores." });
        expect(d.plexResenas.mejores).not.toHaveBeenCalled();
    });

    test("sin persona ni título devuelve las mejor valoradas, con el mínimo de votos del servidor", () => {
        const d = dobles();
        d.plexResenas.mejores.mockReturnValueOnce([{ titulo: "Dune", anio: 2024, media: 4.5, votos: 4, clave: "peli:x", extra: 1 }]);
        expect(plex.consultar_resenas_plex({}, ctx, d)).toEqual({
            mejores_valoradas: [{ titulo: "Dune", anio: 2024, media: 4.5, votos: 4 }],
        });
        expect(d.plexResenas.mejores).toHaveBeenCalledWith("g", { minVotos: 3, limite: 5 });
    });

    test("una persona que no se identifica no da ningún id: error y no se consultan reseñas", () => {
        const d = dobles();
        expect(plex.consultar_resenas_plex({ persona: "Fulanito" }, ctx, d)).toEqual({
            error: 'No identifico a "Fulanito" entre los miembros del server.',
        });
        expect(d.plexResenas.publicasDe).not.toHaveBeenCalled();
    });

    test("una persona sin reseñas públicas (o que las oculta) no revela nada más", () => {
        const d = dobles({ resolveNameToDiscordId: jest.fn(() => "u1") });
        expect(plex.consultar_resenas_plex({ persona: "Ana" }, ctx, d)).toEqual({ persona: "Ana", sin_resenas: true });
    });

    test("las reseñas de una persona: el texto con spoilers no sale, el resto sí", () => {
        const d = dobles({ resolveNameToDiscordId: jest.fn(() => "u1") });
        d.plexResenas.publicasDe.mockReturnValueOnce([
            resena({ spoilers: true, texto: "Final con spoilers: muere X" }),
            resena({ nota: 5, spoilers: false, texto: null, meGusta: true }),
        ]);
        const r = plex.consultar_resenas_plex({ persona: "Ana" }, ctx, d);
        expect(d.plexResenas.publicasDe).toHaveBeenCalledWith("g", "u1");
        expect(r.resenas[0]).toEqual({
            de: "Ana",
            media: 4,
            me_gusta: false,
            spoilers: true,
            texto: "(tiene spoilers: el texto no se cuenta)",
        });
        expect(JSON.stringify(r)).not.toContain("muere X");
        expect(r.resenas[1]).toMatchObject({ media: 2.5, me_gusta: true, texto: null });
    });

    test("un título sin reseñas públicas dice que no hay, sin inventar", () => {
        const d = dobles();
        expect(plex.consultar_resenas_plex({ titulo: "Inventada" }, ctx, d)).toEqual({
            error: "No hay reseñas públicas de «Inventada» en el servidor.",
        });
        expect(d.plexResenas.titulo).not.toHaveBeenCalled();
    });

    test("con varios años del mismo título gana el que tiene más votos; anio filtra", () => {
        const d = dobles();
        d.plexResenas.titulosLlamados.mockReturnValueOnce([
            { clave: "peli:dune|2021", titulo: "Dune", anio: 2021 },
            { clave: "peli:dune|2024", titulo: "Dune", anio: 2024 },
        ]);
        d.plexResenas.titulo.mockImplementation((g, clave) =>
            clave.endsWith("2024")
                ? { media: 4.2, votos: 5, resenas: [resena({ userId: "u1", texto: "Buena" })] }
                : { media: 3, votos: 1, resenas: [] },
        );
        const r = plex.consultar_resenas_plex({ titulo: "dune" }, ctx, d);
        expect(r).toMatchObject({ titulo: "Dune", anio: 2024, media: 4.2, votos: 5 });
        expect(r.resenas).toEqual([{ de: "Ana", media: 4, me_gusta: false, spoilers: false, texto: "Buena" }]);

        d.plexResenas.titulosLlamados.mockReturnValueOnce([{ clave: "peli:dune|2021", titulo: "Dune", anio: 2021 }]);
        expect(plex.consultar_resenas_plex({ titulo: "Dune", anio: 2024 }, ctx, d)).toEqual({
            error: "No hay reseñas públicas de «Dune» en el servidor.",
        });
    });

    test("quien escribió la reseña y no está en el servidor sale como «alguien»", () => {
        const d = dobles();
        d.plexResenas.titulosLlamados.mockReturnValueOnce([{ clave: "peli:x|2024", titulo: "Dune", anio: 2024 }]);
        d.plexResenas.titulo.mockReturnValueOnce({ media: 4, votos: 1, resenas: [resena({ userId: "u7" })] });
        expect(plex.consultar_resenas_plex({ titulo: "Dune" }, ctx, d).resenas[0].de).toBe("alguien");
    });
});
