// 📊 Panel de estadísticas del servidor (#538): contadores diarios, agregación por día de Madrid de cada métrica (mensajes,
// XP, economía neta, apuestas y horas de Plex), resumen con variación, formateo de la gráfica sin renderizarla, la migración
// que arranca la XP con lo que hay, el índice del historial y el panel admin con su caché de 5 minutos. BD en memoria.
const db = require("../src/core/db");
const { runMigrations } = require("../src/core/migrations");
const adminAudit = require("../src/systems/adminAudit");
const estadisticas = require("../src/systems/estadisticas");
const diaria = require("../src/systems/xp/diaria");
const { opcionGrafica, textoResumen } = require("../src/paneles/estadisticas");
const panel = require("../src/adminPanel/estadisticas");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildConfigHome } = require("../src/adminPanel/settings/vistas");

const G = "g-estadisticas";
// Sábado 24/10/2026 a las 12:00 en Madrid.
const AHORA = Date.parse("2026-10-24T10:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;
let siguientePlex = 0;

const historial = (fecha, cantidad, tipo = "casino") =>
    db
        .prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES ('u', ?, 'x', ?, ?)")
        .run(new Date(fecha).toISOString(), cantidad, tipo);
const plex = (guildId, inicio, segundos) =>
    db
        .prepare(
            `INSERT INTO plex_reproducciones (guildId, id, tautulliUserId, tipo, rating_key, titulo, anio, inicio, segundos, porcentaje, visto)
             VALUES (?, ?, '1', 'movie', 'k', 'Peli', 2024, ?, ?, 100, 1)`,
        )
        .run(guildId, ++siguientePlex, Math.floor(inicio / 1000), segundos);
const valores = (s) => s.map((d) => d.valor);

beforeEach(() => {
    for (const t of ["estadisticas_diarias", "historial", "plex_reproducciones", "xp_diaria"]) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    panel._vaciarCache();
    panel.opciones.render = jest.fn(() => Buffer.from("png-falso"));
    panel.opciones.ahora = () => AHORA;
});

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(() => {
    panel.opciones.render = null;
    panel.opciones.ahora = () => Date.now();
});

describe("contadores diarios (#538)", () => {
    test("cuentan por servidor, métrica y día de Madrid", () => {
        estadisticas.contar(G, "mensajes", 1, AHORA);
        estadisticas.contar(G, "mensajes", 1, AHORA);
        estadisticas.contar(G, "mensajes", 1, Date.parse("2026-10-23T22:30:00Z")); // ya es día 24 en Madrid
        estadisticas.contar("otro", "mensajes", 5, AHORA);
        estadisticas.contar(G, "mensajes", 0, AHORA);
        expect(db.prepare("SELECT dia, valor FROM estadisticas_diarias WHERE guildId = ? AND metrica = 'mensajes'").all(G)).toEqual([
            { dia: "2026-10-24", valor: 3 },
        ]);
    });

    test("la XP diaria también se apunta en las estadísticas, que no se borran a las dos semanas", () => {
        diaria.sumar(G, "ana", "2026-10-24", 40);
        diaria.sumar(G, "luis", "2026-10-24", 10);
        diaria.limpiar("2026-12-31");
        expect(db.prepare("SELECT COUNT(*) AS n FROM xp_diaria").get().n).toBe(0);
        expect(db.prepare("SELECT SUM(valor) AS v FROM estadisticas_diarias WHERE guildId = ? AND metrica = 'xp'").get(G).v).toBe(50);
    });
});

describe("las series (#538)", () => {
    test("tienen un valor por día, del más antiguo a hoy, con 0 los días sin datos", () => {
        estadisticas.contar(G, "mensajes", 4, AHORA);
        estadisticas.contar(G, "mensajes", 2, AHORA - 2 * DIA);
        const s = estadisticas.serie(G, "mensajes", 7, { ahora: AHORA });
        expect(s.map((d) => d.dia)).toEqual([
            "2026-10-18",
            "2026-10-19",
            "2026-10-20",
            "2026-10-21",
            "2026-10-22",
            "2026-10-23",
            "2026-10-24",
        ]);
        expect(valores(s)).toEqual([0, 0, 0, 0, 2, 0, 4]);
        expect(estadisticas.serie(G, "mensajes", 90, { ahora: AHORA })).toHaveLength(90);
    });

    test("economía neta: suma lo que entra y sale del efectivo, sin los movimientos del banco, por día de Madrid", () => {
        historial(AHORA, 500);
        historial(AHORA, -200, "tienda");
        historial(AHORA, 10000, "banco");
        historial(Date.parse("2026-10-23T22:30:00Z"), 50); // 00:30 del 24 en Madrid
        historial(Date.parse("2026-10-23T21:30:00Z"), 70); // 23:30 del 23 en Madrid
        expect(valores(estadisticas.serie(G, "economia", 2, { ahora: AHORA }))).toEqual([70, 350]);
    });

    test("apuestas: solo lo apostado (los movimientos negativos de apuestas)", () => {
        historial(AHORA, -100, "apuestas");
        historial(AHORA, -50, "apuestas");
        historial(AHORA, 300, "apuestas");
        historial(AHORA, -999, "casino");
        expect(valores(estadisticas.serie(G, "apuestas", 1, { ahora: AHORA }))).toEqual([150]);
    });

    test("horas de Plex del servidor, con un decimal", () => {
        plex(G, AHORA - 2 * 60 * 60 * 1000, 5400);
        plex(G, AHORA - 60 * 60 * 1000, 1800);
        plex("otro", AHORA, 36000);
        expect(valores(estadisticas.serie(G, "plex", 1, { ahora: AHORA }))).toEqual([2]);
    });

    test("una métrica desconocida es un error", () => {
        expect(() => estadisticas.serie(G, "inventada", 7)).toThrow("Métrica desconocida");
    });

    test("el historial por fechas usa su índice", () => {
        const plan = db
            .prepare(
                "EXPLAIN QUERY PLAN SELECT substr(fecha, 1, 13) AS h, SUM(cantidad) FROM historial WHERE fecha >= ? AND fecha < ? GROUP BY h",
            )
            .all("a", "b")
            .map((r) => r.detail)
            .join(" ");
        expect(plan).toContain("idx_historial_fecha");
    });
});

describe("el resumen (#538)", () => {
    const s = (...v) => v.map((valor, i) => ({ dia: `2026-10-${String(10 + i).padStart(2, "0")}`, valor }));

    test("total, media, mejor día y variación respecto al periodo anterior", () => {
        expect(estadisticas.resumen(s(10, 30, 20), s(20, 10, 0))).toEqual({
            total: 60,
            media: 20,
            mejor: { dia: "2026-10-11", valor: 30 },
            totalAntes: 30,
            variacion: 100,
        });
    });

    test("sin datos antes no hay variación, y sin datos ahora no hay mejor día", () => {
        expect(estadisticas.resumen(s(0, 0), s(0, 0))).toMatchObject({ total: 0, media: 0, mejor: null, variacion: null });
    });

    test("la variación tiene signo también con totales negativos (economía)", () => {
        expect(estadisticas.resumen(s(-50), s(-100)).variacion).toBe(50);
        expect(estadisticas.resumen(s(-150), s(100)).variacion).toBe(-250);
    });

    test("el periodo compara con los mismos días justo antes", () => {
        estadisticas.contar(G, "mensajes", 10, AHORA);
        estadisticas.contar(G, "mensajes", 5, AHORA - 8 * DIA);
        const p = estadisticas.periodo(G, "mensajes", 7, AHORA);
        expect(p.resumen).toMatchObject({ total: 10, totalAntes: 5, variacion: 100 });
    });
});

describe("el formateo, sin dibujar (#538)", () => {
    const periodo = {
        metrica: "economia",
        dias: 30,
        serie: Array.from({ length: 30 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, "0")}`, valor: i })),
    };

    test("la gráfica es de barras, con un día por barra y el título de la métrica", () => {
        const o = opcionGrafica(periodo);
        expect(o.title.text).toBe("Economía neta · últimos 30 días");
        expect(o.xAxis.data).toHaveLength(30);
        expect(o.xAxis.data[0]).toBe("01/10");
        expect(o.series[0]).toMatchObject({ type: "bar", data: periodo.serie.map((d) => d.valor) });
    });

    test("el resumen dice total, media, mejor día y variación, y avisa de que el dinero es de todo el bot", () => {
        const t = textoResumen({
            ...periodo,
            resumen: { total: 1234.5, media: 41.2, mejor: { dia: "2026-10-30", valor: 29 }, variacion: -12.5 },
        });
        expect(t).toContain("**Total:** 1234,5 monedas");
        expect(t).toContain("**Mejor día:** 30/10 (29)");
        expect(t).toContain("📉 -12,5 %");
        expect(t).toContain("de todo el bot");
        const sinAntes = textoResumen({ metrica: "xp", dias: 7, resumen: { total: 0, media: 0, mejor: null, variacion: null } });
        expect(sinAntes).toContain("sin datos del periodo anterior");
        expect(sinAntes).not.toContain("de todo el bot");
    });
});

describe("la migración 083 (#538)", () => {
    test("arranca la XP con lo que aún hay en xp_diaria, y una segunda pasada no duplica", () => {
        db.prepare(
            "INSERT INTO xp_diaria (guildId, userId, dia, xp) VALUES (?, 'ana', '2026-10-20', 30), (?, 'luis', '2026-10-20', 12)",
        ).run(G, G);
        db.prepare("DELETE FROM schema_migrations WHERE version = 83").run();
        runMigrations(db);
        db.prepare("DELETE FROM schema_migrations WHERE version = 83").run();
        runMigrations(db);
        expect(
            db.prepare("SELECT valor FROM estadisticas_diarias WHERE guildId = ? AND metrica = 'xp' AND dia = '2026-10-20'").get(G).valor,
        ).toBe(42);
    });
});

describe("📊 Estadísticas en el panel admin (#538)", () => {
    function interaccion(customId, extra = {}, admin = true) {
        return {
            customId,
            guildId: G,
            user: { id: "admin", tag: "admin" },
            client: {},
            memberPermissions: { has: () => admin },
            member: { permissions: { has: () => admin } },
            reply: jest.fn(async () => {}),
            deferUpdate: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
            ...extra,
        };
    }
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components);

    test("está en ⚙️ Config Global sin pasar de 5 filas", () => {
        const p = buildConfigHome(G);
        expect(p.components.length).toBeLessThanOrEqual(5);
        expect(ids(p).map((c) => c.custom_id)).toContain("paneladmin_stats_home");
    });

    test("sin admin no se abre ni se calcula nada", async () => {
        const i = interaccion("paneladmin_stats_home", {}, false);
        await paneladmin.handleButton(i.client, i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes permisos." }));
        expect(panel.opciones.render).not.toHaveBeenCalled();
    });

    test("abrirlo audita quién lo abre y enseña la gráfica de mensajes de 7 días con su resumen", async () => {
        estadisticas.contar(G, "mensajes", 12, AHORA);
        const i = interaccion("paneladmin_stats_home");
        await paneladmin.handleButton(i.client, i);
        const p = i.editReply.mock.calls[0][0];
        expect(p.embeds[0].data.title).toBe("📊 💬 Mensajes · 7 días");
        expect(p.embeds[0].data.image.url).toBe("attachment://estadisticas.png");
        expect(p.files[0].name).toBe("estadisticas.png");
        expect(p.embeds[0].data.description).toContain("**Total:** 12 mensajes");
        expect(adminAudit.listRecent(G, 5).map((a) => a.action)).toContain("consulta.estadisticas");
    });

    test("cambiar de rango y de métrica actualiza la vista y la caché evita repetir la consulta 5 minutos", async () => {
        const rango = interaccion("paneladmin_stats_ver_mensajes_30");
        await paneladmin.handleButton(rango.client, rango);
        expect(rango.editReply.mock.calls[0][0].embeds[0].data.title).toBe("📊 💬 Mensajes · 30 días");
        const botones = ids(rango.editReply.mock.calls[0][0]);
        expect(botones.find((c) => c.custom_id === "paneladmin_stats_ver_mensajes_30").disabled).toBe(true);
        expect(botones.find((c) => c.custom_id === "paneladmin_stats_actualizar_mensajes_30").disabled).toBe(true);

        const otraVez = interaccion("paneladmin_stats_ver_mensajes_30");
        await paneladmin.handleButton(otraVez.client, otraVez);
        expect(panel.opciones.render).toHaveBeenCalledTimes(1);

        const metrica = interaccion("paneladmin_stats_metrica_30", { values: ["plex"] });
        await paneladmin.handleStringSelect(metrica.client, metrica);
        expect(metrica.editReply.mock.calls[0][0].embeds[0].data.title).toBe("📊 🎬 Horas de Plex · 30 días");
        expect(panel.opciones.render).toHaveBeenCalledTimes(2);
    });

    test("pasados 5 minutos se puede actualizar y vuelve a calcular", async () => {
        const i = interaccion("paneladmin_stats_ver_xp_7");
        await paneladmin.handleButton(i.client, i);
        panel.opciones.ahora = () => AHORA + panel.CACHE_MS;
        const act = interaccion("paneladmin_stats_actualizar_xp_7");
        await paneladmin.handleButton(act.client, act);
        expect(panel.opciones.render).toHaveBeenCalledTimes(2);
        const boton = ids(act.editReply.mock.calls[0][0]).find((c) => c.custom_id === "paneladmin_stats_actualizar_xp_7");
        expect(boton.disabled).toBe(true);
    });

    test("una métrica o un rango que no existen no hacen nada", async () => {
        expect(await panel.handleEstadisticasButton(interaccion("paneladmin_stats_ver_inventada_7"))).toBe(false);
        expect(await panel.handleEstadisticasButton(interaccion("paneladmin_stats_ver_xp_365"))).toBe(false);
        expect(panel.opciones.render).not.toHaveBeenCalled();
    });
});
