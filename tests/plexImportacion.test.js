// 🍿 Proteger la economía en la primera importación de Plex (F-PX-08): lo que se desbloquea mientras se le calcula a
// alguien lo antiguo da solo un % de las monedas (50 % por defecto, se cambia en el panel). La importación de cada uno
// dura desde su primer cálculo hasta que no queda nada antiguo por revisar (fichas e idiomas), como mucho 7 días.
const { db, nuevoGuild, peli, verPeli, verEps, serie, bibliotecaCompleta, vincular } = require("./ayudaPlex");
const guildSettings = require("../src/systems/guildSettings");
const plexLinks = require("../src/systems/plexLinks");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexImportacion = require("../src/systems/plexImportacion");
const dinero = require("../src/systems/dinero");
const perfilPanel = require("../src/paneles/perfil");
const perfilCmd = require("../src/commands/progresion/perfil");
const { buildPlexTrofeos, handlePlexButton, handlePlexModal } = require("../src/adminPanel/plex");

const logro = (g, u, id) => achievements.listUserAchievements(g, `disc-${u}`, { includeHidden: true }).find((a) => a.id === id);
const fila = (g, u) => db.prepare("SELECT inicio, fin FROM plex_importacion WHERE guildId = ? AND userId = ?").get(g, `disc-${u}`);

beforeEach(() => {
    delete process.env.GOOGLE_API_KEY;
});

describe("la importación de cada uno", () => {
    const g = nuevoGuild("guild-imp");
    beforeAll(() => {
        vincular(g, 1);
        peli(g, "p0", "Peli 0", 2000);
        verPeli(g, 1, "p0", "Peli 0", 2000);
    });

    test("el primer cálculo empieza su importación: lo que sale da el 50 % de las monedas (por defecto)", async () => {
        const [r] = await plexHistorial.actualizarLogros(g);
        expect(r.importado).toBe(true);
        expect(r.desbloqueados.find((a) => a.id === "plex_pelis_1")).toMatchObject({ importado: true });
        expect(fila(g, 1)).toMatchObject({ fin: null });
        expect(logro(g, 1, "plex_pelis_1")).toMatchObject({ completed: true, claimable: true, importado: true, rewardCoins: 100 });
        expect(achievements.rewardCoinsFor(logro(g, 1, "plex_pelis_1"), g)).toBe(50);
    });

    test("en /perfil → 🏅 Logros se ve que es de la importación y el menú dice lo que da de verdad", () => {
        const p = perfilPanel.buildLogros(g, "disc-1", "disc-1", 0, false, "cat-plex");
        expect(p.embeds[0].data.description).toMatch(/\*\*Se apagan las luces\*\*[\s\S]*· 📼 de la importación \(50 %\)/);
        const menu = p.components.find((f) => f.components[0].data.custom_id?.startsWith("perfil_reclamar_")).components[0];
        expect(menu.options.find((o) => o.data.value === "plex_pelis_1").data.description).toBe("+50 🪙 (📼 de la importación)");
    });

    test("al reclamarlo cobra la mitad y se le dice por qué", async () => {
        const antes = dinero.cuenta("disc-1").efectivo;
        const update = jest.fn(async () => {});
        await perfilCmd.handleSelect(null, {
            customId: "perfil_reclamar_disc-1_disc-1",
            values: ["plex_pelis_1"],
            user: { id: "disc-1" },
            guildId: g,
            update,
        });
        expect(update.mock.calls[0][0].content).toBe(
            "✅ Reclamaste **Se apagan las luces** y ganaste **50 🪙** (📼 de la importación de Plex: el 50 % de las monedas).",
        );
        expect(dinero.cuenta("disc-1").efectivo).toBe(antes + 50 - Math.floor(50 * 0.05)); // 5% de impuesto por defecto
    });

    test("mientras quede algo antiguo por revisar (aquí, la biblioteca sin repasar), lo que sale sigue siendo de la importación", async () => {
        for (let i = 1; i < 25; i++) {
            peli(g, `p${i}`, `Peli ${i}`, 2000);
            verPeli(g, 1, `p${i}`, `Peli ${i}`, 2000);
        }
        const [r] = await plexHistorial.actualizarLogros(g);
        expect(r.desbloqueados.map((a) => a.id)).toContain("plex_pelis_25");
        expect(logro(g, 1, "plex_pelis_25").importado).toBe(true);
        expect(fila(g, 1).fin).toBeNull();
    });

    test("con todo revisado, termina; lo que sale después da todas las monedas", async () => {
        bibliotecaCompleta(g);
        const [r] = await plexHistorial.actualizarLogros(g);
        expect(r.importado).toBe(true); // este cálculo todavía cuenta como importación (ya con todo lo antiguo)
        expect(fila(g, 1).fin).toEqual(expect.any(Number));
        expect(plexImportacion.cuantosImportando(g)).toBe(0);

        // Un atracón nuevo: 5 episodios de la misma serie el mismo día.
        serie(g, "s", "Serie", { 1: [1, 2, 3, 4, 5, 6] });
        verEps(
            g,
            1,
            "s",
            "Serie",
            [1, 2, 3, 4, 5].map((e) => [1, e]),
        );
        const [r2] = await plexHistorial.actualizarLogros(g);
        expect(r2.importado).toBe(false);
        expect(r2.desbloqueados.find((a) => a.id === "plex_atracon_5")).not.toHaveProperty("importado");
        expect(logro(g, 1, "plex_atracon_5")).toMatchObject({ importado: false });
        expect(achievements.claimAchievement(g, "disc-1", "plex_atracon_5")).toMatchObject({ ok: true, reward: 700, importado: false });
        // Lo de la importación sigue siendo de la importación aunque ya haya terminado.
        expect(achievements.claimAchievement(g, "disc-1", "plex_pelis_25")).toMatchObject({ ok: true, reward: 600, importado: true });
    });
});

describe("cuándo termina", () => {
    test("faltan los idiomas de lo que ha visto: sigue; revisados, termina", async () => {
        const g = nuevoGuild("guild-imp");
        vincular(g, 1);
        bibliotecaCompleta(g);
        peli(g, "p", "P", 2001);
        verPeli(g, 1, "p", "P", 2001, { idioma_revisado: 0 });
        await plexHistorial.actualizarLogros(g);
        expect(plexImportacion.pendiente(g, "1")).toEqual({ fichas: 0, idiomas: 1 });
        expect(fila(g, 1).fin).toBeNull();
        db.prepare("UPDATE plex_reproducciones SET idioma_revisado = 1 WHERE guildId = ?").run(g);
        await plexHistorial.actualizarLogros(g);
        expect(fila(g, 1).fin).toEqual(expect.any(Number));
    });

    test("fichas pendientes en el servidor: sigue", async () => {
        const g = nuevoGuild("guild-imp");
        vincular(g, 1);
        bibliotecaCompleta(g);
        peli(g, "pendiente", "Pendiente", 2001, { actualizada: 0 });
        await plexHistorial.actualizarLogros(g);
        expect(plexImportacion.pendiente(g, "1").fichas).toBe(1);
        expect(fila(g, 1).fin).toBeNull();
    });

    test("como mucho 7 días, aunque falte algo", async () => {
        const g = nuevoGuild("guild-imp");
        vincular(g, 1);
        await plexHistorial.actualizarLogros(g);
        expect(fila(g, 1).fin).toBeNull();
        db.prepare("UPDATE plex_importacion SET inicio = ? WHERE guildId = ?").run(Date.now() - plexImportacion.MAX_MS - 1000, g);
        await plexHistorial.actualizarLogros(g);
        expect(fila(g, 1).fin).toEqual(expect.any(Number));
        expect(plexImportacion.importando(g, "disc-1")).toBe(false);
    });

    test("cada vinculado tiene la suya: quien se vincula después, importa lo suyo aunque los demás ya acabaran", async () => {
        const g = nuevoGuild("guild-imp");
        vincular(g, 1);
        bibliotecaCompleta(g);
        await plexHistorial.actualizarLogros(g);
        expect(fila(g, 1).fin).toEqual(expect.any(Number));
        // El 2 lleva años viendo cosas (el historial de todos ya está copiado) y se vincula ahora.
        peli(g, "q", "Q", 2001);
        verPeli(g, 2, "q", "Q", 2001);
        vincular(g, 2);
        const r = await plexHistorial.actualizarLogros(g);
        expect(r.find((x) => x.discordUserId === "disc-2")).toMatchObject({ importado: true });
        expect(logro(g, 2, "plex_pelis_1").importado).toBe(true);
    });

    test("volver a vincular con la misma cuenta no cambia nada; con otra cuenta de Plex, es otra importación", async () => {
        const g = nuevoGuild("guild-imp");
        vincular(g, 1);
        bibliotecaCompleta(g);
        await plexHistorial.actualizarLogros(g);
        const fin = fila(g, 1).fin;
        expect(fin).toEqual(expect.any(Number));
        plexLinks.setLink(g, "disc-1", "1", "u1");
        expect(fila(g, 1).fin).toBe(fin);
        plexLinks.setLink(g, "disc-1", "77", "otra-cuenta");
        expect(fila(g, 1)).toBeUndefined();
        expect(plexImportacion.importando(g, "disc-1")).toBe(true);
    });
});

test("solo es de la importación lo de Plex: el casino, el XP... dan siempre todo", async () => {
    const g = nuevoGuild("guild-imp");
    const [a] = await achievements.applyEvents(g, "jugador", [{ event: "casino_bet", value: 1 }]);
    expect(a.id).toBe("casino_primera");
    expect(a).not.toHaveProperty("importado");
    expect(achievements.claimAchievement(g, "jugador", "casino_primera")).toMatchObject({ ok: true, reward: 150, importado: false });
});

test("el % se combina con el multiplicador de logros", async () => {
    const g = nuevoGuild("guild-imp");
    guildSettings.setSetting(g, "logros.reward_multiplier", 2);
    guildSettings.setSetting(g, "plex.importacion_pct", 25);
    vincular(g, 1);
    peli(g, "p", "P", 2001);
    verPeli(g, 1, "p", "P", 2001);
    await plexHistorial.actualizarLogros(g);
    expect(achievements.claimAchievement(g, "disc-1", "plex_pelis_1")).toMatchObject({ reward: 50 }); // 100 × 2 × 25 %
});

describe("Panel admin → Plex → 🏆 Trofeos → 🪙 % de la importación", () => {
    const g = nuevoGuild("guild-imp");
    const interaccion = (extra) => ({
        guildId: g,
        user: { id: "admin" },
        reply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const enviar = async (valor) => {
        const i = interaccion({ customId: "paneladmin_plex_importacion_modal", fields: { getTextInputValue: () => valor } });
        expect(await handlePlexModal(i)).toBe(true);
        return i.reply.mock.calls[0][0].content;
    };

    beforeAll(async () => {
        vincular(g, 1);
        peli(g, "p", "P", 2001);
        verPeli(g, 1, "p", "P", 2001);
        await plexHistorial.actualizarLogros(g);
    });

    test("el panel dice el % y cuántos están importando", () => {
        const d = buildPlexTrofeos(g).embeds[0].data.description;
        expect(d).toMatch(
            /📼 Importación: lo que se desbloquea con lo antiguo da el \*\*50 %\*\* de las monedas · \*\*1\*\* vinculado importando ahora/,
        );
    });

    test("el botón abre un formulario con el % de ahora", async () => {
        const i = interaccion({ customId: "paneladmin_plex_importacion" });
        expect(await handlePlexButton(i)).toBe(true);
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("paneladmin_plex_importacion_modal");
        expect(modal.components[0].components[0]).toMatchObject({ custom_id: "pct", value: "50" });
    });

    test("se cambia (0 = nada) y vale al reclamar lo ya desbloqueado; con números raros, avisa", async () => {
        expect(await enviar("0")).toMatch(/^✅ .*da ahora el \*\*0 %\*\* de las monedas \(antes, el 50 %\)/);
        expect(achievements.claimAchievement(g, "disc-1", "plex_pelis_1")).toMatchObject({ ok: true, reward: 0 });
        expect(await enviar("150")).toBe("❌ Tiene que ser un número de 0 a 100.");
        expect(await enviar("mitad")).toBe("❌ Tiene que ser un número de 0 a 100.");
        expect(await enviar("75 %")).toMatch(/da ahora el \*\*75 %\*\*/);
        expect(achievements.porcentajeImportacion(g)).toBe(75);
        const auditoria = db.prepare("SELECT action FROM admin_audit WHERE guildId = ? ORDER BY rowid DESC LIMIT 1").get(g);
        expect(auditoria.action).toBe("plex.importacion.pct");
    });

    test("al 100 % no se menciona la importación en el perfil", async () => {
        const g2 = nuevoGuild("guild-imp");
        guildSettings.setSetting(g2, "plex.importacion_pct", 100);
        vincular(g2, 1);
        peli(g2, "p", "P", 2001);
        verPeli(g2, 1, "p", "P", 2001);
        await plexHistorial.actualizarLogros(g2);
        const p = perfilPanel.buildLogros(g2, "disc-1", "disc-1");
        expect(p.embeds[0].data.description).not.toMatch(/importación/);
        const menu = p.components.find((f) => f.components[0].data.custom_id?.startsWith("perfil_reclamar_")).components[0];
        expect(menu.options.find((o) => o.data.value === "plex_pelis_1").data.description).toBe("+100 🪙");
    });
});

test("la migración 018 añade la tabla y las columnas sin tocar lo que había", () => {
    const Database = require("better-sqlite3");
    const { runMigrations } = require("../src/core/migrations");
    const bd = new Database(":memory:");
    // Una BD en la 017 con un logro ya completado.
    const migraciones = require("../src/core/migrations").listMigrations();
    bd.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    for (const m of migraciones.filter((x) => x.version <= 17)) {
        require(m.file).up(bd, { log: { info() {}, warn() {} } });
        bd.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(m.version, m.name, Date.now());
    }
    bd.prepare(
        "INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES ('g', 'u', 'plex_pelis_1', 1, 5)",
    ).run();
    expect(runMigrations(bd)).toBe(3); // 018 (este test) + 019 (notas/embeddings) + 020 (impuestos), ajenas a Plex
    expect(bd.prepare("SELECT importado, completedAt FROM achievements_progress").get()).toEqual({ importado: 0, completedAt: 5 });
    const columnas = (t) =>
        bd
            .prepare(`PRAGMA table_info(${t})`)
            .all()
            .map((c) => c.name);
    expect(columnas("plex_importacion")).toEqual(["guildId", "userId", "inicio", "fin"]);
    expect(columnas("plex_fichas")).toEqual(expect.arrayContaining(["alta", "altas"]));
});
