// Lo que hace el cron y lo que avisa por DM en ⚔️ Retos: que te toca jugar (#452), el recordatorio de un reto pendiente (#439)
// y el cierre automático de las porras (#448). Los DM pasan por /avisos (tipo «retos»).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const retos = require("../src/systems/retos");
const avisosDm = require("../src/systems/avisosDm");
const paneles = require("../src/paneles/retos");
const botones = require("../src/juegos/retos/retos");

const HORA = 3600 * 1000;
let n = 0;
const par = () => {
    n++;
    return [`avi-a${n}`, `avi-b${n}`];
};
const flush = () => new Promise((r) => setImmediate(r));

/** Un cliente cuyos DM se guardan en `dms` ({ id, texto }); `cerrados` lanza el error de DM cerrados. */
function cliente({ cerrados = false } = {}) {
    const dms = [];
    return {
        dms,
        users: {
            fetch: jest.fn(async (id) => ({
                send: async (texto) => {
                    if (cerrados) throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
                    dms.push({ id, texto });
                },
            })),
        },
        channels: { fetch: jest.fn(async () => null) },
    };
}
const interaccion = (customId, userId) => ({
    customId,
    user: { id: userId, username: userId, tag: userId },
    update: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
    followUp: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
});
/** Un duelo aceptado y con su mensaje público (para que el DM lleve el enlace). */
function enJuego(juego) {
    const [a, b] = par();
    const { reto } = retos.crearDuelo({ creador: a, rival: b, juego, cantidad: 100, guildId: "g1", channelId: "c1" });
    retos.guardarMensaje(reto.id, "c1", `m${reto.id}`);
    retos.aceptar(reto.id, b);
    return { a, b, id: reto.id };
}
const pulsar = async (c, customId, userId) => {
    await botones.handleButton(c, interaccion(customId, userId));
    await flush();
};

describe("te toca jugar (#452)", () => {
    test("en piedra-papel-tijera, al elegir el primero, el otro recibe un DM con el enlace al mensaje del reto", async () => {
        const c = cliente();
        const { a, b, id } = enJuego("ppt");
        await pulsar(c, `retos_ppt_piedra_${id}`, a);
        expect(c.dms).toHaveLength(1);
        expect(c.dms[0].id).toBe(b);
        expect(c.dms[0].texto).toContain(`<@${a}> ya ha jugado`);
        expect(c.dms[0].texto).toContain("duelo de Piedra, papel o tijera");
        expect(c.dms[0].texto).toContain(`https://discord.com/channels/g1/c1/m${id}`);
    });

    test("si la jugada resuelve el duelo no se avisa a nadie, y solo se avisa una vez por partida aunque haya empates", async () => {
        const c = cliente();
        const { a, b, id } = enJuego("ppt");
        await pulsar(c, `retos_ppt_piedra_${id}`, a); // DM a b
        await pulsar(c, `retos_ppt_piedra_${id}`, b); // empate: otra ronda
        await pulsar(c, `retos_ppt_papel_${id}`, a); // empieza otra ronda, pero ya se avisó
        expect(c.dms).toHaveLength(1);
        await pulsar(c, `retos_ppt_tijera_${id}`, b); // resuelve
        expect(retos.obtener(id).estado).toBe("resuelto");
        expect(c.dms).toHaveLength(1);
    });

    test("en el blackjack se avisa cuando el otro termina su mano, no al pedir carta ni al resolver", async () => {
        retos.__test.setRng(() => 0);
        const c = cliente();
        const { a, b, id } = enJuego("blackjack");
        await pulsar(c, `retos_bj_pedir_${id}`, a);
        expect(c.dms).toHaveLength(0);
        await pulsar(c, `retos_bj_plantar_${id}`, a);
        expect(c.dms.map((d) => d.id)).toEqual([b]);
        await pulsar(c, `retos_bj_plantar_${id}`, b);
        expect(retos.obtener(id).estado).toBe("resuelto");
        expect(c.dms).toHaveLength(1);
        retos.__test.setRng(null);
    });

    test("doblar también termina tu mano y avisa al otro", async () => {
        retos.__test.setRng(() => 0);
        const c = cliente();
        const { a, b, id } = enJuego("blackjack");
        await pulsar(c, `retos_bj_doblar_${id}`, a);
        expect(c.dms.map((d) => d.id)).toEqual([b]);
        retos.__test.setRng(null);
    });

    test("contra el Duende no hay a quién avisar", async () => {
        const [a] = par();
        const { reto } = retos.crearContraDuende({ userId: a, cantidad: 100, guildId: "g1", channelId: "c1" });
        const c = cliente();
        await pulsar(c, `retos_ppt_piedra_${reto.id}`, a);
        expect(c.users.fetch).not.toHaveBeenCalled();
        expect(retos.avisoDeTurno(reto.id, a)).toBeNull();
    });

    test("con los DM cerrados el error solo queda en el log y la partida sigue igual", async () => {
        const c = cliente({ cerrados: true });
        const { a, id } = enJuego("ppt");
        await pulsar(c, `retos_ppt_piedra_${id}`, a);
        expect(c.dms).toEqual([]);
        const reto = retos.obtener(id);
        expect(reto.estado).toBe("en_juego");
        expect(reto.datos.jugadas[a]).toBe("piedra");
    });

    test("quien tiene apagados los avisos de retos en /avisos no recibe el DM", async () => {
        const c = cliente();
        const { a, b, id } = enJuego("ppt");
        avisosDm.fijar(b, "retos", false);
        await pulsar(c, `retos_ppt_piedra_${id}`, a);
        expect(c.dms).toEqual([]);
        avisosDm.fijar(b, "retos", true);
    });

    test("sin mensaje público conocido, el DM va sin enlace", async () => {
        const c = cliente();
        const [a, b] = par();
        const { reto } = retos.crearDuelo({ creador: a, rival: b, juego: "ppt", cantidad: 100 });
        retos.aceptar(reto.id, b);
        await pulsar(c, `retos_ppt_papel_${reto.id}`, a);
        expect(c.dms[0].texto).not.toContain("https://");
    });
});

describe("recordatorio de un reto pendiente (#439)", () => {
    const pendiente = (extra = {}) => {
        const [a, b] = par();
        const { reto } = retos.crearDuelo({
            creador: a,
            rival: b,
            juego: "dados",
            cantidad: 250,
            guildId: "g1",
            channelId: "c1",
            ...extra,
        });
        retos.guardarMensaje(reto.id, "c1", `m${reto.id}`);
        return { a, b, id: reto.id };
    };
    const ids = (lista) => lista.map((r) => r.id);

    test("sale a la mitad del plazo, una sola vez, y deja marcado cuándo", () => {
        const { id } = pendiente();
        const ahora = Date.now();
        expect(ids(retos.revisar(ahora + 11 * HORA).recordatorios)).not.toContain(id);
        expect(ids(retos.revisar(ahora + 12 * HORA + 1000).recordatorios)).toContain(id);
        expect(retos.obtener(id).recordado_en).toBeGreaterThan(0);
        expect(ids(retos.revisar(ahora + 13 * HORA).recordatorios)).not.toContain(id);
    });

    test("no se recuerda lo ya aceptado, devuelto o caducado, ni lo que va contra el Duende o es abierto", () => {
        const aceptado = pendiente();
        retos.aceptar(aceptado.id, aceptado.b);
        const rechazado = pendiente();
        retos.rechazar(rechazado.id, rechazado.b);
        const caducado = pendiente();
        const abierto = retos.crearDuelo({ creador: par()[0], abierto: true, juego: "ppt", cantidad: 10 }).reto;
        const tarde = Date.now() + 20 * HORA;
        const recordados = ids(retos.revisar(tarde).recordatorios);
        for (const id of [aceptado.id, rechazado.id, abierto.id]) expect(recordados).not.toContain(id);
        // El caducado (pasadas las 24 h) se devuelve y no se recuerda.
        const despues = retos.revisar(Date.now() + 25 * HORA);
        expect(ids(despues.cerrados)).toContain(caducado.id);
        expect(ids(despues.recordatorios)).not.toContain(caducado.id);
    });

    test("en un reto a un partido el plazo es el suyo: no se recuerda nada más crearlo", () => {
        db.prepare(
            "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte) VALUES ('avi-p1', 'Betis', 'Sevilla', ?, 'abierto', 'laliga')",
        ).run(new Date(Date.now() + 2 * HORA).toISOString());
        const [a, b] = par();
        const { reto } = retos.crearPartido({ creador: a, rival: b, matchId: "avi-p1", eleccion: "home", cantidad: 100 });
        expect(ids(retos.revisar(Date.now() + 10 * 60 * 1000).recordatorios)).not.toContain(reto.id);
        expect(ids(retos.revisar(Date.now() + 70 * 60 * 1000).recordatorios)).toContain(reto.id);
    });

    test("el cron manda el DM al rival con el reto, la cantidad, la hora de caducidad y el enlace, y no lo repite", async () => {
        const { a, b, id } = pendiente();
        const ahora = Date.now();
        db.prepare("UPDATE retos SET creado_en = ?, expira_en = ? WHERE id = ?").run(ahora - 13 * HORA, ahora + 11 * HORA, id);
        const c = cliente();
        await botones.revisarRetos(c);
        expect(c.dms).toHaveLength(1);
        expect(c.dms[0].id).toBe(b);
        const t = c.dms[0].texto;
        expect(t).toContain(`<@${a}> te retó a **duelo de Dados**`);
        expect(t).toContain("**250** 🪙");
        const caduca = Math.floor((ahora + 11 * HORA) / 1000);
        expect(t).toContain(`<t:${caduca}:R> (<t:${caduca}:f>)`);
        expect(t).toContain("aceptarlo o rechazarlo");
        expect(t).toContain(`https://discord.com/channels/g1/c1/m${id}`);
        await botones.revisarRetos(c);
        expect(c.dms).toHaveLength(1);
    });

    test("si el DM no llega o el aviso está apagado, el reto sigue su curso", async () => {
        const cerrado = pendiente();
        const apagado = pendiente();
        const ahora = Date.now();
        for (const x of [cerrado, apagado]) {
            db.prepare("UPDATE retos SET creado_en = ?, expira_en = ? WHERE id = ?").run(ahora - 13 * HORA, ahora + 11 * HORA, x.id);
        }
        avisosDm.fijar(apagado.b, "retos", false);
        const c = cliente({ cerrados: true });
        await expect(botones.revisarRetos(c)).resolves.not.toThrow();
        expect(c.dms).toEqual([]);
        for (const x of [cerrado, apagado]) expect(retos.obtener(x.id).estado).toBe("pendiente");
        expect(retos.aceptar(cerrado.id, cerrado.b).ok).toBe(true);
        avisosDm.fijar(apagado.b, "retos", true);
    });
});

describe("cierre automático de porras (#448)", () => {
    const nueva = (extra = {}) =>
        retos.crearPorra({ creador: "cierre-c", pregunta: "¿Llegará Jorge tarde?", opciones: ["Sí", "No"], cantidad: 100, ...extra }).reto;

    test("leer el cierre: minutos, horas, días, y vacío sin cierre", () => {
        expect(retos.leerCierre("")).toEqual({ ok: true, ms: null });
        expect(retos.leerCierre(undefined)).toEqual({ ok: true, ms: null });
        expect(retos.leerCierre("30m").ms).toBe(30 * 60 * 1000);
        expect(retos.leerCierre("2h").ms).toBe(2 * HORA);
        expect(retos.leerCierre(" 1D ").ms).toBe(24 * HORA);
        expect(retos.leerCierre("1,5h").ms).toBe(1.5 * HORA);
        expect(retos.leerCierre("3").ms).toBe(3 * HORA); // un número solo son horas
        for (const malo of ["abc", "2x", "-1h", "0m", "29s", `${retos.PORRA_DIAS}d`, "999d"]) expect(retos.leerCierre(malo).ok).toBe(false);
    });

    test("con fecha de cierre la porra la guarda, y sin ella funciona como siempre", () => {
        const con = nueva({ cierraEn: 2 * HORA });
        expect(con.cierra_en).toBeGreaterThan(Date.now() + 2 * HORA - 5000);
        expect(con.cierra_en).toBeLessThan(Date.now() + 2 * HORA + 5000);
        expect(texto(con)).toContain("Las entradas se cierran solas <t:");
        const sin = nueva();
        expect(sin.cierra_en).toBeNull();
        expect(texto(sin)).not.toContain("se cierran solas");
        expect(retos.crearPorra({ creador: "x", pregunta: "¿Qué?", opciones: ["Sí", "No"], cantidad: 100, cierraEn: 1000 }).ok).toBe(false);
    });
    const texto = (reto) => paneles.mensajeReto(reto).embeds[0].toJSON().description;

    test("al llegar la fecha el cron la pasa a cerrada: ya no admite entradas, pero un admin sigue pudiendo resolverla o anularla", () => {
        const porra = nueva({ cierraEn: 2 * HORA });
        retos.entrarPorra(porra.id, "cierre-1", 0);
        const antes = retos.revisar(Date.now() + HORA);
        expect(antes.modificados.map((r) => r.id)).not.toContain(porra.id);
        expect(retos.obtener(porra.id).estado).toBe("abierta");

        const despues = retos.revisar(Date.now() + 3 * HORA);
        expect(despues.modificados.map((r) => r.id)).toContain(porra.id);
        expect(retos.obtener(porra.id).estado).toBe("cerrada");
        expect(retos.entrarPorra(porra.id, "cierre-2", 1).mensaje).toMatch(/ya no admite/);
        expect(retos.revisar(Date.now() + 4 * HORA).modificados.map((r) => r.id)).not.toContain(porra.id); // solo una vez

        const otra = nueva({ cierraEn: HORA });
        retos.revisar(Date.now() + 2 * HORA);
        expect(retos.resolverPorra(porra.id, 0, true).reto.estado).toBe("resuelto");
        expect(retos.anularPorra(otra.id, "admin", true).reto.estado).toBe("devuelto");
    });

    test("una porra sin cierre, ya cerrada a mano o ya resuelta no se toca", () => {
        const sin = nueva();
        const manual = nueva({ cierraEn: HORA });
        retos.cerrarPorra(manual.id, "cierre-c", false);
        const resuelta = nueva({ cierraEn: HORA });
        retos.entrarPorra(resuelta.id, "cierre-9", 0);
        retos.resolverPorra(resuelta.id, 0, true);
        const { modificados } = retos.revisar(Date.now() + 2 * HORA);
        const m = modificados.map((r) => r.id);
        for (const x of [sin, manual, resuelta]) expect(m).not.toContain(x.id);
        expect(retos.obtener(sin.id).estado).toBe("abierta");
        expect(retos.obtener(resuelta.id).estado).toBe("resuelto");
    });

    test("el cron repinta el mensaje de la porra cerrada, sin los botones de las opciones", async () => {
        const porra = nueva({ cierraEn: 60 * 1000 });
        retos.guardarMensaje(porra.id, "c-porra", "m-porra");
        db.prepare("UPDATE retos SET cierra_en = ? WHERE id = ?").run(Date.now() - 1000, porra.id);
        const editados = [];
        const c = {
            channels: { fetch: async () => ({ messages: { edit: async (m, payload) => editados.push({ m, payload }) } }) },
            users: { fetch: async () => null },
        };
        const cambios = await botones.revisarRetos(c);
        expect(cambios).toBeGreaterThanOrEqual(1);
        const edicion = editados.find((e) => e.m === "m-porra");
        expect(edicion.payload.embeds[0].toJSON().description).toContain("Apuestas cerradas");
        const ids = edicion.payload.components.flatMap((f) => f.toJSON().components.map((x) => x.custom_id));
        expect(ids.some((x) => x.startsWith("retos_porra_op_"))).toBe(false);
        expect(ids).toContain(`retos_porra_resolver_${porra.id}`);
    });

    test("el formulario de la porra lleva el campo opcional y rechaza un cierre mal escrito sin crear nada", async () => {
        expect(JSON.stringify(paneles.modalPorra().toJSON())).toContain('"custom_id":"cierre"');
        const campos = (cierre) => ({
            getStringSelectValues: () => ["100"],
            getTextInputValue: (id) => ({ pregunta: "¿Llueve mañana?", opciones: "Sí\nNo", cierre })[id] ?? "",
        });
        const base = { customId: "retos_modal_porra", user: { id: "cierre-m" }, guildId: "g", channelId: "c" };
        const mal = { ...base, fields: campos("pronto"), reply: jest.fn(), update: jest.fn(), followUp: jest.fn() };
        await botones.handleModal(null, mal);
        expect(mal.reply.mock.calls[0][0].content).toMatch(/30m, 2h o 1d/);
        expect(db.prepare("SELECT COUNT(*) AS n FROM retos WHERE creador = 'cierre-m'").get().n).toBe(0);

        const bien = {
            ...base,
            fields: campos("2h"),
            reply: jest.fn(),
            update: jest.fn(),
            followUp: jest.fn(async () => ({ id: "m-form", channelId: "c" })),
        };
        await botones.handleModal(null, bien);
        const creada = db.prepare("SELECT cierra_en FROM retos WHERE creador = 'cierre-m'").get();
        expect(creada.cierra_en).toBeGreaterThan(Date.now() + HORA);
        dinero.asegurarCuenta("cierre-m");
    });
});
