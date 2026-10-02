// 🍿 Trofeos de Plex con un servidor del tamaño del de verdad (12 vinculados, 3.000 películas, 300 series, ~60.000
// reproducciones): el cálculo de cada sincronización (cada 30 min) tarda poco, la primera vez crea cientos de trofeos y
// lo anuncia en un mensaje por persona que cabe en Discord, y la segunda vez no hace nada nuevo.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const plexHistorial = require("../src/systems/plexHistorial");

const G = "guild-carga";
const USUARIOS = 12;
const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
const guild = { id: G, name: G, channels: { cache: new Map([["c", canal]]), fetch: async () => null } };

beforeAll(() => {
    delete process.env.GOOGLE_API_KEY;
    guildSettings.setSetting(G, "logros.notify_channel_id", "c");
    const ficha = db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, anio, section_id, biblioteca, generos, directores, colecciones, temporadas, actualizada)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ver = db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, anio, inicio, segundos, visto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2400, 1)`,
    );
    const generos = ["Drama", "Comedia", "Terror", "Acción", "Ciencia ficción", "Animación"];
    let id = 1;
    db.transaction(() => {
        for (let p = 0; p < 3000; p++) {
            const anime = p % 15 === 0;
            ficha.run(
                G,
                `m${p}`,
                "movie",
                `Película ${p}`,
                1950 + (p % 75),
                anime ? "4" : "1",
                anime ? "Películas Anime" : "Películas",
                JSON.stringify([generos[p % 6], generos[(p + 1) % 6]]),
                JSON.stringify([`Director ${p % 400}`]),
                JSON.stringify(p % 10 === 0 ? [`Saga ${p % 150}`] : []),
                null,
                Date.now(),
            );
        }
        for (let s = 0; s < 300; s++) {
            const anime = s % 4 === 0;
            const temporadas = {
                1: [...Array(10).keys()].map((e) => e + 1),
                2: [...Array(10).keys()].map((e) => e + 1),
                3: [...Array(8).keys()].map((e) => e + 1),
            };
            ficha.run(
                G,
                `s${s}`,
                "show",
                `Serie ${s}`,
                2000 + (s % 25),
                anime ? "3" : "2",
                anime ? "Anime" : "Series",
                "[]",
                "[]",
                "[]",
                JSON.stringify(temporadas),
                Date.now(),
            );
        }
        for (let u = 1; u <= USUARIOS; u++) {
            // Cada uno ve un tercio de las películas y unas cuantas series (enteras, a medias o empezadas).
            for (let p = u % 3; p < 3000; p += 3)
                ver.run(
                    G,
                    id++,
                    String(u),
                    "movie",
                    `m${p}`,
                    null,
                    `Película ${p}`,
                    null,
                    null,
                    null,
                    1950 + (p % 75),
                    1_700_000_000 + id * 60,
                );
            for (let s = u; s < 300; s += 3) {
                const hasta = s % 3 === 0 ? 3 : s % 3 === 1 ? 1 : 0;
                for (let t = 1; t <= 3; t++)
                    for (let e = 1; e <= (t === 3 ? 8 : 10); e++)
                        if (t <= hasta || e <= 2)
                            ver.run(
                                G,
                                id++,
                                String(u),
                                "episode",
                                `s${s}-${t}-${e}`,
                                `s${s}`,
                                `Episodio ${e}`,
                                `Serie ${s}`,
                                t,
                                e,
                                null,
                                1_700_000_000 + id * 60,
                            );
            }
        }
        db.prepare("INSERT INTO plex_sync (guildId, ultimo_inicio, biblioteca_revisada) VALUES (?, 0, ?)").run(G, Date.now());
    })();
    for (let u = 1; u <= USUARIOS; u++) plexLinks.setLink(G, `disc-${u}`, String(u), `u${u}`);
});

test("la primera vez: cientos de trofeos, rápido, y un anuncio por persona que cabe en Discord", async () => {
    const reproducciones = db.prepare("SELECT COUNT(*) AS n FROM plex_reproducciones WHERE guildId = ?").get(G).n;
    expect(reproducciones).toBeGreaterThan(20000);
    const t0 = Date.now();
    const r = await plexHistorial.actualizarLogros(guild);
    const ms = Date.now() - t0;
    const trofeos = db.prepare("SELECT tipo, COUNT(*) AS n FROM plex_trofeos WHERE guildId = ? GROUP BY tipo").all(G);
    // En local, ~1 s con ~30.000 reproducciones; el margen es para máquinas lentas.
    expect(ms).toBeLessThan(20000);
    expect(trofeos.find((t) => t.tipo === "serie").n).toBeGreaterThan(50);
    expect(trofeos.find((t) => t.tipo === "temporada").n).toBeGreaterThan(50);
    expect(r.every((x) => x.desbloqueados.length > 0)).toBe(true);
    expect(canal.send).toHaveBeenCalledTimes(USUARIOS);
    for (const [m] of canal.send.mock.calls) expect(m.content.length).toBeLessThan(2000);
});

test("la segunda vez, sin nada nuevo, no anuncia nada y también va rápido", async () => {
    canal.send.mockClear();
    const t0 = Date.now();
    const r = await plexHistorial.actualizarLogros(guild);
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(r.every((x) => x.desbloqueados.length === 0)).toBe(true);
    expect(canal.send).not.toHaveBeenCalled();
});

test("con el idioma de todo lo visto: trofeos por idioma para todos, rápido y cabiendo en Discord", async () => {
    // Un reparto de versiones: inglés con y sin subtítulos, castellano y japonés con subtítulos.
    const versiones = [
        ["en", "es"],
        ["en", "no"],
        ["es", "no"],
        ["ja", "es"],
        ["ja", "en"],
    ];
    db.transaction(() => {
        const poner = db.prepare(
            "UPDATE plex_reproducciones SET audio = ?, subs = ?, idioma_revisado = 1 WHERE guildId = ? AND tautulliUserId = ?",
        );
        for (let u = 1; u <= USUARIOS; u++) poner.run(...versiones[u % versiones.length], G, String(u));
    })();
    canal.send.mockClear();
    const t0 = Date.now();
    const r = await plexHistorial.actualizarLogros(guild);
    expect(Date.now() - t0).toBeLessThan(20000);
    // Todos tienen algún logro de idioma (los contadores); las series enteras en un idioma, quien termina series (los
    // usuarios múltiplos de 3 en estos datos).
    const deIdioma = new Set(require("../src/systems/plexIdiomas").LOGROS.map(([id]) => id));
    expect(r.every((x) => x.desbloqueados.some((a) => deIdioma.has(a.id)))).toBe(true);
    for (const x of r.filter((y) => Number(y.discordUserId.split("-")[1]) % 3 === 0))
        expect(x.desbloqueados.some((a) => a.id.startsWith("plext:idioma:"))).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM plex_trofeos WHERE guildId = ? AND tipo = 'idioma'").get(G).n).toBeGreaterThan(50);
    expect(canal.send).toHaveBeenCalledTimes(USUARIOS);
    for (const [m] of canal.send.mock.calls) expect(m.content.length).toBeLessThan(2000);
});
