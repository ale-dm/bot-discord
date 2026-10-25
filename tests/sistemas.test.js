// 🎛️ Apuestas de sistema (#534): el generador de subcombinaciones (2 de 3, 3 de 4, 3 de 5), el coste y el retorno, el cobro
// una sola vez con el sistema completo guardado, los límites (tamaño, importe, coste máximo, saldo, cuota cambiada), la
// liquidación (pago parcial, todas acertadas, ninguna, patas anuladas con cuota 1,00, todas anuladas, redondeo, una sola vez),
// el boleto y «Mis jugadas». BD en memoria y la Odds API simulada.
process.env.ODDS_API_KEY = "clave-de-prueba";
process.env.MAX_BET_AMOUNT = "10000"; // para poder pasar del coste máximo de 50.000 con 10 combinaciones

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const combinadas = require("../src/systems/apuestas/combinadas");
const sistemas = require("../src/systems/apuestas/sistemas");
const { liquidarApuestas } = require("../src/systems/apuestas/liquidacion");
const { pantallaCombinada } = require("../src/paneles/combinada");
const { buildMisJugadas } = require("../src/paneles/misJugadas");
const boleto = require("../src/juegos/apuestas/combinada");

const G = "g-sistemas";
const FUTURO = "2099-01-01T20:00:00.000Z";
const fetchOriginal = global.fetch;
let n = 0;

function partido(id, cuota_home = 2) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away)
         VALUES (?, 'laliga', ?, 'Visitante', ?, 'abierto', ?, 3, 4)`,
    ).run(id, `Local ${id}`, FUTURO, cuota_home);
}
/** Un boleto de `cuotas.length` partidos (local en todos) para una persona con 100.000 de efectivo. */
function conBoleto(cuotas) {
    const u = `si-${++n}`;
    dinero.pagar(u, 100_000);
    const ids = cuotas.map((c, i) => {
        const id = `s${n}-${i}`;
        partido(id, c);
        combinadas.sumar(u, id, "home");
        return id;
    });
    return { u, ids };
}
const fila = (id) => db.prepare("SELECT * FROM sistemas WHERE id = ?").get(id);
const premios = (id) =>
    db
        .prepare("SELECT premio FROM sistema_combinaciones WHERE sistema_id = ? ORDER BY id")
        .all(id)
        .map((c) => c.premio);
/** Resuelve cada partido: "1" gana el local (acierta), "2" gana el visitante (falla), "-" se caduca (anulada). */
function jugar(ids, resultados) {
    const pagos = [];
    ids.forEach((id, i) => {
        if (resultados[i] === "-") pagos.push(...sistemas.caducarPartido(id));
        else pagos.push(...sistemas.resolverPartido(id, resultados[i] === "1" ? "home" : "away", resultados[i] === "1" ? "1-0" : "0-1"));
    });
    return pagos;
}

afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
});

describe("el generador (#534)", () => {
    test.each([
        [3, 2, 3],
        [4, 3, 4],
        [5, 3, 10],
    ])("%i patas, de %i en %i: %i combinaciones sin repetir", (m, k, total) => {
        const c = sistemas.combinaciones(m, k);
        expect(c).toHaveLength(total);
        expect(new Set(c.map((x) => x.join())).size).toBe(total);
        expect(c.every((x) => x.length === k && x.every((i, j) => j === 0 || i > x[j - 1]))).toBe(true);
    });

    test("2 de 3 son 0+1, 0+2 y 1+2", () => {
        expect(sistemas.combinaciones(3, 2)).toEqual([
            [0, 1],
            [0, 2],
            [1, 2],
        ]);
    });

    test("solo los tamaños decididos: 2 de 3, 3 de 4 y 3 de 5", () => {
        expect(sistemas.tamanosPara(3)).toEqual([2]);
        expect(sistemas.tamanosPara(4)).toEqual([3]);
        expect(sistemas.tamanosPara(5)).toEqual([3]);
        expect(sistemas.tamanosPara(2)).toEqual([]);
        expect(sistemas.tamanosPara(6)).toEqual([]);
    });

    test("el presupuesto: coste, retorno si aciertan todas y cuántas pueden fallar", () => {
        expect(sistemas.presupuesto([2, 3, 1.5], 2, 100)).toEqual({
            k: 2,
            m: 3,
            combinaciones: 3,
            coste: 300,
            premioMaximo: 600 + 300 + 450,
            puedenFallar: 1,
        });
        expect(sistemas.presupuesto([2, 3, 1.5], 3, 100)).toBeNull();
    });
});

describe("apostar (#534)", () => {
    test("cobra el coste total una vez, guarda patas y combinaciones y vacía el boleto", () => {
        const { u } = conBoleto([2, 3, 1.5]);
        const antes = dinero.efectivo(u);
        const r = sistemas.apostar(G, u, 2, 100);
        expect(r).toMatchObject({ ok: true, coste: 300, combinaciones: 3 });
        expect(dinero.efectivo(u)).toBe(antes - 300);
        expect(fila(r.id)).toMatchObject({ k: 2, m: 3, cantidad: 100, coste: 300, estado: "abierta" });
        expect(db.prepare("SELECT COUNT(*) AS c FROM sistema_patas WHERE sistema_id = ?").get(r.id).c).toBe(3);
        expect(db.prepare("SELECT indices, cuota FROM sistema_combinaciones WHERE sistema_id = ? ORDER BY id").all(r.id)).toEqual([
            { indices: "0,1", cuota: 6 },
            { indices: "0,2", cuota: 3 },
            { indices: "1,2", cuota: 4.5 },
        ]);
        expect(dinero.movimientos(u, { tipo: "apuestas" }).filas[0]).toMatchObject({ cantidad: -300 });
        expect(combinadas.borrador(u)).toEqual([]);
    });

    test.each([
        ["un tamaño que no vale para el boleto", [2, 2, 2], 3, 100, "no vale para tu boleto"],
        ["un boleto de 2 partidos", [2, 2], 2, 100, "no vale para tu boleto"],
        ["un importe por debajo del mínimo", [2, 2, 2], 2, 1, "importe por combinación"],
        ["un coste por encima de 50.000", [2, 2, 2, 2, 2], 3, 6000, "pasa del máximo"],
    ])("no cobra con %s", (_caso, cuotas, k, cantidad, motivo) => {
        const { u } = conBoleto(cuotas);
        const antes = dinero.efectivo(u);
        expect(sistemas.apostar(G, u, k, cantidad).mensaje).toContain(motivo);
        expect(dinero.efectivo(u)).toBe(antes);
        expect(db.prepare("SELECT COUNT(*) AS c FROM sistemas WHERE user_id = ?").get(u).c).toBe(0);
    });

    test("sin saldo para el coste total no cobra nada", () => {
        const { u } = conBoleto([2, 2, 2]);
        dinero.cobrar(u, dinero.efectivo(u) - 100);
        expect(sistemas.apostar(G, u, 2, 100).ok).toBe(false);
        expect(dinero.efectivo(u)).toBe(100);
    });

    test("si una cuota ha cambiado desde que se sumó, hay que volver a sumarla", () => {
        const { u, ids } = conBoleto([2, 2, 2]);
        db.prepare("UPDATE apuestas_partidos SET cuota_home = 2.5 WHERE match_id = ?").run(ids[1]);
        expect(sistemas.apostar(G, u, 2, 100).mensaje).toContain("ha cambiado de cuota");
    });
});

describe("liquidar (#534)", () => {
    function jugado(cuotas, k, cantidad = 100) {
        const { u, ids } = conBoleto(cuotas);
        const r = sistemas.apostar(G, u, k, cantidad);
        return { u, ids, id: r.id, antes: dinero.efectivo(u) };
    }

    test("con una pata fallada en un 2 de 3 cobra solo la combinación que no la lleva", () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        const pagos = jugar(ids, ["1", "2", "1"]);
        expect(premios(id)).toEqual([0, 300, 0]); // 0+2: 100 × 2 × 1,5
        expect(fila(id)).toMatchObject({ estado: "resuelta", premio: 300 });
        expect(dinero.efectivo(u)).toBe(antes + 300);
        expect(pagos).toEqual([expect.objectContaining({ userId: u, premio: 300 })]);
    });

    test("con todas acertadas cobra todas", () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        jugar(ids, ["1", "1", "1"]);
        expect(premios(id)).toEqual([600, 300, 450]);
        expect(dinero.efectivo(u)).toBe(antes + 1350);
    });

    test("con dos falladas en un 2 de 3 no cobra nada", () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        expect(jugar(ids, ["2", "2", "1"])).toEqual([]);
        expect(fila(id)).toMatchObject({ estado: "resuelta", premio: 0 });
        expect(dinero.efectivo(u)).toBe(antes);
    });

    test("no se cierra hasta que se juegan todas sus patas", () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        jugar(ids.slice(0, 2), ["1", "1"]);
        expect(fila(id).estado).toBe("abierta");
        expect(dinero.efectivo(u)).toBe(antes);
    });

    test("una pata anulada cuenta con cuota 1,00", () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        jugar(ids, ["1", "-", "1"]);
        expect(premios(id)).toEqual([200, 300, 150]);
        expect(dinero.efectivo(u)).toBe(antes + 650);
    });

    test("si se anulan todas, se devuelve lo apostado", () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        const pagos = jugar(ids, ["-", "-", "-"]);
        expect(fila(id)).toMatchObject({ estado: "reembolsada", premio: 300 });
        expect(dinero.efectivo(u)).toBe(antes + 300);
        expect(pagos).toEqual([expect.objectContaining({ reembolso: true, premio: 300 })]);
    });

    test("cada combinación se redondea por su cuenta", () => {
        const { ids, id } = jugado([1.33, 1.77, 1.91], 2, 15);
        jugar(ids, ["1", "1", "1"]);
        expect(premios(id)).toEqual([Math.round(15 * 1.33 * 1.77), Math.round(15 * 1.33 * 1.91), Math.round(15 * 1.77 * 1.91)]);
    });

    test("volver a liquidar un partido no paga dos veces", () => {
        const { u, ids, antes } = jugado([2, 3, 1.5], 2);
        jugar(ids, ["1", "1", "1"]);
        expect(jugar(ids, ["1", "1", "1"])).toEqual([]);
        expect(dinero.efectivo(u)).toBe(antes + 1350);
    });

    test("de punta a punta: la liquidación pregunta por los partidos que solo tienen sistemas y los paga", async () => {
        const { u, ids, id, antes } = jugado([2, 3, 1.5], 2);
        const hace = new Date(Date.now() - 5 * 3600e3).toISOString();
        for (const m of ids) db.prepare("UPDATE apuestas_partidos SET start_time = ? WHERE match_id = ?").run(hace, m);
        const score = (m, h, a) => ({
            id: m,
            completed: true,
            home_team: `Local ${m}`,
            away_team: "Visitante",
            scores: [
                { name: `Local ${m}`, score: String(h) },
                { name: "Visitante", score: String(a) },
            ],
        });
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: new Map([["x-requests-remaining", "400"]]),
            json: async () => [score(ids[0], 1, 0), score(ids[1], 0, 2), score(ids[2], 3, 1)],
        }));
        const res = await liquidarApuestas({ minHorasDesdeInicio: 2 });
        expect(fila(id)).toMatchObject({ estado: "resuelta", premio: 300 });
        expect(dinero.efectivo(u)).toBe(antes + 300);
        expect(res.pagos).toEqual(expect.arrayContaining([expect.objectContaining({ userId: u, premio: 300 })]));
    });
});

describe("el boleto y «Mis jugadas» (#534)", () => {
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components);
    const interaccion = (customId, userId, extra = {}) => ({
        customId,
        guildId: G,
        user: { id: userId },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });

    test("🎛️ Sistema solo se activa con 3, 4 o 5 partidos", () => {
        const dos = conBoleto([2, 2]);
        expect(ids(pantallaCombinada(dos.u)).find((c) => c.custom_id === "combinada_sistema").disabled).toBe(true);
        const tres = conBoleto([2, 2, 2]);
        expect(ids(pantallaCombinada(tres.u)).find((c) => c.custom_id === "combinada_sistema").disabled).toBe(false);
    });

    test("el formulario ofrece el tamaño que vale; al enviarlo enseña el coste antes de cobrar; al confirmar se juega", async () => {
        const { u } = conBoleto([2, 2, 2, 2, 2]);
        const abrir = interaccion("combinada_sistema", u);
        await boleto.handleButton({}, abrir);
        const modal = abrir.showModal.mock.calls[0][0].toJSON();
        expect(modal.components[0].component.options.map((o) => o.label)).toEqual(["3 de 5 (10 combinaciones)"]);

        const antes = dinero.efectivo(u);
        const enviar = interaccion("combinada_modal_sistema", u, {
            fields: { getStringSelectValues: (id) => (id === "tamano" ? ["3"] : ["100"]), getTextInputValue: () => "" },
        });
        await boleto.handleModal({}, enviar);
        const confirmacion = enviar.reply.mock.calls[0][0];
        expect(confirmacion.embeds[0].data.description).toContain("coste total **1000**");
        expect(confirmacion.embeds[0].data.description).toContain("Puedes fallar hasta **2** partidos");
        expect(dinero.efectivo(u)).toBe(antes);

        const ok = interaccion(ids(confirmacion)[0].custom_id, u);
        expect(ok.customId).toBe("combinada_sistemaok_3_100");
        await boleto.handleButton({}, ok);
        expect(ok.update.mock.calls[0][0].embeds[0].data.description).toContain("Sistema 3 de 5 registrado");
        expect(dinero.efectivo(u)).toBe(antes - 1000);
    });

    test("«Mis jugadas» enseña el sistema con sus patas y cada combinación, en juego y resuelto", () => {
        const { u, ids: partidos } = conBoleto([2, 3, 1.5]);
        sistemas.apostar(G, u, 2, 100);
        const enJuego = JSON.stringify(buildMisJugadas(u, "activas").embeds[0].data.fields);
        expect(enJuego).toContain("Sistema 2 de 3");
        expect(enJuego).toContain("1+2 @6");
        jugar(partidos, ["1", "2", "1"]);
        const resueltas = JSON.stringify(buildMisJugadas(u, "historial").embeds[0].data.fields);
        expect(resueltas).toContain("🏆 +300");
        expect(resueltas).toContain("1+3 @3 ✅ 300");
    });
});
