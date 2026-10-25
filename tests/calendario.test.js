// 📅 Calendario de eventos (#540): rangos de semana y mes en hora de Madrid (con cambio de hora), agregación y orden de las
// fuentes (cine, cumpleaños, partidos de las competiciones elegidas, cierre de quinielas y eventos manuales), eventos
// manuales, recordatorios una sola vez, la vista con navegación y detalle, /calendario y la sección del panel admin.
// BD en memoria y Discord falso; el reloj se pasa a mano.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const adminAudit = require("../src/systems/adminAudit");
const calendario = require("../src/systems/calendario");
const { recordar } = require("../src/discord/envios/calendario");
const { vista, detalle, textoEventos } = require("../src/paneles/calendario");
const comando = require("../src/commands/general/calendario");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildConfigHome } = require("../src/adminPanel/settings/vistas");

const G = "g-calendario";
// Miércoles 21/10/2026 a las 12:00 en Madrid. Esa semana va del lunes 19 al lunes 26 (el domingo 25 se cambia la hora).
const AHORA = Date.parse("2026-10-21T10:00:00.000Z");
const HORA = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

function cine(id, inicio, { cancelada = 0, mensajeId = "msg-1" } = {}) {
    db.prepare(
        "INSERT INTO cine_sesiones (id, guildId, canalId, mensajeId, organizador, peli, inicio, cancelada, creada_en) VALUES (?, ?, 'canal-cine', ?, 'ana', ?, ?, ?, ?)",
    ).run(id, G, mensajeId, `Peli ${id}`, iso(inicio), cancelada, iso(AHORA));
}
function partido(id, inicio, { deporte = "laliga", estado = "abierto" } = {}) {
    db.prepare(
        "INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado) VALUES (?, ?, 'Betis', 'Sevilla', ?, ?)",
    ).run(id, deporte, iso(inicio), estado);
}
function quiniela(jornada, inicios, estado = "abierta") {
    const { lastInsertRowid } = db
        .prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('laliga', ?, ?, ?)")
        .run(jornada, estado, iso(AHORA));
    inicios.forEach((t, i) =>
        db
            .prepare(
                "INSERT INTO quiniela_partidos (quiniela_id, match_id, orden, home_team, away_team, start_time) VALUES (?, ?, ?, 'A', 'B', ?)",
            )
            .run(lastInsertRowid, `q-${jornada}-${i}`, i, iso(t)),
    );
}
const cumple = (userId, dia, mes) =>
    db.prepare("INSERT INTO cumpleanos (userId, guildId, dia, mes) VALUES (?, ?, ?, ?)").run(userId, G, dia, mes);
const semana = () => calendario.rangoSemana(AHORA);

beforeEach(() => {
    for (const t of [
        "cine_sesiones",
        "apuestas_partidos",
        "quiniela_partidos",
        "quinielas",
        "cumpleanos",
        "calendario_eventos",
        "calendario_recordatorios",
    ])
        db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    guildSettings.setSetting(G, "calendario.canal", "canal-avisos");
    guildSettings.setSetting(G, "calendario.recordatorio_min", 60);
    guildSettings.setSetting(G, "calendario.competiciones", "laliga");
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("rangos en hora de Madrid (#540)", () => {
    test("la semana va de lunes a lunes a las 00:00 de Madrid, también con el cambio de hora", () => {
        const s = semana();
        expect(s.lunes).toBe("2026-10-19");
        expect(iso(s.desde)).toBe("2026-10-18T22:00:00.000Z"); // verano: UTC+2
        expect(iso(s.hasta)).toBe("2026-10-25T23:00:00.000Z"); // invierno: UTC+1
    });

    test("se navega a semanas y meses anteriores y siguientes, cruzando el año", () => {
        expect(calendario.rangoSemana(AHORA, -1).lunes).toBe("2026-10-12");
        expect(calendario.rangoSemana(AHORA, 2).lunes).toBe("2026-11-02");
        const enero = calendario.rangoMes(Date.parse("2026-12-15T10:00:00Z"), 1);
        expect([enero.anio, enero.mes]).toEqual([2027, 1]);
        expect(iso(enero.desde)).toBe("2026-12-31T23:00:00.000Z");
        expect(iso(calendario.rangoMes(AHORA, 0).hasta)).toBe("2026-10-31T23:00:00.000Z");
    });
});

describe("las fuentes y el orden (#540)", () => {
    test("junta cine, cumpleaños, partidos, quiniela y manuales, en orden de fecha", () => {
        const { desde, hasta } = semana();
        cine(1, AHORA + 34 * HORA);
        cumple("luis", 23, 10);
        partido("cal-1", AHORA + 4 * HORA);
        quiniela("Jornada 10", [AHORA + 50 * HORA, AHORA + 30 * HORA]);
        calendario.crearManual({ guildId: G, titulo: "Reunión", fecha: "24/10/2026 18:00", porId: "admin" }, AHORA);

        const eventos = calendario.eventos(G, desde, hasta);
        expect(eventos.map((e) => e.tipo)).toEqual(["partido", "quiniela", "cine", "cumple", "manual"]);
        expect(eventos.find((e) => e.tipo === "cine")).toMatchObject({
            titulo: "Sesión de cine: Peli 1",
            enlace: `https://discord.com/channels/${G}/canal-cine/msg-1`,
        });
        expect(eventos.find((e) => e.tipo === "quiniela").inicio).toBe(AHORA + 30 * HORA); // cierra con el primer partido
        expect(eventos.find((e) => e.tipo === "cumple")).toMatchObject({ diaEntero: true, titulo: "Cumpleaños de <@luis>" });
    });

    test("solo salen las competiciones elegidas, sin partidos caducados ni sesiones canceladas ni quinielas cerradas", () => {
        const { desde, hasta } = semana();
        partido("cal-premier", AHORA + HORA, { deporte: "premier" });
        partido("cal-caducado", AHORA + HORA, { estado: "caducado" });
        cine(2, AHORA + HORA, { cancelada: 1 });
        quiniela("Cerrada", [AHORA + HORA], "cerrada");
        expect(calendario.eventos(G, desde, hasta)).toEqual([]);

        guildSettings.setSetting(G, "calendario.competiciones", "laliga,premier");
        expect(calendario.eventos(G, desde, hasta).map((e) => e.clave)).toEqual(["partido:cal-premier"]);
    });

    test("lo que empieza justo al final del rango va en el siguiente", () => {
        const { desde, hasta } = semana();
        partido("cal-borde", hasta);
        expect(calendario.eventos(G, desde, hasta)).toEqual([]);
        expect(calendario.eventos(G, hasta, hasta + 7 * 24 * HORA)).toHaveLength(1);
    });

    test("un cumpleaños del 29 de febrero sale el 28 si el año no es bisiesto", () => {
        cumple("ana", 29, 2);
        const feb = calendario.rangoMes(Date.parse("2027-02-10T10:00:00Z"));
        const [e] = calendario.eventos(G, feb.desde, feb.hasta);
        expect(iso(e.inicio)).toBe("2027-02-27T23:00:00.000Z");
    });
});

describe("eventos manuales (#540)", () => {
    test("se crean en hora de Madrid", () => {
        const r = calendario.crearManual({ guildId: G, titulo: "Torneo de Mario Kart", fecha: "31/10/2026 21:30", porId: "admin" }, AHORA);
        expect(r.ok).toBe(true);
        expect(iso(r.inicio)).toBe("2026-10-31T20:30:00.000Z");
    });

    test.each([
        ["un título demasiado corto", { titulo: "ab", fecha: "31/10/2026 21:30" }, "título"],
        ["una fecha mal escrita", { titulo: "Evento", fecha: "2026-10-31" }, "DD/MM/AAAA"],
        ["una fecha que no existe", { titulo: "Evento", fecha: "31/02/2027 10:00" }, "DD/MM/AAAA"],
        ["una fecha pasada", { titulo: "Evento", fecha: "01/10/2026 10:00" }, "ya ha pasado"],
    ])("no se crean con %s", (_caso, datos, motivo) => {
        expect(calendario.crearManual({ guildId: G, porId: "admin", ...datos }, AHORA).motivo).toContain(motivo);
    });

    test("se borran solo del servidor al que pertenecen", () => {
        const { id } = calendario.crearManual({ guildId: G, titulo: "Evento", fecha: "31/10/2026 21:30", porId: "a" }, AHORA);
        expect(calendario.borrarManual("otro-servidor", id)).toBeNull();
        expect(calendario.borrarManual(G, id)).toMatchObject({ titulo: "Evento" });
        expect(calendario.manualesProximos(G, AHORA)).toEqual([]);
    });
});

describe("recordatorios (#540)", () => {
    function cliente({ falla = false, canal = true } = {}) {
        const send = jest.fn(async () => {
            if (falla) throw new Error("Missing Permissions");
        });
        const canales = new Map(canal ? [["canal-avisos", { isTextBased: () => true, send }]] : []);
        return { send, client: { guilds: { cache: new Map([[G, { id: G, channels: { cache: canales, fetch: async () => null } }]]) } } };
    }

    test("avisan de lo que empieza en los próximos minutos, una sola vez aunque se repita la pasada", async () => {
        partido("cal-pronto", AHORA + 30 * 60 * 1000);
        partido("cal-luego", AHORA + 3 * HORA);
        const { client, send } = cliente();
        expect(await recordar(client, AHORA)).toBe(1);
        expect(await recordar(client, AHORA + 60 * 1000)).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].content).toContain("Betis - Sevilla");
        expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
    });

    test("tras un reinicio no se repiten (quedan en la BD)", async () => {
        partido("cal-pronto", AHORA + 10 * 60 * 1000);
        await recordar(cliente().client, AHORA);
        expect(calendario.pendientesDeRecordar(G, AHORA + 1000)).toEqual([]);
    });

    test("los cumpleaños no se recuerdan: ya tienen su felicitación", () => {
        cumple("ana", 22, 10);
        expect(calendario.pendientesDeRecordar(G, Date.parse("2026-10-21T22:30:00Z"))).toEqual([]);
    });

    test("sin canal o con 0 minutos no hay recordatorios", () => {
        partido("cal-pronto", AHORA + 10 * 60 * 1000);
        guildSettings.setSetting(G, "calendario.recordatorio_min", 0);
        expect(calendario.pendientesDeRecordar(G, AHORA)).toEqual([]);
        guildSettings.setSetting(G, "calendario.recordatorio_min", 60);
        guildSettings.setSetting(G, "calendario.canal", "");
        expect(calendario.pendientesDeRecordar(G, AHORA)).toEqual([]);
    });

    test("si el envío falla, se reintenta en la siguiente pasada", async () => {
        partido("cal-pronto", AHORA + 10 * 60 * 1000);
        expect(await recordar(cliente({ falla: true }).client, AHORA)).toBe(0);
        const bueno = cliente();
        expect(await recordar(bueno.client, AHORA + 60 * 1000)).toBe(1);
    });

    test("si el canal ya no existe, no se marca nada", async () => {
        partido("cal-pronto", AHORA + 10 * 60 * 1000);
        expect(await recordar(cliente({ canal: false }).client, AHORA)).toBe(0);
        expect(calendario.pendientesDeRecordar(G, AHORA)).toHaveLength(1);
    });
});

describe("la vista (#540)", () => {
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

    test("sin eventos lo explica y no hay desplegable", () => {
        const p = vista(G, { ahora: AHORA });
        expect(p.embeds[0].data.description).toContain("No hay nada programado");
        expect(ids(p)).toEqual(["calendario_ver_sem_-1", "calendario_ver_sem_0", "calendario_ver_sem_1", "calendario_ver_mes_0"]);
    });

    test("agrupa por día con la hora en timestamp de Discord y enlace si lo hay", () => {
        cine(1, Date.parse("2026-10-23T19:00:00Z"));
        partido("cal-1", Date.parse("2026-10-23T17:00:00Z"));
        const p = vista(G, { ahora: AHORA });
        const texto = p.embeds[0].data.description;
        expect(texto.split("**viernes 23/10**")).toHaveLength(2);
        expect(texto).toContain(`<t:${Date.parse("2026-10-23T17:00:00Z") / 1000}:t>`);
        expect(texto).toContain(`[Sesión de cine: Peli 1](https://discord.com/channels/${G}/canal-cine/msg-1)`);
        expect(ids(p)).toContain("calendario_det_sem_0");
    });

    test("la vista mensual se titula con el mes y navega por meses", () => {
        const p = vista(G, { modo: "mes", offset: 1, ahora: AHORA });
        expect(p.embeds[0].data.title).toBe("📅 noviembre de 2026");
        expect(ids(p)).toEqual(expect.arrayContaining(["calendario_ver_mes_0", "calendario_ver_mes_2", "calendario_ver_sem_0"]));
    });

    test("con muchos eventos no pasa del límite del embed y dice cuántos faltan", () => {
        const muchos = Array.from({ length: 200 }, (_, i) => ({
            clave: `x${i}`,
            emoji: "📌",
            titulo: `Evento con un título bastante largo número ${i}`,
            inicio: AHORA + i * HORA,
            diaEntero: false,
        }));
        const texto = textoEventos(muchos);
        expect(texto.length).toBeLessThanOrEqual(4096);
        expect(texto).toMatch(/…y \d+ más\.$/);
    });

    test("el detalle lleva fecha completa, cuenta atrás y enlace", () => {
        const e = {
            emoji: "🎬",
            titulo: "Sesión de cine: Dune",
            inicio: AHORA,
            diaEntero: false,
            enlace: "https://discord.com/channels/1/2/3",
        };
        const t = detalle(e).embeds[0].data.description;
        expect(t).toContain(`<t:${AHORA / 1000}:F>`);
        expect(t).toContain("[Ir al mensaje](https://discord.com/channels/1/2/3)");
    });
});

describe("/calendario (#540)", () => {
    const interaccion = (extra = {}) => ({
        guildId: G,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        ...extra,
    });

    test("se abre en privado con la semana actual", async () => {
        const i = interaccion();
        await comando.run({}, i);
        expect(i.reply.mock.calls[0][0].flags).toBeDefined();
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toMatch(/^📅 Semana del /);
    });

    test("los botones cambian de semana o de mes, y no se va más allá de un año", async () => {
        const i = interaccion({ customId: "calendario_ver_mes_500" });
        await comando.handleButton({}, i);
        const ids = i.update.mock.calls[0][0].components[0].toJSON().components.map((c) => c.custom_id);
        expect(ids).toContain("calendario_ver_mes_53");
    });

    test("el desplegable enseña el detalle; un evento que ya no está se dice", async () => {
        partido("cal-det", Date.now() + HORA);
        const i = interaccion({ customId: "calendario_det_sem_0", values: ["partido:cal-det"] });
        await comando.handleSelect({}, i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toContain("Betis - Sevilla");
        const no = interaccion({ customId: "calendario_det_sem_0", values: ["partido:no-existe"] });
        await comando.handleSelect({}, no);
        expect(no.reply.mock.calls[0][0].content).toBe("Ese evento ya no está en el calendario.");
    });
});

describe("📅 Calendario en el panel admin (#540)", () => {
    function interaccion(customId, extra = {}, admin = true) {
        return {
            customId,
            guildId: G,
            user: { id: "admin", tag: "admin" },
            client: {},
            memberPermissions: { has: () => admin },
            member: { permissions: { has: () => admin } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            ...extra,
        };
    }
    const texto = (p) => JSON.stringify(p.embeds[0].data);
    const acciones = () => adminAudit.listRecent(G, 20).map((r) => r.action);

    test("está en ⚙️ Config Global sin pasar de 5 filas; sin admin no se abre", async () => {
        const p = buildConfigHome(G);
        expect(p.components.length).toBeLessThanOrEqual(5);
        expect(p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id))).toContain("paneladmin_cal_home");
        const i = interaccion("paneladmin_cal_home", {}, false);
        await paneladmin.handleButton(i.client, i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes permisos." }));
    });

    test("añadir un evento lo guarda, lo audita y sale en la lista; con una fecha mala no", async () => {
        const fechaFutura = "31/12/2099 22:00";
        const i = interaccion("paneladmin_cal_nuevo_modal", {
            fields: { getTextInputValue: (k) => (k === "titulo" ? "Nochevieja" : fechaFutura) },
        });
        await paneladmin.handleModal(i.client, i);
        expect(texto(i.update.mock.calls[0][0])).toContain("Nochevieja");
        expect(acciones()).toContain("calendario.crear");

        const mal = interaccion("paneladmin_cal_nuevo_modal", {
            fields: { getTextInputValue: (k) => (k === "titulo" ? "Otro" : "mañana") },
        });
        await paneladmin.handleModal(mal.client, mal);
        expect(texto(mal.update.mock.calls[0][0])).toContain("❌ La fecha va como DD/MM/AAAA HH:MM");
        expect(calendario.manualesProximos(G)).toHaveLength(1);
    });

    test("los ajustes validan las competiciones y los minutos", async () => {
        const fields = (minutos, competiciones) => ({
            getSelectedChannels: () => new Map([["nuevo-canal", {}]]),
            getTextInputValue: (k) => (k === "minutos" ? minutos : competiciones),
        });
        const mal = interaccion("paneladmin_cal_ajustes_modal", { fields: fields("30", "laliga, liga-inventada") });
        await paneladmin.handleModal(mal.client, mal);
        expect(texto(mal.update.mock.calls[0][0])).toContain("No conozco: liga-inventada");

        const ok = interaccion("paneladmin_cal_ajustes_modal", { fields: fields("30", "LaLiga, champions") });
        await paneladmin.handleModal(ok.client, ok);
        expect(calendario.ajustes(G)).toEqual({ canal: "nuevo-canal", recordatorioMin: 30, competiciones: ["laliga", "champions"] });
        expect(acciones()).toContain("calendario.ajustes");
    });

    test("borrar un evento propio desde el desplegable", async () => {
        const { id } = calendario.crearManual({ guildId: G, titulo: "Evento", fecha: "31/12/2099 22:00", porId: "admin" });
        const i = interaccion("paneladmin_cal_borrar", { values: [String(id)] });
        await paneladmin.handleStringSelect(i.client, i);
        expect(calendario.manualesProximos(G)).toEqual([]);
        expect(acciones()).toContain("calendario.borrar");
    });
});
