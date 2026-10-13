// Blackjack: seguro con un as visible (#333), rendirse en la primera decisión (#337) y el consejo de la estrategia básica (#343).
// Las cartas salen en el orden de la lista (jugador, jugador, crupier, crupier y luego las que se pidan). Sin servidor (guildId
// null) no hay impuesto, así que las cuentas son exactas.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const bj = require("../src/systems/blackjack");
const cas = require("../src/systems/casinoTransactions");
const estrategia = require("../src/systems/blackjackEstrategia");
jest.spyOn(cas, "procesarGanancia");
const blackjack = require("../src/juegos/casino/blackjack");

const EFIMERO = 64;
const realNuevaPartida = bj.nuevaPartida;
const c = (value) => ({ value, suit: "♠️", display: String(value) });
let n = 0;
function jugador(efectivo = 1000) {
    const id = `bj-ext-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const saldo = (id) => dinero.efectivo(id);
const filasBJ = (id) =>
    db.prepare("SELECT apuesta, resultado, detalle FROM casino WHERE userId = ? AND juego = 'blackjack' ORDER BY rowid").all(id);
const movimientos = (id) => db.prepare("SELECT descripcion, cantidad FROM historial WHERE userId = ? ORDER BY rowid").all(id);
function conBaraja(valores) {
    jest.spyOn(bj, "nuevaPartida").mockImplementationOnce((o) => realNuevaPartida({ ...o, baraja: valores.map(c), rng: () => 0 }));
}
function interaccion(userId, extra = {}) {
    const respuestas = [];
    return {
        respuestas,
        user: { id: userId, username: userId, tag: `${userId}#0` },
        guildId: null,
        options: { getInteger: () => 100 },
        reply: jest.fn(async (p) => respuestas.push(p)),
        update: jest.fn(async (p) => respuestas.push(p)),
        ...extra,
    };
}
const ultima = (i) => i.respuestas.at(-1);
const titulo = (i) => ultima(i).embeds?.[0]?.data.title;
const descripcion = (i) => ultima(i).embeds?.[0]?.data.description;
const botones = (i) => ultima(i).components.flatMap((f) => f.components.map((b) => b.data));
async function empezar(userId, apuesta = 100) {
    const i = interaccion(userId, { options: { getInteger: () => apuesta } });
    await blackjack.run(null, i);
    return i;
}
async function pulsar(userId, customId) {
    const i = interaccion(userId, { customId });
    await blackjack.handleButton(null, i);
    return i;
}

afterEach(() => jest.clearAllMocks());

describe("seguro (#333)", () => {
    test("con un as visible se ofrece antes de mirar si el crupier tiene blackjack, sin cobrar nada más", async () => {
        const u = jugador();
        conBaraja([10, 7, 11, 5]);
        const i = await empezar(u);
        expect(titulo(i)).toBe("🃏 Blackjack - ¿Seguro?");
        expect(descripcion(i)).toMatch(/seguro cuesta `50` monedas/);
        expect(botones(i).map((b) => [b.custom_id, b.label])).toEqual([
            ["bj_insure", "🛡️ Seguro (50)"],
            ["bj_noinsure", "Sin seguro"],
            ["bj_help", "Ayuda"],
        ]);
        expect(saldo(u)).toBe(900); // solo la apuesta
    });

    test("con otra carta visible, o con blackjack del jugador, no se ofrece nunca", async () => {
        for (const baraja of [
            [10, 7, 10, 11],
            [10, 7, 9, 11],
            [11, 10, 11, 7],
        ]) {
            const u = jugador();
            conBaraja(baraja);
            const i = await empezar(u);
            expect(titulo(i)).not.toMatch(/Seguro/);
        }
        const u = jugador();
        conBaraja([10, 7, 5, 5]);
        expect(titulo(await empezar(u))).toBe("🃏 Blackjack");
    });

    test("sin efectivo para el seguro no se ofrece; el coste es la mitad de la apuesta, redondeada hacia abajo", async () => {
        const sinSaldo = jugador(100);
        conBaraja([10, 7, 11, 5]);
        expect(titulo(await empezar(sinSaldo))).toBe("🃏 Blackjack");

        const u = jugador();
        conBaraja([10, 7, 11, 5]);
        const i = await empezar(u, 15);
        expect(botones(i)[0].label).toBe("🛡️ Seguro (7)");
        await pulsar(u, "bj_insure");
        expect(saldo(u)).toBe(1000 - 15 - 7);
    });

    test("el crupier tiene blackjack: el seguro paga 2 a 1, la mano se pierde y en las partidas solo queda la mano", async () => {
        const u = jugador();
        conBaraja([10, 7, 11, 10]);
        await empezar(u);
        const i = await pulsar(u, "bj_insure");
        expect(titulo(i)).toBe("🃏 El crupier tiene Blackjack");
        expect(ultima(i).embeds[0].data.fields).toEqual([
            { name: "🛡️ Seguro", value: "El crupier tiene blackjack: el seguro paga 2 a 1 (+100)." },
        ]);
        expect(saldo(u)).toBe(1000); // -100 de la mano, -50 + 150 del seguro
        expect(filasBJ(u)).toEqual([expect.objectContaining({ apuesta: 100, resultado: -100 })]); // el seguro no es una partida más
        expect(movimientos(u).map((m) => m.descripcion)).toEqual(expect.arrayContaining(["Blackjack: seguro cobrado (2 a 1)"]));
        // Ya no hay partida en curso.
        expect((await pulsar(u, "bj_stand")).reply).not.toHaveBeenCalled();
    });

    test("el crupier no tiene blackjack: se pierde el seguro y la partida sigue sin cambios", async () => {
        const u = jugador();
        conBaraja([10, 8, 11, 5, 10, 10]); // crupier A + 5, y luego dos 10
        await empezar(u);
        const i = await pulsar(u, "bj_insure");
        expect(titulo(i)).toBe("🃏 Blackjack");
        expect(descripcion(i)).toMatch(/pierdes el seguro \(-50\)/);
        expect(saldo(u)).toBe(850);
        expect(movimientos(u).map((m) => [m.descripcion, m.cantidad])).toEqual(
            expect.arrayContaining([["Blackjack: seguro perdido", -50]]),
        );
        expect(botones(i).map((b) => b.custom_id)).toEqual(expect.arrayContaining(["bj_hit", "bj_stand", "bj_surrender"]));

        const fin = await pulsar(u, "bj_stand"); // 18 contra A+5+10 = 16... el crupier sigue hasta 17+
        expect(titulo(fin)).toBe("🃏 Blackjack - Resultado");
        expect(filasBJ(u)).toHaveLength(1);
    });

    test("sin seguro: la partida sigue o, si el crupier tiene blackjack, acaba como siempre", async () => {
        const a = jugador();
        conBaraja([10, 7, 11, 10]);
        await empezar(a);
        const natural = await pulsar(a, "bj_noinsure");
        expect(titulo(natural)).toBe("🃏 El crupier tiene Blackjack");
        expect(ultima(natural).embeds[0].data.fields).toBeUndefined();
        expect(saldo(a)).toBe(900);

        const b = jugador();
        conBaraja([10, 7, 11, 5]);
        await empezar(b);
        const sigue = await pulsar(b, "bj_noinsure");
        expect(titulo(sigue)).toBe("🃏 Blackjack");
        expect(saldo(b)).toBe(900);
    });

    test("mientras se decide el seguro no se puede pedir, plantarse ni rendirse", async () => {
        const u = jugador();
        conBaraja([10, 7, 11, 5]);
        await empezar(u);
        for (const id of ["bj_hit", "bj_stand", "bj_double", "bj_surrender"]) {
            const i = await pulsar(u, id);
            expect(ultima(i)).toEqual({ content: "Decide primero si quieres el seguro.", flags: EFIMERO });
        }
        expect(saldo(u)).toBe(900);
        // Y decidirlo dos veces no cobra dos veces.
        await pulsar(u, "bj_insure");
        const otra = await pulsar(u, "bj_insure");
        expect(ultima(otra).content).toBe("No hay ningún seguro que decidir.");
        expect(saldo(u)).toBe(850);
    });

    test("si el seguro no se puede cobrar, el mensaje dice por qué y la decisión sigue pendiente", async () => {
        const u = jugador(160);
        conBaraja([10, 7, 11, 5]);
        await empezar(u, 100); // quedan 60: alcanza para el seguro (50)
        db.prepare("UPDATE banco SET enMano = 10 WHERE userId = ?").run(u); // pero se lo gasta en otra cosa
        const i = await pulsar(u, "bj_insure");
        expect(ultima(i).content).toMatch(/No te llega el efectivo/);
        const despues = await pulsar(u, "bj_noinsure");
        expect(titulo(despues)).toBe("🃏 Blackjack");
    });
});

describe("rendirse (#337)", () => {
    test("en la primera decisión devuelve la mitad de la apuesta y cierra la partida", async () => {
        const u = jugador();
        conBaraja([10, 6, 10, 7]);
        const inicio = await empezar(u);
        expect(botones(inicio).find((b) => b.custom_id === "bj_surrender").disabled).toBeFalsy();
        const i = await pulsar(u, "bj_surrender");
        expect(titulo(i)).toBe("🏳️ Blackjack - Te rindes");
        expect(descripcion(i)).toMatch(/Recuperas la mitad de la apuesta: `50` de 100 monedas/);
        expect(saldo(u)).toBe(950);
        expect(filasBJ(u)).toEqual([expect.objectContaining({ apuesta: 100, resultado: -50 })]);
        expect(JSON.parse(filasBJ(u)[0].detalle)).toMatchObject({ tipo: "rendido" });
        expect(movimientos(u).at(-1)).toEqual({ descripcion: "Blackjack: rendido (recupera la mitad)", cantidad: -50 });
        // El crupier no roba y no se puede seguir.
        expect((await pulsar(u, "bj_stand")).reply).not.toHaveBeenCalled();
    });

    test("con una apuesta impar se redondea hacia abajo", async () => {
        const u = jugador();
        conBaraja([10, 6, 10, 7]);
        await empezar(u, 15);
        await pulsar(u, "bj_surrender");
        expect(saldo(u)).toBe(1000 - 15 + 7);
    });

    test("después de pedir carta ya no se puede: el botón se desactiva y pulsarlo avisa", async () => {
        const u = jugador();
        conBaraja([2, 3, 10, 8, 4]);
        await empezar(u);
        const tras = await pulsar(u, "bj_hit");
        expect(botones(tras).find((b) => b.custom_id === "bj_surrender").disabled).toBe(true);
        const i = await pulsar(u, "bj_surrender");
        expect(ultima(i)).toEqual({ content: "Ya no puedes rendirte: solo vale en la primera decisión de la mano.", flags: EFIMERO });
        expect(saldo(u)).toBe(900);
    });

    test("tampoco tras separar, ni la rendición se ofrece en las manos separadas", async () => {
        const u = jugador();
        conBaraja([8, 8, 10, 7, 3, 4]);
        await empezar(u);
        const sep = await pulsar(u, "bj_split");
        expect(ultima(sep).components[0].components.map((b) => b.data.custom_id)).not.toContain("bj_surrender");
        expect(bj.rendirse({ puedeRendirse: false, userHand: [c(1), c(2)], apuesta: 100 })).toBeNull();
        expect(bj.rendirse({ puedeRendirse: true, split: true, userHand: [c(1), c(2)], apuesta: 100 })).toBeNull();
    });

    test("si el cobro falla, avisa y la partida no queda bloqueada", async () => {
        const u = jugador();
        conBaraja([10, 6, 10, 7]);
        await empezar(u);
        cas.procesarGanancia.mockReturnValueOnce(false);
        const i = await pulsar(u, "bj_surrender");
        expect(ultima(i).content).toMatch(/Error procesando el resultado/);
        conBaraja([10, 7, 10, 8]);
        expect(titulo(await empezar(u))).toBe("🃏 Blackjack");
    });
});

describe("consejo (#343)", () => {
    test("responde solo a quien lo pulsa, con la jugada de la estrategia básica, sin tocar la partida ni el saldo", async () => {
        const u = jugador();
        conBaraja([10, 6, 10, 7, 2]); // 16 contra un 10
        const inicio = await empezar(u);
        const antes = botones(inicio).map((b) => b.disabled);
        const i = await pulsar(u, "bj_tip");
        expect(ultima(i)).toEqual({
            content: "💡 La estrategia básica dice: **pedir carta**. Tienes 16 y el crupier enseña un 10.",
            flags: EFIMERO,
        });
        expect(i.update).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(900);
        // La partida sigue igual: se puede pedir como antes.
        expect(titulo(await pulsar(u, "bj_hit"))).toBe("🃏 Blackjack");
        expect(antes).toBeDefined();
    });

    test("el botón está en la mano, y sin partida propia no hace nada", async () => {
        const u = jugador();
        conBaraja([10, 6, 10, 7]);
        const inicio = await empezar(u);
        expect(botones(inicio).map((b) => b.custom_id)).toContain("bj_tip");
        const ajeno = await pulsar("otra-persona", "bj_tip");
        expect(ajeno.reply).not.toHaveBeenCalled();
    });
});

describe("la estrategia básica coincide con la tabla (4 barajas, el crupier se planta en 17)", () => {
    // Una letra por carta visible del crupier: 2 3 4 5 6 7 8 9 10 A.
    // H pedir · S plantarse · D doblar (si no se puede, pedir) · d doblar (si no se puede, plantarse) · P separar.
    const CRUPIER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const DURAS = {
        5: ["2", "3"],
        6: ["2", "4"],
        7: ["2", "5"],
        8: ["3", "5"],
        9: ["3", "6"],
        10: ["4", "6"],
        11: ["5", "6"],
        12: ["5", "7"],
        13: ["6", "7"],
        14: ["6", "8"],
        15: ["7", "8"],
        16: ["7", "9"],
        17: ["8", "9"],
    };
    const TABLA_DURAS = {
        5: "HHHHHHHHHH",
        6: "HHHHHHHHHH",
        7: "HHHHHHHHHH",
        8: "HHHHHHHHHH",
        9: "HDDDDHHHHH",
        10: "DDDDDDDDHH",
        11: "DDDDDDDDDH",
        12: "HHSSSHHHHH",
        13: "SSSSSHHHHH",
        14: "SSSSSHHHHH",
        15: "SSSSSHHHHH",
        16: "SSSSSHHHHH",
        17: "SSSSSSSSSS",
    };
    const TABLA_BLANDAS = {
        2: "HHHDDHHHHH", // A-2 = 13
        3: "HHHDDHHHHH",
        4: "HHDDDHHHHH",
        5: "HHDDDHHHHH",
        6: "HDDDDHHHHH",
        7: "SddddSSHHH", // A-7: plantarse con 2, 7 y 8; doblar (o plantarse) con 3-6; pedir con 9, 10 y A
        8: "SSSSSSSSSS",
        9: "SSSSSSSSSS",
    };
    const TABLA_PARES = {
        2: "PPPPPPHHHH",
        3: "PPPPPPHHHH",
        4: "HHHPPHHHHH",
        6: "PPPPPHHHHH",
        7: "PPPPPPHHHH",
        8: "PPPPPPPPPP",
        9: "PPPPPSPPSS",
        10: "SSSSSSSSSS",
        11: "PPPPPPPPPP",
    };
    const NOMBRE = { H: "pedir", S: "plantarse", D: "doblar", d: "doblar", P: "separar" };
    const SIN_DOBLAR = { D: "pedir", d: "plantarse" }; // lo que se hace si no se puede doblar

    function partida(mano, crupier, { puedeDoblar = true, puedeSplit = true } = {}) {
        return { userHand: mano.map((v) => c(Number(v))), botHand: [c(crupier), c(10)], puedeDoblar, puedeSplit };
    }
    function comprobar(mano, fila) {
        CRUPIER.forEach((crupier, i) => {
            const letra = fila[i];
            const accion = estrategia.recomendarAccion(partida(mano, crupier)).accion;
            expect({ mano: mano.join("+"), crupier, accion }).toEqual({ mano: mano.join("+"), crupier, accion: NOMBRE[letra] });
            if (SIN_DOBLAR[letra]) {
                const sin = estrategia.recomendarAccion(partida(mano, crupier, { puedeDoblar: false })).accion;
                expect(sin).toBe(SIN_DOBLAR[letra]);
            }
        });
    }

    test("totales duros", () => {
        for (const [total, mano] of Object.entries(DURAS)) comprobar(mano, TABLA_DURAS[total]);
    });

    test("totales blandos", () => {
        for (const [otra, fila] of Object.entries(TABLA_BLANDAS)) comprobar([11, Number(otra)], fila);
    });

    test("pares, y el 5-5 se juega como un 10 duro", () => {
        for (const [valor, fila] of Object.entries(TABLA_PARES)) comprobar([Number(valor), Number(valor)], fila);
        comprobar([5, 5], TABLA_DURAS[10]);
    });

    test("sin saldo para separar se juega como el total que suma; con más de dos cartas no se dobla ni se separa", () => {
        expect(estrategia.recomendarAccion(partida([8, 8], 10, { puedeSplit: false })).accion).toBe("pedir"); // 16 contra 10
        expect(estrategia.recomendarAccion(partida([9, 9], 6, { puedeSplit: false })).accion).toBe("plantarse"); // 18
        expect(estrategia.recomendarAccion(partida([11, 11], 6, { puedeSplit: false })).accion).toBe("pedir");
        expect(estrategia.recomendarAccion(partida([2, 3, 6], 5)).accion).toBe("pedir"); // 11 con tres cartas: no se dobla
        expect(estrategia.recomendarAccion(partida([11, 2, 4], 6)).accion).toBe("pedir"); // blando 17 con tres cartas
        expect(estrategia.recomendarAccion(partida([11, 2, 5], 6)).accion).toBe("plantarse"); // blando 18 con tres cartas
    });

    test("el texto dice la jugada, el total, si es blanda y la carta del crupier", () => {
        expect(estrategia.textoConsejo(partida([11, 7], 6))).toBe(
            "💡 La estrategia básica dice: **doblar**. Tienes una mano blanda de 18 y el crupier enseña un 6.",
        );
        expect(estrategia.textoConsejo(partida([8, 8], 11))).toBe(
            "💡 La estrategia básica dice: **separar**. Tienes 16 y el crupier enseña un as.",
        );
        expect(estrategia.esBlanda([c(11), c(6), c(10)])).toBe(false); // el as pasa a valer 1
    });
});
