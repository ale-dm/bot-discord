// 🔍 Diagnóstico de Plex contra un Tautulli de mentira por HTTP (el cliente real, con axios y las respuestas con la forma
// de Tautulli): Panel admin → Plex → 🏆 Trofeos → 🔍 Idiomas (F-PX-07) y `npm run plex:check` (F-PX-06), este último
// ejecutando el script de verdad en otro proceso y comprobando que no toca la BD.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const Database = require("better-sqlite3");
const { db, nuevoGuild, vincular } = require("./ayudaPlex");
const { runMigrations } = require("../src/core/migrations");
const plexDiagnostico = require("../src/systems/plexDiagnostico");
const { handlePlexButton } = require("../src/adminPanel/plex");

const CLAVE = "clave-diagnostico";
const AHORA = Math.floor(Date.now() / 1000);
const modo = { pagina: true };

// 30 reproducciones de las últimas horas: 20 películas y 10 episodios de la serie 500 (T1E1…T1E10). Las de k % 3 = 0
// son de Luis (2) y el resto de Ana (1). Idiomas: la 105 sin datos, las 109, 119 y 129 en klingon (no se reconoce).
const HISTORIAL = Array.from({ length: 30 }, (_, k) => ({
    row_id: 100 + k,
    user_id: k % 3 === 0 ? 2 : 1,
    friendly_name: k % 3 === 0 ? "Luis" : "Ana",
    media_type: k < 20 ? "movie" : "episode",
    rating_key: String(1000 + k),
    grandparent_rating_key: k < 20 ? "" : "500",
    grandparent_title: k < 20 ? "" : "Dark",
    parent_media_index: k < 20 ? "" : 1,
    media_index: k < 20 ? "" : k - 19,
    title: `Cosa ${k}`,
    date: AHORA - k * 3600,
    started: AHORA - k * 3600,
    play_duration: 3000,
    watched_status: 1,
}));
function streamData(id) {
    const k = id - 100;
    if (k === 5) return null;
    if (k % 10 === 9)
        return { stream_audio_language: "Klingon", stream_audio_language_code: "tlh", subtitles: 1, stream_subtitle_language: "Élfico" };
    if (k % 2 === 0)
        return {
            stream_audio_language: "English",
            stream_audio_language_code: "eng",
            subtitles: 1,
            stream_subtitle_language: "Spanish",
            stream_subtitle_forced: 0,
        };
    return { audio_language: "Español (España)", audio_language_code: "spa", subtitles: 0 };
}
const ok = (data) => ({ response: { result: "success", message: null, data } });
const fallo = (message) => ({ response: { result: "error", message, data: {} } });
function responder(q) {
    if (q.apikey !== CLAVE) return fallo("Invalid apikey");
    switch (q.cmd) {
        case "get_users":
            return ok([
                { user_id: 0, username: "Local" },
                { user_id: 1, username: "ana" },
                { user_id: 2, username: "luis" },
            ]);
        case "get_libraries":
            return ok([
                { section_id: "1", section_name: "Películas", section_type: "movie", count: "120" },
                { section_id: "2", section_name: "Series", section_type: "show", count: "3" },
                { section_id: "3", section_name: "Anime", section_type: "show", count: "2" },
                { section_id: "4", section_name: "Música", section_type: "artist", count: "50" },
            ]);
        case "get_library_media_info": {
            const todas = Array.from({ length: 120 }, (_, i) => ({ rating_key: String(5000 + i), title: `Peli ${i}`, year: "2000" }));
            const start = modo.pagina ? Number(q.start) : 0;
            return ok({ recordsFiltered: 120, recordsTotal: "120", data: todas.slice(start, start + Number(q.length)) });
        }
        case "get_history": {
            const desde = q.after ? Date.parse(`${q.after}T00:00:00Z`) / 1000 : 0;
            const filas = HISTORIAL.filter((r) => r.date >= desde);
            const start = Number(q.start || 0);
            return ok({ recordsFiltered: filas.length, data: filas.slice(start, start + Number(q.length || 25)) });
        }
        case "get_stream_data": {
            const d = streamData(Number(q.row_id));
            return d ? ok(d) : fallo("No data");
        }
        case "get_children_metadata": {
            const hijos = {
                "500|show": [
                    { rating_key: "50", media_index: "0" },
                    { rating_key: "501", media_index: "1" },
                ],
                "501|season": Array.from({ length: 10 }, (_, i) => ({ media_index: String(i + 1), added_at: "1780000000" })),
            }[`${q.rating_key}|${q.media_type}`];
            return ok({ children_count: hijos?.length || 0, children_list: hijos || [] });
        }
        case "get_user_watch_time_stats": {
            const total = HISTORIAL.filter((r) => String(r.user_id) === String(q.user_id)).reduce((s, r) => s + r.play_duration, 0);
            return ok([{ query_days: 7, total_time: total, total_plays: 20 }]);
        }
        default:
            return fallo(`Unknown command ${q.cmd}`);
    }
}

let servidor;
let URL_TAUTULLI;
beforeAll(async () => {
    servidor = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(responder(Object.fromEntries(u.searchParams))));
    });
    await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
    URL_TAUTULLI = `http://127.0.0.1:${servidor.address().port}`;
    process.env.TAUTULLI_URL = URL_TAUTULLI;
    process.env.TAUTULLI_API_KEY = CLAVE;
});
afterAll(async () => {
    delete process.env.TAUTULLI_URL;
    delete process.env.TAUTULLI_API_KEY;
    await new Promise((r) => servidor.close(r));
});
beforeEach(() => {
    modo.pagina = true;
});

describe("la comprobación de los supuestos (F-PX-06)", () => {
    test("contra un Tautulli que cumple todo: cada paso dice lo que ha visto", async () => {
        const pasos = await plexDiagnostico.comprobar(null, { muestra: 20 });
        const por = Object.fromEntries(pasos.map((p) => [p.paso, p]));
        expect(pasos.map((p) => [p.paso, p.ok])).toEqual([
            ["Conexión", true],
            ["Bibliotecas y anime", true],
            ["Paginación de las bibliotecas de películas", true],
            ["Idiomas (las últimas 20 reproducciones)", true],
            ["Ficha de una serie (temporadas y episodios)", true],
            ["Horas: historial contra las estadísticas de Tautulli (últimos 7 días)", true],
        ]);
        expect(por["Conexión"].lineas).toEqual(["2 usuarios en Tautulli"]);
        expect(por["Bibliotecas y anime"].lineas).toEqual(
            expect.arrayContaining(["🎌 Anime (series, 2) · id 3", "   Series (series, 3) · id 2"]),
        );
        expect(por["Paginación de las bibliotecas de películas"].lineas[0]).toBe(
            "Películas: página 1 con 50, página 2 con 50 (0 repetidas) · total 120 de 120",
        );
        const idiomas = por["Idiomas (las últimas 20 reproducciones)"].lineas;
        expect(idiomas).toEqual(
            expect.arrayContaining([
                "10 × audio en · subtítulos es",
                "7 × audio es · subtítulos no",
                "2 × audio otro · subtítulos otro",
                "1 sin datos de Tautulli (normal en lo muy antiguo)",
                'No reconocido: audio "tlh / Klingon" (2)',
                'No reconocido: subtítulos "Élfico" (2)',
            ]),
        );
        expect(por["Ficha de una serie (temporadas y episodios)"].lineas).toEqual(
            expect.arrayContaining([
                "El episodio del historial (T1E1) está en su temporada: cuadra",
                'Fecha de llegada a Plex (added_at) en 10 de 10 episodios (para "Sin spoilers" y "Primero del servidor")',
            ]),
        );
        expect(por["Horas: historial contra las estadísticas de Tautulli (últimos 7 días)"].lineas[0]).toBe(
            "Ana: 16.7 h sumando el historial · 16.7 h según Tautulli (0 % de diferencia)",
        );
    });

    test("si la lista de películas no pagina, lo dice; las bibliotecas de anime elegidas a mano cuentan", async () => {
        modo.pagina = false;
        const pasos = await plexDiagnostico.comprobar(null, { muestra: 5, bibliotecasAnime: "2" });
        const pag = pasos.find((p) => p.paso.startsWith("Paginación"));
        expect(pag.ok).toBe(false);
        expect(pag.lineas[1]).toBe("No pagina como se espera: mirar revisarBiblioteca en plexFichas.js");
        const libs = pasos.find((p) => p.paso === "Bibliotecas y anime").lineas;
        expect(libs).toEqual(
            expect.arrayContaining(["🎌 Series (series, 3) · id 2", "   Anime (series, 2) · id 3", "Anime: las bibliotecas 2"]),
        );
    });

    test("con Tautulli caído, cada paso falla por su cuenta y no se rompe nada", async () => {
        process.env.TAUTULLI_URL = "http://127.0.0.1:1";
        try {
            const pasos = await plexDiagnostico.comprobar(null, { muestra: 5 });
            expect(pasos[0]).toMatchObject({ paso: "Conexión", ok: false, lineas: [expect.stringMatching(/^Error: /)] });
            expect(pasos).toHaveLength(6);
        } finally {
            process.env.TAUTULLI_URL = URL_TAUTULLI;
        }
    });
});

describe("Panel admin → Plex → 🏆 Trofeos → 🔍 Idiomas (F-PX-07)", () => {
    const G = nuevoGuild("guild-diag");
    const guardar = (id, user, audio, subs, revisado = 1) =>
        db
            .prepare(
                `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, inicio, segundos, visto, audio, subs, idioma_revisado)
                 VALUES (?, ?, ?, 'movie', ?, 3600, 1, ?, ?, ?)`,
            )
            .run(G, id, String(user), AHORA - id, audio, subs, revisado);
    beforeAll(() => {
        vincular(G, 1, 2);
        guardar(100, 1, "en", "es");
        guardar(102, 1, "en", "es");
        guardar(101, 2, "es", "no");
        guardar(109, 1, "otro", "otro"); // klingon con subtítulos en élfico
        guardar(119, 2, "otro", "otro");
        guardar(105, 1, null, null); // revisada, sin datos
        guardar(103, 1, null, null, 0); // pendiente
        guardar(200, 9, "otro", "no"); // alguien sin vincular: no cuenta
    });

    test("cuántas de cada audio y subtítulo, de lo visto por los vinculados", () => {
        expect(plexDiagnostico.idiomasGuardados(G)).toEqual({
            revisadas: 6,
            pendientes: 1,
            sinDato: 1,
            audio: { en: 2, es: 1, otro: 2 },
            subs: { es: 2, no: 1, otro: 2 },
        });
    });

    test("los nombres que no se reconocen, preguntando a Tautulli por los 'otro'", async () => {
        const r = await plexDiagnostico.noReconocidos(G);
        expect(r.revisadas).toBe(2);
        expect([...r.audio]).toEqual([["tlh / Klingon", 2]]);
        expect([...r.subs]).toEqual([["Élfico", 2]]);
    });

    test("el botón lo enseña en privado", async () => {
        const i = {
            customId: "paneladmin_plex_idiomas",
            guildId: G,
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
        expect(await handlePlexButton(i)).toBe(true);
        expect(i.deferReply.mock.calls[0][0].flags).toBeDefined();
        const embed = i.editReply.mock.calls[0][0].embeds[0].toJSON();
        const campos = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
        expect(embed.description).toBe(
            "De lo visto por los vinculados: **6** revisadas · **1** pendientes · **1** sin dato (Tautulli no lo tiene: normal en lo muy antiguo).",
        );
        expect(campos["🔊 Audio"]).toBe("🇬🇧 inglés: **2** (40 %)\n❓ otro: **2** (40 %)\n🇪🇸 castellano: **1** (20 %)");
        expect(campos["❓ Nombres que no se reconocen (últimas 15)"]).toBe('audio "tlh / Klingon" (2)\nsubtítulos "Élfico" (2)');
    });

    test("sin nada raro, o con Tautulli caído, lo dice", async () => {
        const g = nuevoGuild("guild-diag");
        vincular(g, 1);
        expect((await require("../src/adminPanel/plex").buildDiagnosticoIdiomas(g)).embeds[0].toJSON().fields[2].value).toBe(
            'Ninguna reproducción con un idioma "otro".',
        );
        process.env.TAUTULLI_URL = "http://127.0.0.1:1";
        try {
            const campo = (await require("../src/adminPanel/plex").buildDiagnosticoIdiomas(G)).embeds[0].toJSON().fields[2].value;
            expect(campo).toBe("No se pudo preguntar a Tautulli.");
        } finally {
            process.env.TAUTULLI_URL = URL_TAUTULLI;
        }
    });
});

describe("npm run plex:check (el script, en otro proceso)", () => {
    const script = path.join(__dirname, "..", "scripts", "plex-check.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plex-check-"));
    const bd = path.join(dir, "banco.db");
    // El script, sin la configuración de Tautulli del entorno de los tests (solo la de la BD que se le pase).
    const ejecutar = (...args) =>
        new Promise((resolve) => {
            const env = { ...process.env, LOG_DIR: dir, LOG_CONSOLE_LEVEL: "off" };
            delete env.TAUTULLI_URL;
            delete env.TAUTULLI_API_KEY;
            delete env.DB_PATH;
            execFile(process.execPath, [script, ...args], { env, timeout: 60000 }, (error, stdout) =>
                resolve({ codigo: error ? error.code : 0, salida: stdout }),
            );
        });
    const huella = () => {
        const real = new Database(bd, { readonly: true });
        const r = {
            migraciones: real.prepare("SELECT COUNT(*) FROM schema_migrations").pluck().get(),
            ajustes: real.prepare("SELECT COUNT(*) FROM guild_settings").pluck().get(),
            reproducciones: real.prepare("SELECT COUNT(*) FROM plex_reproducciones").pluck().get(),
        };
        real.close();
        return r;
    };

    beforeAll(() => {
        const real = new Database(bd);
        runMigrations(real);
        const poner = real.prepare("INSERT INTO guild_settings (guildId, key, value) VALUES ('servidor', ?, ?)");
        poner.run("plex.tautulli_url", URL_TAUTULLI);
        poner.run("plex.tautulli_api_key", CLAVE);
        real.close();
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("con la configuración de la BD: todo cuadra, sale con 0 y no toca la BD", async () => {
        const antes = huella();
        const { codigo, salida } = await ejecutar("--bd", bd, "--muestra", "20");
        expect(salida).toMatch(new RegExp(`^Tautulli: ${URL_TAUTULLI} \\(servidor servidor\\)`));
        expect(salida).toMatch(/✓ Conexión\n {4}2 usuarios en Tautulli/);
        expect(salida).toMatch(/✓ Paginación de las bibliotecas de películas/);
        expect(salida).toMatch(/No reconocido: audio "tlh \/ Klingon" \(2\)/);
        expect(salida).toMatch(/\n✓ Todo cuadra\n$/);
        expect(codigo).toBe(0);
        expect(huella()).toEqual(antes);
    });

    test("si algo no cuadra, lo marca con ✗ y sale con 1", async () => {
        modo.pagina = false;
        const { codigo, salida } = await ejecutar("--bd", bd, "--muestra", "5");
        expect(salida).toMatch(/✗ Paginación de las bibliotecas de películas/);
        expect(salida).toMatch(/\n✗ 1 con fallos\n$/);
        expect(codigo).toBe(1);
    });

    test("sin Tautulli configurado, lo dice y sale con 1", async () => {
        const vacia = path.join(dir, "vacia.db");
        const { codigo, salida } = await ejecutar("--bd", vacia);
        expect(salida).toBe("✗ Falta Tautulli: ponlo en el panel (y pasa --bd) o en TAUTULLI_URL y TAUTULLI_API_KEY del .env\n");
        expect(codigo).toBe(1);
        expect(fs.existsSync(vacia)).toBe(false);
    });
});
