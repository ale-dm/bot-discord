// Fase 8 (perfil, clasificación y patrimonio): próximo cobro y resumen del patrimonio (#347, #350), premios semanales (#355, #372),
// histórico (#360), esta semana (#368), el más constante (#391), aviso del domingo (#394), economía oculta (#377), evolución del
// dinero (#388), roles exentos (#397) y ranking de patrimonio neto (#401). La BD es la de setupEnv.js (en memoria).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const clasificacion = require("../src/systems/clasificacionSemanal");
const historial = require("../src/systems/clasificacion/historial");
const avisoDomingo = require("../src/systems/clasificacion/avisoDomingo");
const patrimonio = require("../src/systems/patrimonio");
const patrimonioDiario = require("../src/systems/patrimonioDiario");
const patrimonioNeto = require("../src/systems/patrimonioNeto");
const privacidad = require("../src/systems/privacidadEconomia");
const cripto = require("../src/systems/cripto/mercado");
const economia = require("../src/paneles/economia");
const ficha = require("../src/paneles/perfil/ficha");
const rankings = require("../src/paneles/perfil/rankings");
const semana = require("../src/paneles/perfil/rankingsSemana");
const { embedDomingo } = require("../src/discord/mensajes/clasificacionDomingo");
const dineroBotones = require("../src/perfil/dinero");
const perfil = require("../src/commands/progresion/perfil");
const adminClasificacion = require("../src/adminPanel/clasificacion");

let n = 0;
const nuevoServidor = () => `g-f8-${++n}`;
const cuenta = (id, efectivo = 0, banco = 0) => {
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ?, saldo = ? WHERE userId = ?").run(efectivo, banco, id);
    return id;
};
const SEMANA = { lunes: "2026-10-05", domingo: "2026-10-11" };
const xpDia = (g, u, dia, xp) =>
    db.prepare("INSERT OR REPLACE INTO xp_diaria (guildId, userId, dia, xp) VALUES (?, ?, ?, ?)").run(g, u, dia, xp);

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("patrimonio: previsión y resumen (#347, #350)", () => {
    test("la previsión coincide con lo que cobra aplicarCiclo y no toca nada", () => {
        const u = cuenta("f8-prev", 0, 200000);
        const cfg = patrimonio.configuracion();
        const antes = dinero.cuenta(u);
        const p = patrimonio.prevision(u);
        expect(dinero.cuenta(u)).toEqual(antes);
        expect(dinero.movimientos(u).filas).toHaveLength(0);
        expect(p.proximo).toBeNull(); // sin fila de ciclo todavía
        const real = patrimonio.aplicarCiclo(u, cfg);
        expect({ interes: p.interes, impuesto: p.impuesto }).toEqual({ interes: real.interes, impuesto: real.cobrado });
        expect(p.impuesto).toBeGreaterThan(0);
    });

    test("con fila de ciclo, el próximo cobro es ultimo_ciclo + días", () => {
        const u = cuenta("f8-prox", 0, 10);
        const t0 = Date.parse("2026-10-01T10:00:00Z");
        db.prepare("INSERT INTO patrimonio_usuario (userId, ultimo_ciclo) VALUES (?, ?)").run(u, t0);
        expect(patrimonio.prevision(u).proximo).toBe(t0 + patrimonio.configuracion().dias * 86400000);
    });

    test("el resumen separa el interés y el impuesto de patrimonio del impuesto de ingresos, desde siempre y del último mes", () => {
        const u = cuenta("f8-res");
        expect(patrimonio.resumen(u)).toBeNull();
        const ins = db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, ?, ?, ?)");
        const ahora = Date.parse("2026-10-14T12:00:00Z");
        ins.run(u, "2026-10-10T10:00:00.000Z", "Interés semanal del banco", 100, "patrimonio");
        ins.run(u, "2026-10-10T10:00:00.000Z", "Impuesto de patrimonio", -40, "impuesto");
        ins.run(u, "2026-08-01T10:00:00.000Z", "Interés semanal del banco", 50, "patrimonio");
        ins.run(u, "2026-10-11T10:00:00.000Z", "Impuesto sobre 🎰 Casino", -999, "impuesto"); // ingresos: no cuenta
        expect(patrimonio.resumen(u, ahora)).toEqual({
            total: { interes: 150, impuesto: 40, neto: 110 },
            mes: { interes: 100, impuesto: 40, neto: 60 },
        });
    });

    test("💰 Economía lo enseña: próximo cobro solo en la propia, y 'sin cobros' si no hay", async () => {
        const u = cuenta("f8-eco", 100, 100);
        const propio = await economia.buildEconomia({ viewerId: u, nombre: "yo", guildId: "g" });
        const nombres = propio.embeds[0].data.fields.map((f) => f.name);
        expect(nombres).toEqual(expect.arrayContaining(["🏦 Patrimonio", "⏳ Próximo cobro de patrimonio", "📈 Últimos 30 días"]));
        expect(propio.embeds[0].data.fields.find((f) => f.name === "🏦 Patrimonio").value).toBe("Sin cobros de patrimonio todavía");
        expect(propio.embeds[0].data.fields.find((f) => f.name.startsWith("⏳")).value).toMatch(/próximo chequeo/);
        const ajeno = await economia.buildEconomia({ viewerId: "otra-persona", targetId: u, nombre: "u", guildId: "g" });
        expect(ajeno.embeds[0].data.fields.some((f) => f.name.startsWith("⏳"))).toBe(false);
    });
});

describe("evolución del dinero (#388)", () => {
    test("guarda una fila por persona y día (sin pisar), barras y cambio neto", () => {
        const u = cuenta("f8-evo", 100, 100);
        const dia = (iso) => Date.parse(`${iso}T12:00:00Z`);
        expect(patrimonioDiario.evolucion(u, dia("2026-10-10"))).toBeNull();
        patrimonioDiario.guardarHoy(dia("2026-10-10"));
        db.prepare("UPDATE banco SET enMano = 500 WHERE userId = ?").run(u);
        patrimonioDiario.guardarHoy(dia("2026-10-10")); // mismo día: no pisa
        patrimonioDiario.guardarHoy(dia("2026-10-11"));
        db.prepare("UPDATE banco SET enMano = 50 WHERE userId = ?").run(u);
        patrimonioDiario.guardarHoy(dia("2026-10-12"));
        expect(patrimonioDiario.ultimos(u, dia("2026-10-12")).map((f) => f.total)).toEqual([200, 600, 150]);
        const e = patrimonioDiario.evolucion(u, dia("2026-10-12"));
        expect(e).toMatchObject({ dias: 3, neto: -50 });
        expect(e.barras).toHaveLength(3);
        expect([...e.barras][1]).toBe("█");
        expect([...e.barras][0] < [...e.barras][1]).toBe(true);
    });

    test("solo 30 días y se borra lo de más de 35", () => {
        const u = cuenta("f8-evo2", 10, 0);
        db.prepare(
            "INSERT INTO patrimonio_diario (userId, dia, total) VALUES (?, '2026-01-01', 1), (?, '2026-09-12', 2), (?, '2026-10-10', 3)",
        ).run(u, u, u);
        const ahora = Date.parse("2026-10-14T12:00:00Z");
        patrimonioDiario.guardarHoy(ahora);
        expect(
            db
                .prepare("SELECT dia FROM patrimonio_diario WHERE userId = ? ORDER BY dia")
                .all(u)
                .map((r) => r.dia),
        ).toEqual(["2026-09-12", "2026-10-10", "2026-10-14"]);
        expect(patrimonioDiario.ultimos(u, ahora).map((f) => f.dia)).toEqual(["2026-10-10", "2026-10-14"]);
    });
});

describe("economía oculta a los demás (#377)", () => {
    test("la propia persona lo ve todo; otra ve 'ha ocultado' en Economía y no puede abrir movimientos", async () => {
        const dueno = cuenta("f8-priv", 777, 0);
        privacidad.fijar(dueno, true);
        const ajeno = await economia.buildEconomia({ viewerId: "curioso", targetId: dueno, nombre: "dueño", guildId: "g" });
        expect(ajeno.embeds[0].data.description).toMatch(/ha ocultado su economía/);
        expect(ajeno.embeds[0].data.fields).toBeUndefined();
        const propio = await economia.buildEconomia({ viewerId: dueno, nombre: "yo", guildId: "g" });
        expect(propio.embeds[0].data.fields.some((f) => f.name === "💵 Efectivo")).toBe(true);
        expect(propio.components.flatMap((r) => r.components.map((c) => c.data.custom_id))).toContain("dinero_privada_0");

        const i = {
            customId: `dinero_mov_todo_0_${dueno}`,
            user: { id: "curioso" },
            message: { interaction: { user: { id: "curioso" } } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await dineroBotones.handleButton(null, i);
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toMatch(/ocultado/);
        const sel = {
            customId: `dinero_filtro_${dueno}`,
            values: ["casino"],
            user: { id: "curioso" },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await dineroBotones.handleSelect(null, sel);
        expect(sel.update).not.toHaveBeenCalled();
    });

    test("el botón de la propia pantalla activa y quita la opción", async () => {
        const u = cuenta("f8-priv2", 10, 0);
        const i = (customId) => ({
            customId,
            user: { id: u, username: u, tag: u },
            guildId: "g",
            message: { interaction: { user: { id: u } } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        });
        await dineroBotones.handleButton(null, i("dinero_privada_1"));
        expect(privacidad.oculta(u)).toBe(true);
        await dineroBotones.handleButton(null, i("dinero_privada_0"));
        expect(privacidad.oculta(u)).toBe(false);
    });

    test("la ficha de 👤 Perfil no enseña el dinero a otra persona, pero sí los premios semanales", async () => {
        const guild = { id: "g-f8-ficha", name: "S", members: { cache: new Map(), fetch: async () => null }, iconURL: () => null };
        const dueno = cuenta("f8-ficha", 5, 5);
        const verCampos = async (viewer) => (await ficha.buildPerfil(guild, viewer, dueno)).embeds[0].data.fields?.map((f) => f.name) ?? [];
        expect(await verCampos(dueno)).toContain("💰 Dinero");
        expect(await verCampos("otro")).toContain("💰 Dinero");
        privacidad.fijar(dueno, true);
        expect(await verCampos("otro")).not.toContain("💰 Dinero");
        expect(await verCampos(dueno)).toContain("💰 Dinero");
        db.prepare(
            "INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, '2026-10-05T10:00:00.000Z', 'Clasificación semanal: el más rico', 500, 'premio')",
        ).run(dueno);
        db.prepare(
            "INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, '2026-10-06T10:00:00.000Z', 'Meta comunitaria', 500, 'premio')",
        ).run(dueno);
        const campos = (await ficha.buildPerfil(guild, "otro", dueno)).embeds[0].data.fields;
        expect(campos.find((f) => f.name === "🏆 Premios semanales").value).toMatch(/^\*\*1\*\*/);
        expect(historial.premiosDe(dueno).total).toBe(1);
        expect(historial.premiosDe("nadie").total).toBe(0);
        expect(
            (await ficha.buildPerfil(guild, "otro", "f8-sin-premios")).embeds[0].data.fields?.some(
                (f) => f.name === "🏆 Premios semanales",
            ) ?? false,
        ).toBe(false);
    });
});

describe("clasificación semanal: constante, premios por categoría e histórico (#391, #372, #360)", () => {
    test("el más constante: más días con XP y, en empate, más XP; sin XP no se da", () => {
        const g = nuevoServidor();
        expect(clasificacion.ganadores(g, SEMANA).constante).toBeNull();
        ["2026-10-05", "2026-10-06", "2026-10-07"].forEach((d) => xpDia(g, "pocoXp", d, 10));
        ["2026-10-05", "2026-10-06", "2026-10-07"].forEach((d) => xpDia(g, "mucho", d, 500));
        xpDia(g, "intenso", "2026-10-08", 99999);
        xpDia(g, "pocoXp", "2026-10-20", 1); // otra semana: no cuenta
        expect(clasificacion.ganadores(g, SEMANA).constante).toEqual({ userId: "mucho", dias: 3, xp: 1500 });
    });

    test("el premio de cada categoría, con el general como respaldo", () => {
        const cfg = { premio: 500, premio_rico: 900, premio_activo: -1, premio_apostador: 0, premio_constante: undefined };
        expect(clasificacion.premioDe(cfg, "rico")).toBe(900);
        expect(clasificacion.premioDe(cfg, "activo")).toBe(500);
        expect(clasificacion.premioDe(cfg, "apostador")).toBe(0);
        expect(clasificacion.premioDe(cfg, "constante")).toBe(500);
    });

    test("el mensaje: con premios iguales, 'Cada premio'; con distintos, cada línea el suyo", () => {
        const g = {
            rico: { userId: "a", total: 10 },
            activo: { userId: "b", xp: 5 },
            apostador: null,
            constante: { userId: "c", dias: 4 },
        };
        expect(clasificacion.mensaje(g, SEMANA, 500).content).toMatch(/Cada premio: \*\*500\*\*/);
        const distinto = clasificacion.mensaje(g, SEMANA, { rico: 900, activo: 500, apostador: 500, constante: 100 }).content;
        expect(distinto).toMatch(/El más rico\*\*: <@a>.*900/);
        expect(distinto).toMatch(/El más constante\*\*: <@c> \(4 días con XP\) · \*\*100\*\*/);
        expect(distinto).not.toMatch(/Cada premio:/);
    });

    test("publicar paga a cada ganador su premio, guarda el histórico y las semanas viejas salen vacías", async () => {
        const g = nuevoServidor();
        cuenta("f8-rico", 99999999, 0);
        db.prepare("INSERT INTO xp_users (guildId, userId, xp_total) VALUES (?, 'f8-activo', 500)").run(g);
        xpDia(g, "f8-const", "2026-10-06", 5);
        guildSettings.setManySettings(g, {
            "clasificacion.canal": "c1",
            "clasificacion.premio": 100,
            "clasificacion.premio_rico": 1000,
            "clasificacion.premio_constante": 300,
        });
        const send = jest.fn(async () => {});
        const guild = { id: g, name: "S", channels: { cache: new Map([["c1", { isTextBased: () => true, send }]]) } };
        expect(historial.ultimasSemanas(g)).toEqual([]);
        const r = await clasificacion.publicar(guild, { semana: SEMANA });
        expect(r.ok).toBe(true);
        const premio = (u) => db.prepare("SELECT cantidad FROM historial WHERE userId = ? AND tipo = 'premio'").get(u)?.cantidad;
        expect(premio("f8-rico")).toBe(1000);
        expect(premio("f8-activo")).toBe(100);
        expect(premio("f8-const")).toBe(300);
        const [s] = historial.ultimasSemanas(g);
        expect(s.semana).toBe("2026-10-05");
        expect(s.ganadores.rico.userId).toBe("f8-rico");
        expect(s.ganadores.constante).toMatchObject({ userId: "f8-const", valor: 1 });
        expect(send.mock.calls[0][0].content).toMatch(/\*\*1000\*\*/);
    });

    test("🏆 Rankings → 🗓️ Semanas enseña las últimas 8, la más reciente primero", () => {
        const g = nuevoServidor();
        for (let i = 0; i < 10; i++) {
            const lunes = `2026-01-${String(i + 1).padStart(2, "0")}`;
            db.prepare("INSERT INTO clasificacion_historial (guildId, semana, categoria, userId, valor) VALUES (?, ?, 'rico', 'u', 1)").run(
                g,
                lunes,
            );
        }
        const e = semana.embedSemanas(g);
        expect(e.data.fields).toHaveLength(8);
        expect(semana.embedSemanas(nuevoServidor()).data.description).toMatch(/Todavía no hay semanas/);
    });
});

describe("esta semana (#368)", () => {
    test("el primero del ranking es el más activo de ganadores(), y el pie dice cuándo se publica", () => {
        const g = nuevoServidor();
        db.prepare("INSERT INTO xp_users (guildId, userId, xp_total) VALUES (?, 'a', 300), (?, 'b', 900), (?, 'c', 50)").run(g, g, g);
        db.prepare("INSERT INTO clasificacion_xp (guildId, userId, xp_total) VALUES (?, 'b', 100)").run(g);
        const lista = clasificacion.ranking(g, 10);
        expect(lista[0]).toEqual({ userId: "b", xp: 800 });
        expect(clasificacion.ganadores(g, SEMANA).activo).toEqual(lista[0]);
        const e = semana.embedEstaSemana(g, Date.parse("2026-10-14T12:00:00Z"));
        expect(e.data.description).toMatch(/^🥇 <@b> — \*\*\+800\*\* XP/);
        expect(e.data.fields[0].value).toMatch(/Sin canal/);
        guildSettings.setSetting(g, "clasificacion.canal", "x");
        const con = semana.embedEstaSemana(g, Date.parse("2026-10-14T12:00:00Z"));
        expect(con.data.fields[0].value).toMatch(/<t:\d+:F>/);
    });

    test("la próxima publicación es el próximo lunes a las 10:00 de Madrid (hoy mismo si es lunes antes de las 10)", () => {
        const iso = (ms) => new Date(ms).toISOString();
        expect(iso(semana.proximaPublicacion(Date.parse("2026-10-14T12:00:00Z")))).toBe("2026-10-19T08:00:00.000Z");
        expect(iso(semana.proximaPublicacion(Date.parse("2026-10-12T05:00:00Z")))).toBe("2026-10-12T08:00:00.000Z");
        expect(iso(semana.proximaPublicacion(Date.parse("2026-10-12T09:00:00Z")))).toBe("2026-10-19T08:00:00.000Z");
    });

    test("están los tres rankings nuevos en el menú", async () => {
        const g = { id: nuevoServidor(), name: "S", members: { cache: new Map() } };
        for (const tipo of ["semana", "semanas", "patrimonio"]) {
            expect(Object.keys(rankings.RANKINGS)).toContain(tipo);
            const p = await rankings.buildRankings(g, "u", "u", tipo);
            expect(p.embeds[0].data.title).toBeTruthy();
        }
    });
});

describe("aviso del domingo (#394)", () => {
    const client = (g, envios, fallar = []) => ({
        guilds: { cache: new Map([[g, { id: g, name: "S" }]]) },
        users: {
            fetch: async (id) => {
                if (fallar.includes(id)) throw Object.assign(new Error("cerrado"), { code: 50007 });
                return { send: async (p) => envios.push({ id, p }) };
            },
        },
    });
    const DOMINGO = Date.parse("2026-10-11T18:30:00Z"); // 20:30 en Madrid

    test("solo a quien lo activó y va primero, una vez por semana, y un DM que falla no corta el resto", async () => {
        const g = nuevoServidor();
        guildSettings.setSetting(g, "clasificacion.canal", "c");
        guildSettings.setSetting(g, "clasificacion.premio", 200);
        db.prepare("INSERT INTO xp_users (guildId, userId, xp_total) VALUES (?, 'f8d-activo', 900), (?, 'f8d-no', 10)").run(g, g);
        xpDia(g, "f8d-activo", "2026-10-06", 5);
        xpDia(g, "f8d-const2", "2026-10-06", 5);
        xpDia(g, "f8d-const2", "2026-10-07", 5);
        avisoDomingo.fijar(g, "f8d-activo", true);
        avisoDomingo.fijar(g, "f8d-const2", true);
        const envios = [];
        expect(await avisoDomingo.avisarLideres(client(g, envios, ["f8d-activo"]), embedDomingo, DOMINGO)).toBe(1);
        expect(envios.map((e) => e.id)).toEqual(["f8d-const2"]);
        expect(envios[0].p.embeds[0].data.description).toMatch(/El más constante/);
        // Segundo envío esa semana: el que ya recibió no repite; el que falló vuelve a intentarse.
        envios.length = 0;
        expect(await avisoDomingo.avisarLideres(client(g, envios), embedDomingo, DOMINGO)).toBe(1);
        expect(envios.map((e) => e.id)).toEqual(["f8d-activo"]);
        expect(await avisoDomingo.avisarLideres(client(g, envios), embedDomingo, DOMINGO)).toBe(0);
    });

    test("sin canal de clasificación no se avisa, y fijar/leer la preferencia", async () => {
        const g = nuevoServidor();
        xpDia(g, "f8d-x", "2026-10-06", 5);
        avisoDomingo.fijar(g, "f8d-x", true);
        expect(avisoDomingo.activo(g, "f8d-x")).toBe(true);
        expect(await avisoDomingo.avisarLideres(client(g, []), embedDomingo, DOMINGO)).toBe(0);
        avisoDomingo.fijar(g, "f8d-x", false);
        expect(avisoDomingo.activo(g, "f8d-x")).toBe(false);
    });

    test("el botón del perfil lo activa", async () => {
        const g = nuevoServidor();
        const i = {
            customId: "perfil_domingo_u1_u1_1",
            guild: { id: g, name: "S", members: { cache: new Map(), fetch: async () => null }, iconURL: () => null },
            guildId: g,
            user: { id: "u1", username: "u1", tag: "u1" },
            client: { users: { fetch: async (id) => ({ id, username: id }) } },
            message: { interaction: { user: { id: "u1" } } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        };
        await perfil.handleButton(null, i);
        expect(avisoDomingo.activo(g, "u1")).toBe(true);
    });
});

describe("panel de la clasificación: premios por categoría (#372)", () => {
    const modal = (g, campos) => ({
        customId: "paneladmin_semanal_premios_modal",
        guildId: g,
        user: { id: "admin" },
        fields: { getTextInputValue: (id) => campos[id] ?? "" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    });

    test("guarda el premio propio y vacío usa el general; los valores raros se rechazan", async () => {
        const g = nuevoServidor();
        const ok = modal(g, { rico: "900", activo: "", apostador: "0", constante: "300" });
        await adminClasificacion.handleClasificacionModal(ok);
        const cfg = guildSettings.getSettings(g).clasificacion;
        expect([cfg.premio_rico, cfg.premio_activo, cfg.premio_apostador, cfg.premio_constante]).toEqual([900, -1, 0, 300]);
        expect(clasificacion.premioDe(cfg, "activo")).toBe(cfg.premio);
        const mal = modal(g, { rico: "-5" });
        await adminClasificacion.handleClasificacionModal(mal);
        expect(mal.reply.mock.calls[0][0].content).toMatch(/entero de 0 a 1\.000\.000/);
        expect(guildSettings.getSettings(g).clasificacion.premio_rico).toBe(900);
    });
});

describe("patrimonio: roles exentos (#397)", () => {
    afterEach(() => patrimonio.usarResolutorDeRoles(() => []));

    test("con un rol exento no paga impuesto pero cobra el interés; al perder el rol paga en el siguiente ciclo", () => {
        const u = cuenta("f8-exento", 0, 200000);
        db.prepare("INSERT INTO xp_users (guildId, userId, ultimo_msg) VALUES ('g-exentos', ?, 1)").run(u);
        const cfg = { ...patrimonio.configuracion(), rolesExentos: ["vip"] };
        patrimonio.usarResolutorDeRoles((guildId, userId) => (userId === u ? ["otro", "vip"] : []));
        const r = patrimonio.aplicarCiclo(u, cfg);
        expect(r.cobrado).toBe(0);
        expect(r.interes).toBeGreaterThan(0);
        expect(dinero.movimientos(u).filas.some((m) => m.descripcion === "Impuesto de patrimonio")).toBe(false);
        patrimonio.usarResolutorDeRoles(() => ["otro"]);
        expect(patrimonio.aplicarCiclo(u, cfg).cobrado).toBeGreaterThan(0);
    });

    test("la lista de roles se guarda y los guardados del panel normal la conservan", () => {
        const base = patrimonio.configuracion();
        expect(patrimonio.guardarConfiguracion({ ...base, rolesExentos: ["1", 2] }).cfg.rolesExentos).toEqual(["1", "2"]);
        patrimonio.guardarConfiguracion({
            umbral: base.umbral,
            porcentaje: base.porcentaje,
            interes: base.interes,
            dias: base.dias,
            destino: base.destino,
        });
        expect(patrimonio.configuracion().rolesExentos).toEqual(["1", "2"]);
        patrimonio.guardarConfiguracion({ ...base, rolesExentos: [] });
        expect(patrimonio.configuracion().rolesExentos).toEqual([]);
    });
});

describe("ranking de patrimonio neto (#401)", () => {
    beforeEach(() => patrimonioNeto.olvidar());

    test("suma efectivo, banco, negocios y cripto valorada (sin dinero negro) y lee el precio una sola vez", () => {
        const precio = jest.spyOn(cripto, "getTtclPrecio").mockReturnValue(10);
        const u = cuenta("f8-neto", 100, 200);
        db.prepare("UPDATE banco SET negro = 99999 WHERE userId = ?").run(u);
        db.prepare("INSERT INTO negocios_usuario (userId, tipo, guildId, pagado, comprado_en) VALUES (?, 'lavanderia', 'g', 1000, 1)").run(
            u,
        );
        db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 5)").run(u);
        const f = patrimonioNeto.ranking(50).find((x) => x.userId === u);
        expect(f).toEqual(expect.objectContaining({ efectivo: 100, banco: 200, negocios: 1000, cripto: 50, total: 1350 }));
        const llamadas = precio.mock.calls.length;
        expect(llamadas).toBe(1);
        patrimonioNeto.ranking(50); // guardado un minuto
        expect(precio.mock.calls.length).toBe(1);
    });

    test("quien tiene su dinero en cripto sale por encima de quien tiene menos en total, y el premio 'más rico' no cambia", () => {
        jest.spyOn(cripto, "getTtclPrecio").mockReturnValue(1000);
        const cripton = cuenta("f8-cripton", 0, 0);
        db.prepare("INSERT INTO cripto_carteras (userId, cripto, cantidad) VALUES (?, 'TTCL', 10000000000)").run(cripton);
        const top = patrimonioNeto.ranking(10);
        expect(top[0].userId).toBe(cripton);
        expect(clasificacion.ganadores(nuevoServidor(), SEMANA).rico.userId).not.toBe(cripton);
    });
});
