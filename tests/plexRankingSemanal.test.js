// 🍿 Ranking semanal de Plex: cada lunes desde las 10:00 (Madrid), en el canal del ranking (874776941000020018), quién vio
// más Plex la semana anterior: "🦭 El mayor gordito come foquitos de la semana es @…" y la lista de los 5 primeros.
// La semana en hora de Madrid, el mensaje exacto, solo una vez por semana, la migración del canal y el panel.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getHistoryPage: jest.fn(async () => []),
}));
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const tautulli = require("../src/services/tautulliClient");
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const ranking = require("../src/systems/plexRankingSemanal");
const { buildPlexHome, handlePlexButton, handlePlexChannelSelect } = require("../src/adminPanel/plex");
const paneladmin = require("../src/commands/admin/paneladmin");
const { createComponentRouter } = require("../src/core/componentRouter");
const { runMigrations, listMigrations } = require("../src/core/migrations");

const CANAL = "874776941000020018";
// Horas de Madrid en octubre de 2026 (hasta el domingo 25, UTC+2; después, UTC+1). El 5 de octubre es lunes.
const madrid = (mes, dia, hora, min = 0) => Date.UTC(2026, mes - 1, dia, hora - (mes === 10 && dia >= 26 ? 1 : 2), min);
const unix = (ms) => Math.floor(ms / 1000);
const SEMANA = { lunes: "2026-09-28", domingo: "2026-10-04" };

let n = 0;
let filaId = 1;
const nuevoGuild = () => `guild-ranking-${++n}`;
function canalDe(id = CANAL) {
    return { id, name: "general", isTextBased: () => true, send: jest.fn(async () => {}) };
}
function guildCon(g, canal = canalDe()) {
    return { id: g, name: g, channels: { cache: new Map([[canal.id, canal]]), fetch: async () => null } };
}
function ver(g, user, inicio, segundos, extra = {}) {
    db.prepare(
        `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, inicio, segundos, visto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(g, filaId++, String(user), extra.tipo || "episode", extra.rating_key ?? `r${filaId}`, unix(inicio), segundos, extra.visto ?? 1);
}
const vincular = (g, ...usuarios) => usuarios.forEach(([u, nombre]) => plexLinks.setLink(g, `disc-${u}`, String(u), nombre));

describe("la semana (en hora de Madrid)", () => {
    test.each([
        ["el lunes a las 10:00", madrid(10, 5, 10), SEMANA],
        ["el lunes a las 00:30 (en UTC aún es domingo)", madrid(10, 5, 0, 30), SEMANA],
        ["el domingo a las 23:00", madrid(10, 4, 23), { lunes: "2026-09-21", domingo: "2026-09-27" }],
        ["un miércoles", madrid(10, 7, 18), SEMANA],
        ["el lunes después del cambio de hora", madrid(10, 26, 10), { lunes: "2026-10-19", domingo: "2026-10-25" }],
        ["un lunes de cambio de año", Date.UTC(2027, 0, 4, 9), { lunes: "2026-12-28", domingo: "2027-01-03" }],
    ])("%s", (_, ahora, esperada) => {
        expect(ranking.semanaAnterior(ahora)).toEqual(esperada);
    });
});

describe("el ranking", () => {
    test("suma el tiempo de lunes a domingo (Madrid), de más a menos, solo de los vinculados que vieron algo", () => {
        const g = nuevoGuild();
        vincular(g, [1, "ana"], [2, "bea"], [3, "carlos"], [4, "dani"]);
        ver(g, 1, madrid(9, 28, 0, 5), 3600); // lunes a las 00:05: cuenta
        ver(g, 1, madrid(10, 4, 23, 30), 1800); // domingo a las 23:30 (en UTC, 21:30): cuenta
        ver(g, 1, madrid(10, 5, 0, 30), 99999); // el lunes siguiente: no
        ver(g, 1, madrid(9, 27, 23, 50), 99999); // el domingo anterior: no
        ver(g, 2, madrid(10, 1, 21), 7200, { tipo: "movie", rating_key: "peli" });
        ver(g, 2, madrid(10, 2, 21), 600, { tipo: "movie", rating_key: "peli" }); // la misma película: una vez
        ver(g, 2, madrid(10, 3, 21), 300, { rating_key: "ep", visto: 0 }); // a medias: suma tiempo, no episodio
        ver(g, 3, madrid(10, 1, 12), 0); // sin tiempo: no sale
        ver(g, 9, madrid(10, 1, 12), 50000); // sin vincular: no sale
        expect(ranking.ranking(g, SEMANA)).toEqual([
            { discordUserId: "disc-2", plexUsername: "bea", segundos: 8100, episodios: 0, peliculas: 1 },
            { discordUserId: "disc-1", plexUsername: "ana", segundos: 5400, episodios: 2, peliculas: 0 },
        ]);
    });

    test("con empate, por nombre; sin vinculados, vacío", () => {
        const g = nuevoGuild();
        vincular(g, [1, "zoe"], [2, "ana"]);
        ver(g, 1, madrid(10, 1, 20), 3600);
        ver(g, 2, madrid(10, 1, 20), 3600);
        expect(ranking.ranking(g, SEMANA).map((u) => u.plexUsername)).toEqual(["ana", "zoe"]);
        expect(ranking.ranking(nuevoGuild(), SEMANA)).toEqual([]);
    });
});

describe("el mensaje", () => {
    const persona = (u, segundos, episodios = 0, peliculas = 0) => ({
        discordUserId: `disc-${u}`,
        plexUsername: `u${u}`,
        segundos,
        episodios,
        peliculas,
    });

    test("el mayor gordito come foquitos, mencionado (solo a él le llega el aviso), y los 5 primeros", () => {
        const lista = [
            persona(1, 23 * 3600 + 15 * 60, 30, 2),
            persona(2, 18 * 3600 + 2 * 60, 20),
            persona(3, 7200, 0, 1),
            persona(4, 45 * 60, 1),
            persona(5, 60),
            persona(6, 30),
            persona(7, 10),
        ];
        expect(ranking.mensaje(lista, SEMANA)).toEqual({
            content:
                "🍿 **Ranking semanal de Plex** · del 28 de septiembre al 4 de octubre\n\n" +
                "🦭 El mayor gordito come foquitos de la semana es <@disc-1> con **23 h 15 min** de Plex.\n\n" +
                "🥇 <@disc-1> — **23 h 15 min** · 30 episodios y 2 películas\n" +
                "🥈 <@disc-2> — **18 h 2 min** · 20 episodios\n" +
                "🥉 <@disc-3> — **2 h** · 1 película\n" +
                "4️⃣ <@disc-4> — **45 min** · 1 episodio\n" +
                "5️⃣ <@disc-5> — **1 min**",
            allowedMentions: { users: ["disc-1"] },
        });
    });

    test("con menos de 5, los que haya; sin nadie, un aviso sin mencionar a nadie", () => {
        const dos = ranking.mensaje([persona(1, 3600), persona(2, 1800)], SEMANA).content;
        expect(dos.split("\n").filter((l) => /^(🥇|🥈|🥉|4️⃣|5️⃣)/.test(l))).toHaveLength(2);
        expect(ranking.mensaje([], SEMANA)).toEqual({
            content: "🍿 **Ranking semanal de Plex** · del 28 de septiembre al 4 de octubre\n\nEsta semana nadie ha visto nada en Plex. 😴",
            allowedMentions: { parse: [] },
        });
    });

    test("cabe en un mensaje de Discord aunque todos tengan números grandes", () => {
        const lista = Array.from({ length: 12 }, (_, i) => persona(10 ** 17 + i, 999 * 3600, 9999, 9999));
        expect(ranking.mensaje(lista, SEMANA).content.length).toBeLessThan(2000);
    });
});

describe("publicar y cuándo", () => {
    test("publica en el canal del ranking y lo apunta; sin canal o con un canal que no existe, avisa", async () => {
        const g = nuevoGuild();
        vincular(g, [1, "ana"]);
        ver(g, 1, madrid(10, 1, 20), 3600);
        const canal = canalDe();
        expect(await ranking.publicar(guildCon(g, canal), { semana: SEMANA })).toMatchObject({
            ok: false,
            motivo: "No hay canal para el ranking semanal.",
        });
        guildSettings.setSetting(g, "plex.ranking_canal", "999");
        expect(await ranking.publicar(guildCon(g, canal), { semana: SEMANA })).toMatchObject({
            ok: false,
            motivo: "No encuentro el canal <#999> (o no es de texto).",
        });
        guildSettings.setSetting(g, "plex.ranking_canal", CANAL);
        expect(await ranking.publicar(guildCon(g, canal), { semana: SEMANA })).toMatchObject({ ok: true });
        expect(canal.send.mock.calls[0][0].content).toMatch(/🦭 El mayor gordito come foquitos de la semana es <@disc-1>/);
        expect(guildSettings.getSettings(g).plex.ranking_ultima_semana).toBe(SEMANA.lunes);
    });

    test("solo los lunes desde las 10:00, una vez por semana; copia antes lo último del historial", async () => {
        const g = nuevoGuild();
        vincular(g, [1, "ana"], [2, "bea"]);
        guildSettings.setSetting(g, "plex.ranking_canal", CANAL);
        ver(g, 1, madrid(10, 2, 20), 3600);
        // Lo del domingo por la noche que todavía no se había copiado: cuenta (Bea pasa delante).
        tautulli.getHistoryPage.mockImplementation(async (_g, { start }) =>
            start === 0
                ? [
                      {
                          row_id: 777000 + n,
                          user_id: 2,
                          media_type: "episode",
                          rating_key: "x",
                          started: unix(madrid(10, 4, 22)),
                          play_duration: 7200,
                          watched_status: 1,
                      },
                  ]
                : [],
        );
        const canal = canalDe();
        const client = { guilds: { cache: new Map([[g, guildCon(g, canal)]]) } };

        await ranking.enviarSiToca(client, madrid(10, 5, 9, 59)); // lunes, antes de las 10
        await ranking.enviarSiToca(client, madrid(10, 3, 12)); // sábado
        expect(canal.send).not.toHaveBeenCalled();

        await ranking.enviarSiToca(client, madrid(10, 5, 10));
        expect(canal.send).toHaveBeenCalledTimes(1);
        expect(canal.send.mock.calls[0][0]).toMatchObject({ allowedMentions: { users: ["disc-2"] } });
        expect(canal.send.mock.calls[0][0].content).toMatch(/come foquitos de la semana es <@disc-2> con \*\*2 h\*\*/);

        // Más tarde ese lunes (el cron de cada hora, o un reinicio): no se repite. El lunes siguiente, sí.
        await ranking.enviarSiToca(client, madrid(10, 5, 11));
        await ranking.enviarSiToca(client, madrid(10, 5, 23, 59));
        expect(canal.send).toHaveBeenCalledTimes(1);
        await ranking.enviarSiToca(client, madrid(10, 12, 10));
        expect(canal.send).toHaveBeenCalledTimes(2);
        expect(canal.send.mock.calls[1][0].content).toMatch(/del 5 de octubre al 11 de octubre\n\nEsta semana nadie ha visto nada en Plex/);
        tautulli.getHistoryPage.mockImplementation(async () => []);
    });

    test("dos a la vez (el cron y el arranque) publican una sola vez", async () => {
        const g = nuevoGuild();
        vincular(g, [1, "ana"]);
        guildSettings.setSetting(g, "plex.ranking_canal", CANAL);
        const canal = canalDe();
        const client = { guilds: { cache: new Map([[g, guildCon(g, canal)]]) } };
        await Promise.all([ranking.enviarSiToca(client, madrid(10, 5, 10)), ranking.enviarSiToca(client, madrid(10, 5, 10))]);
        expect(canal.send).toHaveBeenCalledTimes(1);
    });

    test("si Tautulli falla, publica con lo que hay; si el canal falla, lo reintenta la hora siguiente", async () => {
        const g = nuevoGuild();
        vincular(g, [1, "ana"]);
        guildSettings.setSetting(g, "plex.ranking_canal", CANAL);
        ver(g, 1, madrid(10, 1, 20), 3600);
        tautulli.getHistoryPage.mockRejectedValueOnce(new Error("ECONNREFUSED"));
        const canal = canalDe();
        canal.send.mockRejectedValueOnce(new Error("Missing Permissions"));
        const client = { guilds: { cache: new Map([[g, guildCon(g, canal)]]) } };
        await expect(ranking.enviarSiToca(client, madrid(10, 5, 10))).resolves.toBeUndefined();
        expect(guildSettings.getSettings(g).plex.ranking_ultima_semana).toBe("");
        await ranking.enviarSiToca(client, madrid(10, 5, 11));
        expect(canal.send).toHaveBeenCalledTimes(2);
        expect(guildSettings.getSettings(g).plex.ranking_ultima_semana).toBe(SEMANA.lunes);
    });

    test("sin canal o sin nadie vinculado, nada", async () => {
        const g1 = nuevoGuild();
        vincular(g1, [1, "ana"]);
        const g2 = nuevoGuild();
        guildSettings.setSetting(g2, "plex.ranking_canal", CANAL);
        const c1 = canalDe();
        const c2 = canalDe();
        const client = {
            guilds: {
                cache: new Map([
                    [g1, guildCon(g1, c1)],
                    [g2, guildCon(g2, c2)],
                ]),
            },
        };
        await ranking.enviarSiToca(client, madrid(10, 5, 10));
        expect(c1.send).not.toHaveBeenCalled();
        expect(c2.send).not.toHaveBeenCalled();
    });

    test("core/tareas.js lo programa cada hora de los lunes (Madrid) y lo comprueba al arrancar", () => {
        const index = fs.readFileSync(path.join(__dirname, "../src/core/tareas.js"), "utf8");
        expect(index).toMatch(
            /cron\.schedule\(\s*"0 \* \* \* 1",[\s\S]*?plexRankingSemanal"\)\.enviarSiToca\(client\)[\s\S]*?timezone: "Europe\/Madrid"/,
        );
        expect(index).toMatch(
            /runJob\("Ranking semanal de Plex \(arranque\)", \(\) => require\("\.\.?\/systems\/plexRankingSemanal"\)\.enviarSiToca\(client\)\)/,
        );
    });
});

describe("migración 017", () => {
    const sinLog = {
        info() {},
        warn() {},
        debug() {},
        child() {
            return this;
        },
    };
    function bdHasta16() {
        const m = new Database(":memory:");
        m.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
        for (const mig of listMigrations().filter((x) => x.version <= 16)) {
            require(mig.file).up(m, { log: sinLog });
            m.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(mig.version, mig.name, Date.now());
        }
        return m;
    }
    const canalDelRanking = (m, g) =>
        m.prepare("SELECT value FROM guild_settings WHERE guildId = ? AND key = 'plex.ranking_canal'").pluck().get(g);

    test("pone 874776941000020018 en el servidor que lo usa para los niveles o los logros, y en ningún otro", () => {
        const m = bdHasta16();
        m.prepare("INSERT INTO xp_config (guildId, clave, valor) VALUES ('niveles', 'xp_announce_channel_id', ?)").run(CANAL);
        m.prepare("INSERT INTO guild_settings (guildId, key, value) VALUES ('logros', 'logros.notify_channel_id', ?)").run(CANAL);
        m.prepare("INSERT INTO xp_config (guildId, clave, valor) VALUES ('otro', 'xp_announce_channel_id', '123')").run();
        expect(runMigrations(m)).toBe(listMigrations().length - 16);
        expect([canalDelRanking(m, "niveles"), canalDelRanking(m, "logros"), canalDelRanking(m, "otro")]).toEqual([
            CANAL,
            CANAL,
            undefined,
        ]);
    });

    test("en una BD vacía no hace nada (y no falla)", () => {
        expect(() => runMigrations(new Database(":memory:"))).not.toThrow();
    });
});

describe("panel de admin", () => {
    const g = nuevoGuild();
    beforeAll(() => {
        vincular(g, [1, "ana"]);
        ver(g, 1, Date.now() - 7 * 86400 * 1000, 3600); // la semana pasada (más o menos)
    });

    test("Plex enseña el canal del ranking y el botón 📣 Ranking semanal", () => {
        const home = buildPlexHome(g);
        expect(home.embeds[0].data.description).toMatch(/📣 Ranking semanal: sin canal/);
        guildSettings.setSetting(g, "plex.ranking_canal", CANAL);
        expect(buildPlexHome(g).embeds[0].data.description).toMatch(
            new RegExp(`📣 Ranking semanal: <#${CANAL}> \\(los lunes a las 10:00\\)`),
        );
        const ids = home.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
        expect(ids).toContain("paneladmin_plex_ranking");
        expect(new Set(ids).size).toBe(ids.length);
        for (const fila of home.components) expect(fila.components.length).toBeLessThanOrEqual(5);
    });

    test("📣 enseña cómo queda (en privado y sin avisar a nadie), deja cambiar el canal y publicarlo ya", async () => {
        guildSettings.setSetting(g, "plex.ranking_canal", "");
        const reply = jest.fn(async () => {});
        await handlePlexButton({ customId: "paneladmin_plex_ranking", guildId: g, reply });
        const vista = reply.mock.calls[0][0];
        expect(vista).toMatchObject({ allowedMentions: { parse: [] }, flags: 64 });
        expect(vista.content).toMatch(/^📣 El ranking de Plex se publica cada lunes a las 10:00 en \*\*ningún canal\*\*/);
        expect(vista.content).toMatch(/🍿 \*\*Ranking semanal de Plex\*\*/);
        expect(vista.components[1].toJSON().components[0]).toMatchObject({ custom_id: "paneladmin_plex_ranking_publicar", disabled: true });

        const update = jest.fn(async () => {});
        await handlePlexChannelSelect({
            customId: "paneladmin_plex_ranking_canal_select",
            guildId: g,
            values: [CANAL],
            user: { id: "admin" },
            update,
        });
        expect(guildSettings.getSettings(g).plex.ranking_canal).toBe(CANAL);
        expect(update.mock.calls[0][0].flags).toBeUndefined();
        expect(update.mock.calls[0][0].content).toMatch(new RegExp(`en <#${CANAL}>\\. Así queda`));
        expect(update.mock.calls[0][0].components[1].toJSON().components[0].disabled).toBe(false);

        const canal = canalDe();
        const editReply = jest.fn(async () => {});
        await handlePlexButton({
            customId: "paneladmin_plex_ranking_publicar",
            guildId: g,
            guild: guildCon(g, canal),
            user: { id: "admin" },
            deferReply: jest.fn(async () => {}),
            editReply,
        });
        expect(editReply.mock.calls[0][0]).toEqual({ content: "✅ Ranking semanal publicado." });
        expect(canal.send).toHaveBeenCalledTimes(1);
    });

    test("publicar sin un canal que exista avisa", async () => {
        guildSettings.setSetting(g, "plex.ranking_canal", "404");
        const editReply = jest.fn(async () => {});
        await handlePlexButton({
            customId: "paneladmin_plex_ranking_publicar",
            guildId: g,
            guild: guildCon(g),
            user: { id: "admin" },
            deferReply: jest.fn(async () => {}),
            editReply,
        });
        expect(editReply.mock.calls[0][0].content).toBe("❌ No encuentro el canal <#404> (o no es de texto).");
    });

    test("los componentes nuevos llegan a /paneladmin por el enrutador", () => {
        const router = createComponentRouter();
        router.register(paneladmin, "paneladmin");
        const fake = (type, customId) => ({
            customId,
            isButton: () => type === "button",
            isStringSelectMenu: () => false,
            isUserSelectMenu: () => false,
            isRoleSelectMenu: () => false,
            isChannelSelectMenu: () => type === "channelSelect",
            isModalSubmit: () => false,
        });
        expect(router.match(fake("button", "paneladmin_plex_ranking")).method).toBe("handleButton");
        expect(router.match(fake("button", "paneladmin_plex_ranking_publicar")).method).toBe("handleButton");
        expect(router.match(fake("channelSelect", "paneladmin_plex_ranking_canal_select")).method).toBe("handleChannelSelect");
    });
});
