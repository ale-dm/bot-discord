// Jugadas del blackjack con una baraja preparada: rng = 0 saca siempre la primera carta, así
// que las cartas salen en el orden de la lista (jugador, jugador, crupier, crupier, ...).
const bj = require("../src/systems/blackjack");

const c = (value) => ({ value, suit: "♠️", display: String(value) });
const partida = (valores, { apuesta = 100, saldoRestante = 1000 } = {}) =>
    bj.nuevaPartida({ apuesta, guildId: "g", saldoRestante, baraja: valores.map(c), rng: () => 0 });

test("reparte dos cartas a cada uno y decide si se puede doblar o separar", () => {
    const s = partida([8, 8, 10, 7]);
    expect(bj.handValue(s.userHand)).toBe(16);
    expect(bj.handValue(s.botHand)).toBe(17);
    expect(s.puedeDoblar).toBe(true);
    expect(s.puedeSplit).toBe(true);
    expect(partida([8, 8, 10, 7], { saldoRestante: 50 })).toMatchObject({ puedeDoblar: false, puedeSplit: false });
});

test("blackjack natural", () => {
    expect(bj.naturales(partida([11, 10, 10, 7]))).toBe("blackjack");
    expect(bj.naturales(partida([10, 7, 11, 10]))).toBe("derrota_blackjack");
    expect(bj.naturales(partida([11, 10, 10, 11]))).toBe("empate_blackjack");
    expect(bj.naturales(partida([10, 7, 10, 7]))).toBeNull();
});

test("doblar: dobla la apuesta, roba una carta y juega el crupier", () => {
    const s = partida([5, 6, 10, 6, 10, 5]); // jugador 11 + 10 = 21; crupier 16 + 5 = 21
    const r = bj.doblar(s);
    expect(s.apuesta).toBe(200);
    expect(r).toEqual({ userVal: 21, botVal: 21, resultado: "empate" });
    expect(s.finished).toBe(true);
});

test("doblar y pasarse pierde aunque el crupier también se pase", () => {
    const s = partida([10, 6, 10, 6, 10, 10]); // jugador 16 + 10 = 26; crupier 16 + 10 = 26
    expect(bj.doblar(s)).toEqual({ userVal: 26, botVal: 26, resultado: "pierde" });
});

test("split: dos manos, se juegan por orden y se resuelven por separado", () => {
    // Jugador 8 8 · crupier 10 7 · mano 1 recibe 3, mano 2 recibe 10 · la mano 1 pide un 10.
    const s = partida([8, 8, 10, 7, 3, 10, 10]);
    expect(bj.separar(s)).toEqual({ sonAses: false });
    expect(s.hands.map(bj.handValue)).toEqual([11, 18]);
    expect(bj.pedirSplit(s)).toEqual({ valor: 21, pasada: false, terminado: false });
    expect(bj.plantarseSplit(s)).toEqual({ terminado: false });
    expect(s.currentHand).toBe(1);
    expect(bj.plantarseSplit(s)).toEqual({ terminado: true });

    const { botVal, manos } = bj.resolverSplit(s);
    expect(botVal).toBe(17);
    expect(manos.map((m) => [m.valor, m.resultado, m.blackjack])).toEqual([
        [21, "gana", false],
        [18, "gana", false],
    ]);
    expect(bj.totalApostado(s)).toBe(200);
});

test("split: una mano que se pasa pierde y se pasa a la siguiente", () => {
    const s = partida([10, 10, 10, 7, 5, 9, 10]); // mano 1: 10+5, pide 10 → 25
    bj.separar(s);
    expect(bj.pedirSplit(s)).toEqual({ valor: 25, pasada: true, terminado: false });
    expect(s.currentHand).toBe(1);
    expect(bj.plantarseSplit(s)).toEqual({ terminado: true });
    expect(bj.resolverSplit(s).manos.map((m) => m.resultado)).toEqual(["pasada", "gana"]);
});

test("split de ases: una carta a cada mano y se resuelve sin jugar", () => {
    const s = partida([11, 11, 10, 7, 10, 5]);
    expect(bj.separar(s)).toEqual({ sonAses: true });
    const { manos } = bj.resolverSplit(s);
    expect(manos.map((m) => [m.valor, m.resultado, m.blackjack])).toEqual([
        [21, "gana", true],
        [16, "pierde", false],
    ]);
});

test("cobro al ganar: el doble, o 2,5× con blackjack", () => {
    expect(bj.cobroGanador(100)).toBe(200);
    expect(bj.cobroGanador(101, true)).toBe(252);
});
