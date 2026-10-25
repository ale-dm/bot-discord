// 🔁 Exchange de apuestas entre jugadores (#533): reglas (cuota, comisión, riesgo), publicar a favor con garantía y límites
// (10 % por orden, 25 % por partido, 100.000 en total), el motor de cruces (cuota más baja y luego la más antigua, en parte, sin
// cruzar las propias), cancelar lo no cruzado, devolverlo al empezar el partido, la liquidación (gana la orden, gana la
// contraparte, comisión del 2 % al ganador, una sola vez, sin resultado se devuelve) y la interfaz. BD en memoria y la Odds
// API simulada.
process.env.ODDS_API_KEY = "clave-de-prueba";

const { MessageFlags } = require("discord.js");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const exchange = require("../src/systems/apuestas/exchange");
const { liquidarApuestas } = require("../src/systems/apuestas/liquidacion");
const { filasPartido } = require("../src/juegos/apuestas/partido");
const ui = require("../src/juegos/apuestas/exchange");

const AHORA = Date.now();
const FUTURO = new Date(AHORA + 24 * 3600e3).toISOString();
const fetchOriginal = global.fetch;
let n = 0;

function partido(id = `ex${++n}`, start = FUTURO) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away)
         VALUES (?, 'laliga', 'Betis', 'Sevilla', ?, 'abierto', 2.1, 3.3, 3.6)`,
    ).run(id, start);
    return id;
}
const jugador = (efectivo = 100_000) => {
    const u = `exu${++n}`;
    dinero.pagar(u, efectivo - dinero.efectivo(u)); // las cuentas nuevas empiezan con algo de efectivo: se deja justo `efectivo`
    return u;
};
const orden = (id) => db.prepare("SELECT * FROM exchange_ordenes WHERE id = ?").get(id);
const publicar = (userId, matchId, cuota, cantidad, eleccion = "home", ahora = AHORA) =>
    exchange.publicar({ userId, matchId, eleccion, cuota, cantidad }, ahora);

afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
});

describe("las reglas (#533)", () => {
    test("la comisión es el 2 % de la ganancia neta, al menos 1 si se gana algo", () => {
        expect(exchange.comision(1000)).toBe(20);
        expect(exchange.comision(10)).toBe(1);
        expect(exchange.comision(0)).toBe(0);
    });

    test("el riesgo de ir en contra es lo apostado × (cuota − 1)", () => {
        expect(exchange.riesgo(100, 2.5)).toBe(150);
        expect(exchange.riesgo(10, 1.1)).toBe(1);
    });

    test.each([
        ["2,10", 2.1],
        ["1.5", 1.5],
        ["50", 50],
        ["1.05", null],
        ["51", null],
        ["abc", null],
    ])("la cuota «%s» vale %p", (texto, esperado) => {
        expect(exchange.cuotaValida(texto)).toBe(esperado);
    });
});

describe("publicar a favor (#533)", () => {
    test("retiene lo apostado y la orden queda en el libro", () => {
        const u = jugador();
        const m = partido();
        const r = publicar(u, m, 2, 1000);
        expect(r.ok).toBe(true);
        expect(dinero.efectivo(u)).toBe(99_000);
        expect(orden(r.id)).toMatchObject({ estado: "abierta", cantidad: 1000, casado: 0, cuota: 2 });
        expect(exchange.libro(m).home).toEqual([{ eleccion: "home", cuota: 2, disponible: 1000, ordenes: 1 }]);
        expect(exchange.exposicion(u)).toBe(1000);
    });

    test.each([
        ["un partido empezado", { start: new Date(AHORA - 60e3).toISOString() }, {}, "ya ha empezado"],
        ["una elección rara", {}, { eleccion: "exacto" }, "local, empate o visitante"],
        ["un importe por debajo del mínimo", {}, { cantidad: 5 }, "mínimo"],
        ["una cuota inválida", {}, { cuota: null }, "La cuota va"],
    ])("no se publica con %s y no se retiene nada", (_caso, opPartido, opOrden, motivo) => {
        const u = jugador();
        const m = partido(undefined, opPartido.start || FUTURO);
        const r = exchange.publicar({ userId: u, matchId: m, eleccion: "home", cuota: 2, cantidad: 100, ...opOrden });
        expect(r.motivo).toContain(motivo);
        expect(dinero.efectivo(u)).toBe(100_000);
    });

    test("como mucho el 10 % del capital por orden y el 25 % en un partido", () => {
        const u = jugador(10_000);
        const m = partido();
        expect(publicar(u, m, 2, 1001).motivo).toContain("10 %");
        expect(publicar(u, m, 2, 1000).ok).toBe(true);
        expect(publicar(u, m, 2, 1000).ok).toBe(true);
        expect(publicar(u, m, 2, 600).motivo).toContain("25 %");
        expect(publicar(u, partido(), 2, 600).ok).toBe(true);
    });

    test("como mucho 100.000 retenidos en total", () => {
        const u = jugador(2_000_000);
        expect(publicar(u, partido(), 2, 95_000).ok).toBe(true);
        expect(publicar(u, partido(), 2, 6_000).motivo).toContain("100.000");
    });
});

describe("el motor de cruces (#533)", () => {
    test("cruza primero la cuota más baja y, a igual cuota, la más antigua; en parte si hace falta", () => {
        const m = partido();
        const [a, b, c] = [jugador(), jugador(), jugador()];
        const caro = publicar(a, m, 2.5, 500, "home", AHORA);
        const antiguo = publicar(b, m, 2, 300, "home", AHORA + 1);
        const nuevo = publicar(c, m, 2, 300, "home", AHORA + 2);
        const lay = jugador();
        const r = exchange.casar({ userId: lay, matchId: m, eleccion: "home", cuotaMax: 2.5, cantidad: 400 });
        expect(r.cruces.map((x) => [x.ordenId, x.cantidad])).toEqual([
            [antiguo.id, 300],
            [nuevo.id, 100],
        ]);
        expect(r).toMatchObject({ cubierto: 400, riesgo: 400 });
        expect(orden(antiguo.id).estado).toBe("casada");
        expect(orden(nuevo.id)).toMatchObject({ estado: "parcial", casado: 100 });
        expect(orden(caro.id).estado).toBe("abierta");
        expect(dinero.efectivo(lay)).toBe(100_000 - 400);
    });

    test("solo cruza cuotas iguales o mejores para quien entra, nunca las propias, y si no hay nada no cobra", () => {
        const m = partido();
        const back = jugador();
        publicar(back, m, 3, 500);
        expect(exchange.casar({ userId: back, matchId: m, eleccion: "home", cuotaMax: 3, cantidad: 100 }).ok).toBe(false);
        const lay = jugador();
        const r = exchange.casar({ userId: lay, matchId: m, eleccion: "home", cuotaMax: 2.5, cantidad: 100 });
        expect(r).toEqual({ ok: false, motivo: "No hay órdenes a esa cuota o mejor para cruzar." });
        expect(dinero.efectivo(lay)).toBe(100_000);
    });

    test("el riesgo de quien va en contra también pasa los límites", () => {
        const m = partido();
        publicar(jugador(), m, 10, 1000);
        const lay = jugador(10_000);
        expect(exchange.casar({ userId: lay, matchId: m, eleccion: "home", cuotaMax: 10, cantidad: 1000 }).motivo).toContain("10 %");
        expect(dinero.efectivo(lay)).toBe(10_000);
    });
});

describe("cancelar y empezar el partido (#533)", () => {
    test("cancelar devuelve lo no cruzado; lo cruzado sigue en juego", () => {
        const m = partido();
        const back = jugador();
        const { id } = publicar(back, m, 2, 1000);
        exchange.casar({ userId: jugador(), matchId: m, eleccion: "home", cuotaMax: 2, cantidad: 300 });
        expect(exchange.cancelar(back, id)).toEqual({ ok: true, devuelto: 700 });
        expect(orden(id)).toMatchObject({ estado: "casada", devuelto: 700 });
        expect(dinero.efectivo(back)).toBe(100_000 - 300);
        expect(exchange.cancelar(back, id).ok).toBe(false);
    });

    test("nadie más puede cancelar tu orden", () => {
        const { id } = publicar(jugador(), partido(), 2, 100);
        expect(exchange.cancelar("otro", id).ok).toBe(false);
    });

    test("al empezar el partido se devuelve todo lo no cruzado y el resto de partidos no se toca", () => {
        const empieza = partido(undefined, new Date(AHORA + 60e3).toISOString());
        const luego = partido();
        const back = jugador();
        const a = publicar(back, empieza, 2, 1000);
        const b = publicar(back, luego, 2, 1000);
        exchange.casar({ userId: jugador(), matchId: empieza, eleccion: "home", cuotaMax: 2, cantidad: 200 });
        exchange.cerrarAlEmpezar(AHORA + 120e3);
        expect(orden(a.id)).toMatchObject({ estado: "casada", devuelto: 800 });
        expect(orden(b.id).estado).toBe("abierta");
        expect(dinero.efectivo(back)).toBe(100_000 - 200 - 1000);
    });
});

describe("liquidar (#533)", () => {
    function cruzado(cuota = 2.5, cantidad = 1000) {
        const m = partido();
        const back = jugador();
        const lay = jugador();
        publicar(back, m, cuota, cantidad);
        exchange.casar({ userId: lay, matchId: m, eleccion: "home", cuotaMax: cuota, cantidad });
        return { m, back, lay };
    }

    test("si gana la orden, quien la publicó cobra su apuesta y el riesgo, menos el 2 % de su ganancia", () => {
        const { m, back, lay } = cruzado();
        const pagos = exchange.resolverPartido(m, "home");
        // ganancia neta 1500 → comisión 30; cobra 1000 + 1500 − 30
        expect(dinero.efectivo(back)).toBe(100_000 - 1000 + 2470);
        expect(dinero.efectivo(lay)).toBe(100_000 - 1500);
        expect(pagos).toEqual([expect.objectContaining({ userId: back, premio: 2470 })]);
    });

    test.each(["draw", "away"])("si sale %s, gana quien fue en contra", (resultado) => {
        const { m, back, lay } = cruzado();
        exchange.resolverPartido(m, resultado);
        // ganancia neta 1000 → comisión 20; cobra 1500 + 1000 − 20
        expect(dinero.efectivo(lay)).toBe(100_000 - 1500 + 2480);
        expect(dinero.efectivo(back)).toBe(100_000 - 1000);
    });

    test("entre los dos solo se pierde la comisión, y no se paga dos veces", () => {
        const { m, back, lay } = cruzado();
        exchange.resolverPartido(m, "home");
        expect(exchange.resolverPartido(m, "home")).toEqual([]);
        expect(dinero.efectivo(back) + dinero.efectivo(lay)).toBe(200_000 - 30);
        expect(
            db
                .prepare("SELECT estado FROM exchange_ordenes WHERE match_id = ?")
                .all(m)
                .map((o) => o.estado),
        ).toEqual(["liquidada"]);
    });

    test("sin resultado, cada parte recupera lo suyo", () => {
        const { m, back, lay } = cruzado();
        exchange.caducarPartido(m);
        expect(dinero.efectivo(back)).toBe(100_000);
        expect(dinero.efectivo(lay)).toBe(100_000);
    });

    test("de punta a punta: la liquidación pregunta por un partido que solo tiene exchange y lo paga", async () => {
        const { m, back } = cruzado();
        db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(new Date(AHORA - 5 * 3600e3).toISOString(), m);
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: new Map([["x-requests-remaining", "400"]]),
            json: async () => [
                {
                    id: m,
                    completed: true,
                    home_team: "Betis",
                    away_team: "Sevilla",
                    scores: [
                        { name: "Betis", score: "2" },
                        { name: "Sevilla", score: "0" },
                    ],
                },
            ],
        }));
        const res = await liquidarApuestas({ minHorasDesdeInicio: 2 });
        expect(dinero.efectivo(back)).toBe(100_000 - 1000 + 2470);
        expect(res.pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: back, premio: 2470 })]));
    });
});

describe("la interfaz (#533)", () => {
    const interaccion = (customId, userId, extra = {}) => ({
        customId,
        user: { id: userId },
        message: { flags: { has: () => true } }, // por defecto, sale de un mensaje privado del exchange
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const campos = (eleccion, cuota, cantidad) => ({
        getStringSelectValues: () => [eleccion],
        getTextInputValue: (id) => (id === "cuota" ? cuota : cantidad),
    });
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

    test("la ficha del partido tiene 🔁 Exchange sin pasar de 5 botones por fila", () => {
        const m = partido();
        const filas = filasPartido(db.prepare("SELECT * FROM apuestas_partidos WHERE match_id = ?").get(m), m).map(
            (f) => f.toJSON().components,
        );
        expect(filas[0].map((c) => c.custom_id)).toContain(`exchange_ver_${m}`);
        for (const f of filas) expect(f.length).toBeLessThanOrEqual(5);
    });

    test("desde la ficha pública el libro se abre en privado", async () => {
        const m = partido();
        publicar(jugador(), m, 1.9, 300);
        const i = interaccion(`exchange_ver_${m}`, "alguien", { message: { flags: { has: () => false } } });
        await ui.handleButton({}, i);
        const p = i.reply.mock.calls[0][0];
        expect(p.flags).toBe(MessageFlags.Ephemeral);
        expect(p.embeds[0].data.description).toContain("`1.9` · 300 🪙");
    });

    test("ir a favor: formulario, confirmación con la comisión y publicar", async () => {
        const m = partido();
        const u = jugador();
        const abrir = interaccion(`exchange_publicar_${m}`, u);
        await ui.handleButton({}, abrir);
        expect(abrir.showModal.mock.calls[0][0].toJSON().custom_id).toBe(`exchange_modal_publicar_${m}`);

        const modal = interaccion(`exchange_modal_publicar_${m}`, u, { fields: campos("home", "2,5", "200") });
        await ui.handleModal({}, modal);
        const conf = modal.reply.mock.calls[0][0];
        expect(conf.embeds[0].data.description).toContain("cobras **494** 🪙 (comisión de 6)");
        expect(dinero.efectivo(u)).toBe(100_000);

        const ok = interaccion(ids(conf)[0], u);
        await ui.handleButton({}, ok);
        expect(ok.update.mock.calls[0][0].embeds[0].data.description).toContain("publicada");
        expect(dinero.efectivo(u)).toBe(99_800);
    });

    test("ir en contra: sin órdenes lo dice; con órdenes enseña el riesgo y cruza", async () => {
        const m = partido();
        const lay = jugador();
        const vacio = interaccion(`exchange_modal_casar_${m}`, lay, { fields: campos("home", "3", "100") });
        await ui.handleModal({}, vacio);
        expect(vacio.reply.mock.calls[0][0].embeds[0].data.description).toContain("No hay órdenes");

        publicar(jugador(), m, 3, 100);
        const modal = interaccion(`exchange_modal_casar_${m}`, lay, { fields: campos("home", "3", "100") });
        await ui.handleModal({}, modal);
        const conf = modal.reply.mock.calls[0][0];
        expect(conf.embeds[0].data.description).toContain("Arriesgas **200** 🪙");
        const ok = interaccion(ids(conf)[0], lay);
        await ui.handleButton({}, ok);
        expect(dinero.efectivo(lay)).toBe(100_000 - 200);
    });

    test("«Mis órdenes» deja cancelar lo no cruzado", async () => {
        const m = partido();
        const u = jugador();
        const { id } = publicar(u, m, 2, 500);
        const mias = interaccion("exchange_mias", u);
        await ui.handleButton({}, mias);
        expect(ids(mias.update.mock.calls[0][0])).toContain("exchange_cancelar");
        const sel = interaccion("exchange_cancelar", u, { values: [String(id)] });
        await ui.handleSelect({}, sel);
        expect(sel.update.mock.calls[0][0].embeds[0].data.description).toContain("Devueltas 500");
        expect(dinero.efectivo(u)).toBe(100_000);
    });

    test("con el partido empezado no se abre nada", async () => {
        const m = partido(undefined, new Date(AHORA - 60e3).toISOString());
        const i = interaccion(`exchange_publicar_${m}`, "alguien");
        await ui.handleButton({}, i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toContain("ya ha empezado");
    });
});
