// 🃏 Evaluador de manos del póker (#531): cada categoría, sus desempates y kickers, la escalera con el as bajo (rueda) y alto,
// el color contra la escalera, la mejor mano de 5 entre 7 y los empates exactos. Es la pieza con más riesgo del póker.
const { evaluar5, comparar, mejorMano, crearBaraja, escaleraAlta, combinaciones } = require("../src/systems/poker/cartas");

const PALO = { s: "♠️", h: "♥️", d: "♦️", c: "♣️" };
const RANGO = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
/** «Ah Kd Tc…» → cartas. */
const c = (texto) => texto.split(" ").map((t) => ({ rango: RANGO[t[0]] || Number(t[0]), palo: PALO[t[1]], texto: t }));
const categoria = (texto) => evaluar5(c(texto))[0];
/** > 0 si la primera gana. */
const gana = (a, b) => comparar(evaluar5(c(a)), evaluar5(c(b)));

describe("categorías", () => {
    test.each([
        ["Ah Kh Qh Jh Th", 8],
        ["9s 9h 9d 9c 2h", 7],
        ["Ks Kh Kd 2c 2h", 6],
        ["Ah 9h 7h 4h 2h", 5],
        ["9s 8h 7d 6c 5h", 4],
        ["Qs Qh Qd 7c 2h", 3],
        ["Js Jh 4d 4c Ah", 2],
        ["Ts Th 8d 4c 2h", 1],
        ["As Jh 8d 4c 2h", 0],
    ])("%s es de categoría %i", (mano, cat) => {
        expect(categoria(mano)).toBe(cat);
    });

    test("la rueda A-2-3-4-5 es escalera de 5 y pierde con la de 6", () => {
        expect(evaluar5(c("Ah 2s 3d 4c 5h"))).toEqual([4, 5]);
        expect(gana("6h 2s 3d 4c 5h", "Ah 2s 3d 4c 5h")).toBeGreaterThan(0);
        expect(evaluar5(c("Ah 2h 3h 4h 5h"))).toEqual([8, 5]);
    });

    test("no hay escalera que dé la vuelta (Q-K-A-2-3) y la escalera al as es la más alta", () => {
        expect(categoria("Qh Kd As 2c 3h")).toBe(0);
        expect(escaleraAlta([14, 13, 12, 11, 10])).toBe(14);
    });
});

describe("desempates y kickers", () => {
    test("cada categoría gana a la anterior", () => {
        const orden = [
            "As Jh 8d 4c 2h",
            "Ts Th 8d 4c 2h",
            "Js Jh 4d 4c Ah",
            "Qs Qh Qd 7c 2h",
            "9s 8h 7d 6c 5h",
            "Ah 9h 7h 4h 2h",
            "Ks Kh Kd 2c 2h",
            "9s 9h 9d 9c 2h",
            "9h 8h 7h 6h 5h",
        ];
        for (let i = 1; i < orden.length; i++) expect(gana(orden[i], orden[i - 1])).toBeGreaterThan(0);
    });

    test("pareja: primero la pareja y luego los kickers en orden", () => {
        expect(gana("Ks Kh 3d 4c 2h", "Qs Qh Ad Kc Jh")).toBeGreaterThan(0);
        expect(gana("Ts Th Ad 4c 2h", "Td Tc Kd Qc Jh")).toBeGreaterThan(0);
        expect(gana("Ts Th Ad Kc 3h", "Td Tc Ah Ks 2h")).toBeGreaterThan(0);
    });

    test("doble pareja: la alta, la baja y el kicker", () => {
        expect(gana("As Ah 3d 3c 2h", "Ks Kh Qd Qc Ah")).toBeGreaterThan(0);
        expect(gana("Ks Kh 5d 5c 2h", "Kd Kc 4d 4c Ah")).toBeGreaterThan(0);
        expect(gana("Ks Kh 5d 5c 3h", "Kd Kc 5h 5s 2h")).toBeGreaterThan(0);
    });

    test("full: manda el trío; póker: manda el cuádruple y luego el kicker", () => {
        expect(gana("3s 3h 3d 2c 2h", "2s 2h 2d Ac Ah")).toBeGreaterThan(0);
        expect(gana("9s 9h 9d 9c Kh", "9s 9h 9d 9c Qh")).toBeGreaterThan(0);
    });

    test("color: carta a carta; escalera: la carta alta, sin mirar palos", () => {
        expect(gana("Ah 9h 7h 4h 3h", "Ad 9d 7d 4d 2d")).toBeGreaterThan(0);
        expect(gana("Th 9s 8d 7c 6h", "9h 8s 7d 6c 5h")).toBeGreaterThan(0);
    });

    test("manos iguales en distinto palo empatan", () => {
        expect(gana("As Kh Qd 9c 7h", "Ah Ks Qc 9d 7s")).toBe(0);
        expect(gana("9s 8h 7d 6c 5h", "9h 8s 7c 6d 5s")).toBe(0);
    });
});

describe("mejor mano de 7", () => {
    test("elige la mejor combinación de 5 entre 7", () => {
        expect(mejorMano(c("Ah Kh 2c 3d Qh Jh Th")).nombre).toBe("Escalera de color");
        expect(mejorMano(c("Ks Kh Kd 2c 2h 2s 3d")).valor).toEqual([6, 13, 2]);
        expect(mejorMano(c("Ah 2h 5h 9h Kh 3s 4d")).nombre).toBe("Color");
        expect(mejorMano(c("Ad 2c 3h 4s 5d 9c Jh")).valor).toEqual([4, 5]);
    });

    test("con la escalera en la mesa, el kicker de los jugadores no cuenta", () => {
        const mesa = "5h 6d 7c 8s 9h";
        expect(comparar(mejorMano(c(`${mesa} Ac 2d`)).valor, mejorMano(c(`${mesa} Kc 3d`)).valor)).toBe(0);
    });

    test("la baraja tiene 52 cartas distintas y 7 cartas dan 21 combinaciones", () => {
        const b = crearBaraja();
        expect(new Set(b.map((x) => x.texto)).size).toBe(52);
        expect(combinaciones([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(21);
    });
});
