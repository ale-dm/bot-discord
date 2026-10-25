// 📊 Mi cine (#574): las cifras de systems/plexResenas/miCine (reseñas, lo que más ves, rachas y el año en curso), la
// pantalla y sus botones en /plex → ⭐ Reseñas. BD en memoria con fichas, historial y reseñas puestos a mano; el año en
// curso se fija con `ahora` (24-10-2026). Sin Discord, sin Tautulli y sin dibujar imágenes (graficoPersonal se inyecta).
const db = require("../src/core/db");
const plexLinks = require("../src/systems/plexLinks");
const plexResenas = require("../src/systems/plexResenas");
const trofeosGestion = require("../src/systems/plexTrofeos/gestion");
const miCine = require("../src/systems/plexResenas/miCine");
const { pantallaMiCine } = require("../src/paneles/plexMiCine");
const { pantallaResenas } = require("../src/paneles/plexResenas");
const { handleButton } = require("../src/commands/plex/resenas");

const G = "guild-mi-cine";
const AHORA = Date.UTC(2026, 9, 24, 12); // 24-10-2026, 14:00 en Madrid
let filaId = 1;

const unix = (dia, hora = 20) => Date.parse(`${dia}T${String(hora).padStart(2, "0")}:00:00Z`) / 1000;

function ficha(f) {
    db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, temporadas, encontrada, actualizada)
         VALUES (?, ?, ?, ?, ?, '1', 'Plex', ?, '[]', '[]', ?, 1, ?)`,
    ).run(G, f.key, f.tipo || "movie", f.titulo, f.anio, JSON.stringify(f.generos), f.temporadas ? JSON.stringify(f.temporadas) : null, 1);
}

function ver(user, dia, f) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio, inicio, segundos, porcentaje, visto)
         VALUES (@g, @id, @user, @tipo, @rating_key, @serie_key, @titulo, @serie, @temporada, @episodio, @anio, @inicio, @segundos, 100, 1)`,
    ).run({
        g: G,
        id: filaId++,
        user: String(user),
        tipo: "movie",
        rating_key: null,
        serie_key: null,
        titulo: null,
        serie: null,
        temporada: null,
        episodio: null,
        anio: null,
        segundos: 3600,
        inicio: unix(dia),
        ...f,
    });
}
const verPeli = (user, dia, key, titulo, anio) => ver(user, dia, { rating_key: key, titulo, anio, segundos: 7200 });
const verEp = (user, dia, ep) =>
    ver(user, dia, { tipo: "episode", rating_key: `dark-1-${ep}`, serie_key: "dark", serie: "Dark", temporada: 1, episodio: ep });

function resena(userId, clave, { tipo = "movie", titulo, anio = null, nota, meGusta = 0, oculto = 0, creado }) {
    db.prepare(
        `INSERT INTO plex_resenas (guildId, userId, clave, tipo, titulo, anio, nota, me_gusta, oculto, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(G, userId, clave, tipo, titulo, anio, nota, meGusta, oculto, unix(creado), unix(creado));
}

beforeAll(() => {
    plexLinks.setLink(G, "u1", "1", "uno");
    plexLinks.setLink(G, "u2", "2", "dos");
    plexLinks.setLink(G, "u3", "3", "tres");
    ficha({ key: "alien", titulo: "Alien", anio: 1979, generos: ["Ciencia ficción", "Terror"] });
    ficha({ key: "heat", titulo: "Heat", anio: 1995, generos: ["Acción", "Crimen"] });
    ficha({ key: "arrival", titulo: "Arrival", anio: 2016, generos: ["Ciencia ficción", "Drama"] });
    ficha({ key: "dark", tipo: "show", titulo: "Dark", anio: 2017, generos: ["Ciencia ficción", "Misterio"], temporadas: { 1: [1, 2] } });

    // u1: una racha de 5 días en 2025 y la actual de 3 (22, 23 y 24 de octubre de 2026).
    verPeli(1, "2025-03-01", "alien", "Alien", 1979);
    verPeli(1, "2025-03-02", "heat", "Heat", 1995);
    for (const dia of ["2025-03-03", "2025-03-04", "2025-03-05"]) verPeli(1, dia, "alien", "Alien", 1979);
    verPeli(1, "2026-10-22", "arrival", "Arrival", 2016);
    verEp(1, "2026-10-23", 1);
    verEp(1, "2026-10-24", 2);
    // u2: 2 días seguidos. u3: 4, pero oculta sus logros de Plex (no cuenta en la media del servidor).
    for (const dia of ["2026-05-01", "2026-05-02"]) verPeli(2, dia, "alien", "Alien", 1979);
    for (const dia of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]) verPeli(3, dia, "heat", "Heat", 1995);
    trofeosGestion.setOculto(G, "u3", true);

    resena("u1", plexResenas.clavePeli("Alien", 1979), { titulo: "Alien", anio: 1979, nota: 10, meGusta: 1, creado: "2025-03-01" });
    resena("u1", plexResenas.clavePeli("Heat", 1995), { titulo: "Heat", anio: 1995, nota: 4, creado: "2026-02-01" });
    resena("u1", plexResenas.clavePeli("Arrival", 2016), { titulo: "Arrival", anio: 2016, nota: 10, creado: "2026-10-22" });
    resena("u1", plexResenas.claveSerie("Dark", 1), {
        tipo: "show",
        titulo: "Dark · temporada 1",
        nota: 7,
        oculto: 1,
        creado: "2026-10-24",
    });
    resena("u2", plexResenas.clavePeli("Alien", 1979), { titulo: "Alien", anio: 1979, nota: 6, creado: "2026-05-02" });
    // u3 oculta todas sus reseñas: no cuentan en la media del servidor.
    resena("u3", plexResenas.clavePeli("Alien", 1979), { titulo: "Alien", anio: 1979, nota: 2, creado: "2026-06-01" });
    plexResenas.setOculto(G, "u3", true);
});

describe("los cálculos de Mi cine (#574)", () => {
    test("cuenta todas tus reseñas (también las que ocultas) y la media que das", () => {
        const { resenas } = miCine.calcular(G, "u1", { ahora: AHORA });
        expect(resenas).toMatchObject({ total: 4, peliculas: 3, series: 1, media: 3.9 });
    });

    test("la mejor película desempata por ❤️ y la peor es la de menos nota", () => {
        const { resenas } = miCine.calcular(G, "u1", { ahora: AHORA });
        expect(resenas.mejor).toEqual({ titulo: "Alien", anio: 1979, nota: 10, meGusta: true });
        expect(resenas.peor).toMatchObject({ titulo: "Heat", nota: 4 });
    });

    test("con todas las películas con la misma nota no hay peor", () => {
        const r = miCine.resumenResenas([
            { tipo: "movie", titulo: "A", nota: 8, actualizado_en: 1 },
            { tipo: "movie", titulo: "B", nota: 8, actualizado_en: 2 },
        ]);
        expect(r.mejor.titulo).toBe("B");
        expect(r.peor).toBeNull();
    });

    test("sin reseñas no hay media ni mejor ni peor", () => {
        expect(miCine.resumenResenas([])).toEqual({ total: 0, peliculas: 0, series: 0, media: null, mejor: null, peor: null });
    });

    test("la media del servidor no cuenta las reseñas ocultas de nadie", () => {
        // Públicas: u1 10, 4 y 10 (la de Dark la oculta) y u2 6 → 7,5 / 2 = 3,75. u3 lo oculta todo.
        expect(miCine.calcular(G, "u2", { ahora: AHORA }).servidor).toEqual({ media: 3.8, votos: 4 });
    });

    test("el género y la década que más ves suman películas y series, una vez por título", () => {
        const { gustos } = miCine.calcular(G, "u1", { ahora: AHORA });
        // Ciencia ficción: Alien, Arrival y Dark. Década de 2010: Arrival (2016) y Dark (2017).
        expect(gustos.genero).toEqual({ nombre: "Ciencia ficción", n: 3 });
        expect(gustos.decada).toEqual({ decada: 2010, n: 2 });
    });

    test("con empate de década gana la más reciente; con empate de género, el primero por orden alfabético", () => {
        const g = miCine.loQueMasVes({
            porGenero: new Map([
                ["terror", { nombre: "Terror", n: 2 }],
                ["drama", { nombre: "Drama", n: 2 }],
            ]),
            porDecada: new Map([
                [1990, 1],
                [2000, 1],
            ]),
            series: [],
        });
        expect(g.genero.nombre).toBe("Drama");
        expect(g.decada.decada).toBe(2000);
    });

    test("la racha actual sigue viva si ayer viste algo y hoy todavía no", () => {
        expect(miCine.rachaActual(["2026-10-22", "2026-10-23"], "2026-10-24")).toBe(2);
        expect(miCine.rachaActual(["2026-10-22", "2026-10-24", "2026-10-24"], "2026-10-24")).toBe(1);
        expect(miCine.rachaActual(["2026-10-21", "2026-10-22"], "2026-10-24")).toBe(0);
    });

    test("tu racha (la actual y la mejor) frente a la media de la mejor racha del servidor", () => {
        const { racha } = miCine.calcular(G, "u1", { ahora: AHORA });
        // u1 5 y u2 2; u3 oculta sus logros y no cuenta.
        expect(racha).toEqual({ actual: 3, mejor: 5, servidor: { media: 3.5, personas: 2 } });
    });

    test("el año en curso: reseñas escritas este año, horas, películas, episodios, series y la mejor racha del año", () => {
        const { anio } = miCine.calcular(G, "u1", { ahora: AHORA });
        expect(anio).toMatchObject({ anio: "2026", resenas: 3, media: 3.5, horas: 4, peliculas: 1, episodios: 2, racha: 3 });
        expect(anio.mejor.titulo).toBe("Arrival");
        expect(anio.series).toEqual([{ nombre: "Dark", horas: 2 }]);
    });

    test("el año en curso va por la hora de Madrid", () => {
        // 31-12-2026 a las 23:30 UTC ya es 1-1-2027 en Madrid.
        expect(miCine.anioEnCurso(Date.UTC(2026, 11, 31, 23, 30)).periodo).toMatchObject({ mes: "2027", inicio: "2027-01-01" });
    });

    test("sin cuenta de Plex vinculada solo salen las reseñas", () => {
        const d = miCine.calcular(G, "nadie", { ahora: AHORA });
        expect(d).toMatchObject({ vinculado: false, gustos: null, racha: null });
        expect(d.resenas.total).toBe(0);
        expect(d.anio).toEqual({ anio: "2026", resenas: 0, media: null, mejor: null });
    });

    test("la media de racha del servidor deja fuera a quien no ha visto nada", () => {
        const d = {
            getLinks: () => [
                { discordUserId: "a", tautulliUserId: "1" },
                { discordUserId: "b", tautulliUserId: "2" },
            ],
            logrosOcultos: () => false,
            mejorRacha: (g, t) => (t === "1" ? 4 : 0),
        };
        expect(miCine.rachaServidor(G, d)).toEqual({ media: 4, personas: 1 });
    });
});

describe("la imagen del año (#574)", () => {
    test("reutiliza la imagen del Wrapped con el periodo del año en curso", () => {
        const graficoPersonal = jest.fn(() => Buffer.from("png"));
        const r = miCine.imagenDelAnio(G, "u1", { ahora: AHORA, deps: { graficoPersonal } });
        expect(r.ok).toBe(true);
        expect(graficoPersonal.mock.calls[0][0]).toMatchObject({ mes: "2026", etiqueta: "2026 (hasta hoy)", horas: 4 });
    });

    test("sin series vistas este año no hay imagen y se explica por qué", () => {
        const r = miCine.imagenDelAnio(G, "u2", { ahora: AHORA, deps: { graficoPersonal: () => null } });
        expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/series/) });
    });

    test("sin cuenta vinculada no hay imagen", () => {
        expect(miCine.imagenDelAnio(G, "nadie", { ahora: AHORA }).ok).toBe(false);
    });
});

describe("la pantalla y los botones (#574)", () => {
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

    test("la pantalla de reseñas lleva 📊 Mi cine en la fila de vistas (5 botones, el máximo)", () => {
        const fila = pantallaResenas(G, "u1").components[0].toJSON().components;
        expect(fila).toHaveLength(5);
        expect(fila.map((c) => c.custom_id)).toContain("plex_resenas_cine");
    });

    test("Mi cine enseña las cifras, compara con el servidor y ofrece la imagen del año", () => {
        const p = pantallaMiCine(miCine.calcular(G, "u1", { ahora: AHORA }));
        const texto = p.embeds[0]
            .toJSON()
            .fields.map((f) => `${f.name}\n${f.value}`)
            .join("\n");
        expect(texto).toContain("**4** reseñas");
        expect(texto).toContain("**3,9 ★**");
        expect(texto).toContain("0,1 ★ más alto que la media del servidor (**3,8 ★**");
        expect(texto).toContain("Tu mejor película: **Alien** (1979)");
        expect(texto).toContain("Tu peor película: **Heat** (1995)");
        expect(texto).toContain("Género: **Ciencia ficción** (3 títulos)");
        expect(texto).toContain("Década: **2010–2019** (2 títulos)");
        expect(texto).toContain("Ahora: **3 días** seguidos · tu mejor: **5 días**");
        expect(texto).toContain("**3,5 días** de mejor racha (2 personas)");
        expect(texto).toContain("Tu 2026 hasta hoy");
        expect(ids(p)).toEqual(["plex_resenas_mias", "plex_resenas_cine_imagen"]);
    });

    test("sin series este año no se ofrece la imagen; sin vincular, se explica qué falta", () => {
        expect(ids(pantallaMiCine(miCine.calcular(G, "u2", { ahora: AHORA })))).toEqual(["plex_resenas_mias"]);
        const p = pantallaMiCine(miCine.calcular(G, "nadie", { ahora: AHORA }));
        expect(p.embeds[0].toJSON().fields.map((f) => f.name)).toContain("🔗 Plex");
        expect(ids(p)).toEqual(["plex_resenas_mias"]);
    });

    const interaccion = (customId, userId) => ({
        customId,
        guildId: G,
        user: { id: userId },
        deferUpdate: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    });

    test("el botón 📊 Mi cine confirma primero y repinta la misma pantalla", async () => {
        const i = interaccion("plex_resenas_cine", "u1");
        await handleButton({}, i);
        expect(i.deferUpdate).toHaveBeenCalledTimes(1);
        expect(i.editReply.mock.calls[0][0].embeds[0].toJSON().title).toBe("📊 Mi cine");
    });

    test("la imagen del año sin cuenta vinculada contesta aparte y en privado, sin adjunto", async () => {
        const i = interaccion("plex_resenas_cine_imagen", "nadie");
        await handleButton({}, i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
        expect(i.editReply.mock.calls[0][0]).toEqual({ content: expect.stringMatching(/no está vinculada/) });
    });
});
