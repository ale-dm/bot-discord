// 🍿 Trofeos de Plex en los paneles: /paneladmin → Plex → 🏆 Trofeos (cada botón, menú y formulario, a través del
// comando y del enrutador de componentes, como en Discord), /perfil → 🏅 Logros (rareza, reclamar trofeos con su
// emoji, ocultar), que todo lo que se manda a Discord es válido (sin ids repetidos ni límites pasados) y la migración.
jest.mock("../src/services/tautulliClient", () => ({
    ...jest.requireActual("../src/services/tautulliClient"),
    getConfig: jest.fn(() => ({ url: "http://tautulli.local", apiKey: "clave" })),
    getHistoryPage: jest.fn(async () => []),
    getLibraries: jest.fn(async () => []),
    getLibraryMediaInfo: jest.fn(async () => ({ filas: [], total: 0 })),
    getMetadata: jest.fn(async () => null),
    getChildrenMetadata: jest.fn(async () => []),
    getStreamData: jest.fn(async () => null),
}));
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const tautulli = require("../src/services/tautulliClient");
const db = require("../src/core/db");
const { runMigrations } = require("../src/core/migrations");
const { createComponentRouter } = require("../src/core/componentRouter");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");
const { buildPlexHome, buildPlexTrofeos } = require("../src/adminPanel/plex");
const paneladmin = require("../src/commands/admin/paneladmin");
const perfilCmd = require("../src/commands/progresion/perfil");
const perfilPanel = require("../src/paneles/perfil");

const G = "guild-paneles-plex";
const canal = { name: "logros", isTextBased: () => true, send: jest.fn(async () => {}) };
const guild = {
    id: G,
    name: G,
    channels: { cache: new Map([["canal-logros", canal]]), fetch: async () => null },
    members: { cache: new Map(), fetch: async () => null },
};

const interaccion = (extra = {}) => ({
    guildId: G,
    guild,
    user: { id: "admin", tag: "admin", username: "admin" },
    member: { permissions: { has: () => true } },
    client: { guilds: { cache: new Map([[G, guild]]) } },
    reply: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    deferReply: jest.fn(async () => {}),
    editReply: jest.fn(async () => {}),
    ...extra,
});
const boton = async (customId, extra) => {
    const i = interaccion({ customId, ...extra });
    await paneladmin.handleButton(i.client, i);
    return i;
};
const menu = async (customId, values, extra) => {
    const i = interaccion({ customId, values, ...extra });
    await paneladmin.handleStringSelect(i.client, i);
    return i;
};
const formulario = async (customId, campos) => {
    const i = interaccion({ customId, fields: { getTextInputValue: (k) => campos[k] ?? "" } });
    await paneladmin.handleModal(i.client, i);
    return i;
};

/** Lo que se manda a Discord pasa la validación de discord.js, sin ids repetidos ni más de 5 filas / 5 botones. */
function valido(payload) {
    const filas = payload.components || [];
    expect(filas.length).toBeLessThanOrEqual(5);
    const ids = [];
    for (const fila of filas) {
        const json = fila.toJSON();
        expect(json.components.length).toBeLessThanOrEqual(5);
        for (const c of json.components) {
            ids.push(c.custom_id);
            expect(c.custom_id.length).toBeLessThanOrEqual(100);
            for (const o of c.options || []) expect(o.value.length).toBeLessThanOrEqual(100);
        }
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of payload.embeds || []) {
        const d = e.toJSON();
        expect((d.description || "").length).toBeLessThanOrEqual(4096);
        expect(JSON.stringify(d).length).toBeLessThan(6000);
    }
}

// Datos: una serie terminada por disc-1, un trofeo de admin y 30 más para llenar el panel.
const ver = (user, serie, t, e) =>
    db
        .prepare(
            `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, serie_key, titulo, serie, temporada, episodio, inicio, segundos, visto)
             VALUES (?, ?, ?, 'episode', ?, ?, ?, ?, ?, ?, ?, 3600, 1)`,
        )
        .run(G, Math.floor(Math.random() * 1e9), user, `${serie}-${t}-${e}`, serie, "Serie", "Serie", t, e, 1_780_000_000);

beforeAll(async () => {
    guildSettings.setSetting(G, "logros.notify_channel_id", "canal-logros");
    // Aquí se prueba la recompensa de cada trofeo; la de la primera importación está en plexImportacion.test.js.
    guildSettings.setSetting(G, "plex.importacion_pct", 100);
    plexLinks.setLink(G, "disc-1", "1", "uno");
    plexLinks.setLink(G, "disc-2", "2", "dos");
    db.prepare(
        `INSERT INTO plex_fichas (guildId, rating_key, tipo, titulo, temporadas, actualizada, section_id, biblioteca) VALUES (?, 'serie', 'show', 'Serie', ?, ?, '3', 'Anime')`,
    ).run(G, JSON.stringify({ 1: [1, 2], 2: [1] }), Date.now());
    [
        [1, 1],
        [1, 2],
        [2, 1],
    ].forEach(([t, e]) => ver("1", "serie", t, e));
    await plexHistorial.actualizarLogros(guild);
});

describe("/paneladmin → Plex → 🏆 Trofeos", () => {
    test("la pantalla de Plex tiene el botón 🏆 Trofeos y es válida", () => {
        const home = buildPlexHome(G);
        valido(home);
        expect(home.components[0].components.map((b) => b.data.custom_id)).toContain("paneladmin_plex_trofeos");
    });

    test("🏆 Trofeos abre la pantalla; sin trofeos de admin, 🗑️ Borrar está desactivado", async () => {
        const i = await boton("paneladmin_plex_trofeos");
        const payload = i.update.mock.calls[0][0];
        valido(payload);
        expect(payload.embeds[0].data.title).toBe("🏆 Trofeos de Plex");
        const borrar = payload.components[0].components.find((b) => b.data.custom_id === "paneladmin_plex_trofeo_borrar");
        expect(borrar.data.disabled).toBe(true);
        const r = await boton("paneladmin_plex_trofeo_borrar");
        expect(r.reply.mock.calls[0][0].content).toBe("No hay trofeos de admin.");
    });

    test("➕ Crear trofeo abre el formulario con nombre, condición, recompensa, y descripción y dificultad opcionales", async () => {
        const i = await boton("paneladmin_plex_trofeo_crear");
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("paneladmin_plex_trofeo_modal");
        const campos = modal.components.map((f) => f.components[0]);
        expect(campos.map((c) => [c.custom_id, c.required])).toEqual([
            ["nombre", true],
            ["condicion", true],
            ["recompensa", true],
            ["descripcion", false],
            ["dificultad", false],
        ]);
        // Discord no deja etiquetas de más de 45 caracteres.
        expect(campos.every((c) => c.label.length <= 45)).toBe(true);
    });

    test("el formulario crea el trofeo (por /paneladmin), lo calcula enseguida y lo anuncia", async () => {
        canal.send.mockClear();
        const i = await formulario("paneladmin_plex_trofeo_modal", {
            nombre: "Maratoniano",
            condicion: "anime-episodios 3",
            recompensa: "750",
        });
        expect(i.reply.mock.calls[0][0].content).toMatch(/^✅ Trofeo \*\*Maratoniano\*\* creado/);
        // El cálculo va sin esperar a la respuesta: se espera al anuncio.
        for (let n = 0; n < 100 && !canal.send.mock.calls.length; n++) await new Promise((r) => setTimeout(r, 20));
        expect(canal.send.mock.calls.map(([m]) => m.content).join("\n")).toMatch(
            /<@disc-1> desbloqueó logros:\n🏅 \*\*Maratoniano\*\* — Ve 3 episodios de anime · lo tiene el 50 % del servidor/,
        );
        const mal = await formulario("paneladmin_plex_trofeo_modal", { nombre: "X", condicion: "cualquier cosa", recompensa: "1" });
        expect(mal.reply.mock.calls[0][0].content).toMatch(/^❌ No entiendo la condición: va como `tipo:valor número`/);
        const tipo = await formulario("paneladmin_plex_trofeo_modal", { nombre: "X", condicion: "actor:Tom Hanks 3", recompensa: "1" });
        expect(tipo.reply.mock.calls[0][0].content).toBe('❌ No conozco el tipo "actor".');
    });

    test("con 30 trofeos de admin, la pantalla sigue cabiendo; 🗑️ Borrar ofrece como mucho 25 y borra el elegido", async () => {
        for (let i = 0; i < 30; i++)
            plexTrofeos.crearAdmin(
                G,
                { nombre: `Trofeo con nombre largo ${i}`, condicion: `genero:Ciencia ficción ${i + 1}`, recompensa: "100000" },
                "admin",
            );
        valido(buildPlexTrofeos(G));
        expect(buildPlexTrofeos(G).embeds[0].data.description).toMatch(/…/);
        const r = await boton("paneladmin_plex_trofeo_borrar");
        const opciones = r.reply.mock.calls[0][0].components[0].toJSON().components[0].options;
        expect(opciones).toHaveLength(25);
        const elegido = opciones.find((o) => o.label === "Maratoniano").value;
        const b = await menu("paneladmin_plex_trofeo_borrar_select", [elegido]);
        expect(b.update.mock.calls[0][0]).toEqual({ content: "✅ Trofeo borrado.", components: [] });
        expect(plexTrofeos.resumen(G).admin.some((t) => t.nombre === "Maratoniano")).toBe(false);
    });

    test("🎌 Bibliotecas de anime: solo de películas y series, con la actual marcada; elegir y volver a automático", async () => {
        tautulli.getLibraries.mockResolvedValueOnce([
            { section_id: 1, section_name: "Películas", section_type: "movie", count: 900 },
            { section_id: 3, section_name: "Anime", section_type: "show", count: 40 },
            { section_id: 7, section_name: "Música", section_type: "artist", count: 5000 },
        ]);
        const i = await boton("paneladmin_plex_anime");
        const json = i.reply.mock.calls[0][0].components[0].toJSON().components[0];
        expect(json.options.map((o) => [o.value, Boolean(o.default)])).toEqual([
            ["auto", true],
            ["1", false],
            ["3", false],
        ]);
        expect(json.max_values).toBe(3);

        await menu("paneladmin_plex_anime_select", ["3"]);
        expect(guildSettings.getSettings(G).plex.bibliotecas_anime).toBe("3");
        const sel = await menu("paneladmin_plex_anime_select", ["auto", "3"]);
        expect(guildSettings.getSettings(G).plex.bibliotecas_anime).toBe("");
        expect(sel.update.mock.calls[0][0].content).toMatch(/Anime automático/);
    });

    test("🎌 Bibliotecas de anime con Tautulli caído avisa", async () => {
        tautulli.getLibraries.mockRejectedValueOnce(new Error("ECONNREFUSED"));
        const i = await boton("paneladmin_plex_anime");
        expect(i.reply.mock.calls[0][0].content).toBe("❌ No se pudo consultar Tautulli: ECONNREFUSED");
    });

    test("📼 Sincronizar: historial, fichas y logros; con los logros de Plex desactivados no pide fichas", async () => {
        const i = await boton("paneladmin_plex_historial");
        expect(i.editReply.mock.calls[0][0].content).toMatch(
            /📼 Historial sincronizado: \*\*0\*\* reproducciones nuevas[\s\S]*\n📚 Fichas: \*\*0\*\* pedidas ahora · \*\*0\*\* pendientes\.\n🗣️ Idiomas: \*\*3\*\* reproducciones revisadas ahora · \*\*0\*\* pendientes\.\n🏅/,
        );
        guildSettings.setSetting(G, "logros.disabled_categories", "plex");
        const j = await boton("paneladmin_plex_historial");
        expect(j.editReply.mock.calls[0][0].content).toMatch(/📚 Fichas: no se piden con los logros de Plex desactivados/);
        guildSettings.setSetting(G, "logros.disabled_categories", "");
    });

    test("sin permisos de admin no hace nada", async () => {
        const i = await menu("paneladmin_plex_anime_select", ["3"], { member: { permissions: { has: () => false } } });
        expect(i.reply.mock.calls[0][0].content).toBe("No tienes permisos.");
        expect(guildSettings.getSettings(G).plex.bibliotecas_anime).toBe("");
    });
});

describe("enrutado como en Discord", () => {
    // Todos los comandos, como los carga index.js: cada componente nuevo tiene que llegar a su módulo.
    const router = createComponentRouter();
    const cargar = (dir) =>
        fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) cargar(p);
            else if (e.name.endsWith(".js")) router.register(require(p), p);
        });
    cargar(path.join(__dirname, "../src/commands"));
    const fake = (type, customId) => {
        const is = (t) => () => t === type;
        return {
            customId,
            isButton: is("button"),
            isStringSelectMenu: is("stringSelect"),
            isUserSelectMenu: is("userSelect"),
            isRoleSelectMenu: is("roleSelect"),
            isChannelSelectMenu: is("channelSelect"),
            isModalSubmit: is("modal"),
        };
    };

    test.each([
        ["button", "paneladmin_plex_trofeos", paneladmin, "handleButton"],
        ["button", "paneladmin_plex_trofeo_crear", paneladmin, "handleButton"],
        ["button", "paneladmin_plex_trofeo_borrar", paneladmin, "handleButton"],
        ["button", "paneladmin_plex_anime", paneladmin, "handleButton"],
        ["modal", "paneladmin_plex_trofeo_modal", paneladmin, "handleModal"],
        ["stringSelect", "paneladmin_plex_trofeo_borrar_select", paneladmin, "handleStringSelect"],
        ["stringSelect", "paneladmin_plex_anime_select", paneladmin, "handleStringSelect"],
        ["button", "perfil_plexoculto_1_1_1", perfilCmd, "handleButton"],
    ])("%s %s → su módulo", (tipo, id, mod, metodo) => {
        const r = router.match(fake(tipo, id));
        expect(r.mod).toBe(mod);
        expect(r.method).toBe(metodo);
    });
});

describe("/perfil → 🏅 Logros", () => {
    test("los trofeos se reclaman desde el menú con su emoji (válido para Discord) y la rareza se ve", () => {
        const payload = perfilPanel.buildLogros(G, "disc-1", "disc-1");
        valido(payload);
        const menuReclamar = payload.components.find((f) => f.toJSON().components[0].custom_id.startsWith("perfil_reclamar_")).toJSON()
            .components[0];
        const serie = menuReclamar.options.find((o) => o.value === "plext:serie:serie");
        expect(serie.emoji).toEqual({ name: "🎌", animated: false });
        expect(payload.embeds[0].data.description).toMatch(/🏆 (solo el|lo tiene el) \d+ %/);
    });

    test("reclamar un trofeo desde el menú del perfil", async () => {
        const update = jest.fn(async () => {});
        await perfilCmd.handleSelect(null, {
            customId: "perfil_reclamar_disc-1_disc-1",
            values: ["plext:serie:serie"],
            user: { id: "disc-1" },
            guildId: G,
            update,
        });
        expect(update.mock.calls[0][0].content).toMatch(/^✅ Reclamaste \*\*.+\*\* y ganaste \*\*280 🪙\*\*\./);
    });

    test("el botón de ocultar: solo a su dueño; ida y vuelta", async () => {
        const otro = jest.fn(async () => {});
        await perfilCmd.handleButton(null, {
            customId: "perfil_plexoculto_disc-1_disc-1_1",
            user: { id: "disc-2" },
            guild,
            guildId: G,
            reply: otro,
            update: jest.fn(),
        });
        expect(otro.mock.calls[0][0].content).toMatch(/^⛔/);
        expect(plexTrofeos.oculto(G, "disc-1")).toBe(false);

        const update = jest.fn(async () => {});
        const pulsar = (v) =>
            perfilCmd.handleButton(null, {
                customId: `perfil_plexoculto_disc-1_disc-1_${v}`,
                user: { id: "disc-1" },
                guild,
                guildId: G,
                update,
            });
        await pulsar(1);
        expect(plexTrofeos.oculto(G, "disc-1")).toBe(true);
        valido(update.mock.calls[0][0]);
        const boton = update.mock.calls[0][0].components[0].components.find((b) => b.data.custom_id.startsWith("perfil_plexoculto_"));
        expect(boton.data).toMatchObject({ custom_id: "perfil_plexoculto_disc-1_disc-1_0", label: "🍿 Enseñar mis logros de Plex" });
        // Los demás ven su perfil sin Plex, también en el resumen.
        const ajeno = perfilPanel.buildLogros(G, "disc-2", "disc-1", 0, true);
        expect(ajeno.embeds[0].data.description).not.toMatch(/\(plex/);
        expect(ajeno.embeds[0].data.fields.some((f) => f.name === "🍿 Plex por dificultad")).toBe(false);
        const total = achievements.getSummary(G, "disc-1").total;
        expect(ajeno.embeds[0].data.fields[0].value).not.toMatch(new RegExp(`/${total} `));
        await pulsar(0);
        expect(plexTrofeos.oculto(G, "disc-1")).toBe(false);
        expect(update.mock.calls[1][0].content).toMatch(/^🍿 Tus logros de Plex vuelven/);
    });

    test("las páginas siguen funcionando con muchos trofeos (6 por página, sin ids repetidos)", () => {
        for (let i = 0; i < 40; i++)
            db.prepare(
                `INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, objetivo, recompensa, creado) VALUES (?, ?, 'serie', ?, 'x', 1, 10, ?)`,
            ).run(G, `serie:extra${i}`, `Extra ${i}`, Date.now());
        plexTrofeos.borrar(G, "no-existe"); // borrar vacía la caché del catálogo: así ve los que se han metido a mano
        for (let i = 0; i < 40; i++)
            db.prepare(
                "INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, 'disc-1', ?, 1, ?)",
            ).run(G, `plext:serie:extra${i}`, Date.now());
        const lista = achievements.listUserAchievements(G, "disc-1");
        const paginas = Math.ceil(lista.length / 6);
        for (let p = 0; p < paginas; p++) valido(perfilPanel.buildLogros(G, "disc-1", "disc-1", p, p % 2 === 0));
        expect(perfilPanel.buildLogros(G, "disc-1", "disc-1", paginas - 1).embeds[0].data.fields[2].value).toBe(`${paginas}/${paginas}`);
    });
});

describe("migración 015", () => {
    test("en una BD vacía crea las tablas y la columna", () => {
        const m = new Database(":memory:");
        runMigrations(m);
        const tablas = m.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
        expect(tablas).toEqual(expect.arrayContaining(["plex_fichas", "plex_trofeos", "plex_preferencias"]));
        expect(
            m
                .prepare("PRAGMA table_info(plex_sync)")
                .all()
                .map((c) => c.name),
        ).toContain("biblioteca_revisada");
    });

    test("sobre una BD en la 014 con historial, no toca lo que había", () => {
        const m = new Database(":memory:");
        const { listMigrations } = require("../src/core/migrations");
        // Aplica hasta la 014 a mano y mete datos de la fase 1.
        m.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
        for (const mig of listMigrations().filter((x) => x.version <= 14)) {
            require(mig.file).up(m, {
                log: {
                    info() {},
                    warn() {},
                    debug() {},
                    child() {
                        return this;
                    },
                },
            });
            m.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(mig.version, mig.name, Date.now());
        }
        m.prepare("INSERT INTO plex_sync (guildId, ultimo_inicio, ultima_sync) VALUES ('g', 123, 456)").run();
        expect(runMigrations(m)).toBe(listMigrations().length - 14);
        expect(m.prepare("SELECT * FROM plex_sync").get()).toEqual({
            guildId: "g",
            ultimo_inicio: 123,
            ultima_sync: 456,
            biblioteca_revisada: null,
        });
        expect(runMigrations(m)).toBe(0);
    });

    test("016 sobre una BD en la 015 con reproducciones y trofeos: añade las columnas sin tocar nada", () => {
        const m = new Database(":memory:");
        const { listMigrations } = require("../src/core/migrations");
        const log = {
            info() {},
            warn() {},
            debug() {},
            child() {
                return this;
            },
        };
        m.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
        for (const mig of listMigrations().filter((x) => x.version <= 15)) {
            require(mig.file).up(m, { log });
            m.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(mig.version, mig.name, Date.now());
        }
        m.prepare(
            "INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, inicio, segundos, visto) VALUES ('g', 1, '5', 'movie', 100, 60, 1)",
        ).run();
        m.prepare(
            "INSERT INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, creado) VALUES ('g', 'serie:1', 'serie', 'S', 'd', 1)",
        ).run();
        expect(runMigrations(m)).toBe(listMigrations().length - 15);
        expect(m.prepare("SELECT id, audio, subs, idioma_revisado FROM plex_reproducciones").get()).toEqual({
            id: 1,
            audio: null,
            subs: null,
            idioma_revisado: 0,
        });
        expect(m.prepare("SELECT id, nombre, dificultad FROM plex_trofeos").get()).toEqual({
            id: "serie:1",
            nombre: "S",
            dificultad: null,
        });
        const indices = m.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'plex_reproducciones'").pluck().all();
        expect(indices).toContain("idx_plex_reproducciones_idioma");
    });
});
