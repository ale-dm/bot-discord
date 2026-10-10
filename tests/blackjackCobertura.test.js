// Blackjack del casino (juegos/casino/blackjack) de principio a fin: apuestas no válidas, reparto y naturales, cada
// jugada (pedir, plantarse, doblar, separar), el cobro de cada mano, las partidas en curso y las abandonadas, y los
// errores al cobrar. Las cartas salen en el orden de la lista (jugador, jugador, crupier, crupier y luego las que se
// pidan) porque la baraja se fija con rng = 0. Sin servidor (guildId null) no hay impuesto, así que las cuentas son
// exactas.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const bj = require("../src/systems/blackjack");
const cas = require("../src/systems/casinoTransactions");
// Los espías van antes de cargar blackjackCobros y blackjack: ambos desestructuran estas funciones al cargarse.
jest.spyOn(cas, "procesarGanancia");
jest.spyOn(cas, "procesarPerdida");
const cobros = require("../src/systems/blackjackCobros");
jest.spyOn(cobros, "cobrarExtraBJ");
const blackjack = require("../src/juegos/casino/blackjack");

const realNuevaPartida = bj.nuevaPartida;

const c = (value) => ({ value, suit: "♠️", display: String(value) });
let n = 0;
/** Un jugador con exactamente `efectivo` en mano (las cuentas nuevas arrancan con un saldo inicial). */
function jugador(efectivo = 1000) {
    const id = `bj-cob-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const saldo = (id) => dinero.efectivo(id);
const ultimaBJ = (id) =>
    db.prepare("SELECT resultado, detalle FROM casino WHERE userId = ? AND juego = 'blackjack' ORDER BY rowid DESC LIMIT 1").get(id);
const cuantasBJ = (id) => db.prepare("SELECT COUNT(*) AS n FROM casino WHERE userId = ? AND juego = 'blackjack'").get(id).n;

/** La próxima partida reparte esta baraja. Devuelve un contenedor que recibe el estado creado. */
function conBaraja(valores) {
    const h = {};
    jest.spyOn(bj, "nuevaPartida").mockImplementationOnce((o) => {
        h.state = realNuevaPartida({ ...o, baraja: valores.map(c), rng: () => 0 });
        return h.state;
    });
    return h;
}

/** Una interacción de Discord con sus respuestas en orden (reply, update). */
function interaccion(userId, extra = {}) {
    const respuestas = [];
    return {
        respuestas,
        user: { id: userId, username: userId, tag: `${userId}#0` },
        guildId: null,
        options: { getInteger: () => 100 },
        reply: jest.fn(async (p) => {
            respuestas.push(p);
        }),
        update: jest.fn(async (p) => {
            respuestas.push(p);
        }),
        ...extra,
    };
}
const ultima = (i) => i.respuestas.at(-1);
const titulo = (i) => ultima(i).embeds?.[0]?.data.title;
const descripcion = (i) => ultima(i).embeds?.[0]?.data.description;
const campo = (i, nombre) => ultima(i).embeds[0].data.fields.find((f) => f.name === nombre)?.value;

async function empezar(userId, { apuesta = 100 } = {}) {
    const i = interaccion(userId, { options: { getInteger: () => apuesta } });
    await blackjack.run(null, i);
    return i;
}
async function pulsar(userId, customId) {
    const i = interaccion(userId, { customId });
    await blackjack.handleButton(null, i);
    return i;
}

// clearAllMocks (no restoreAllMocks): los espías de cas y cobros deben seguir pasando la llamada al módulo.
afterEach(() => {
    jest.clearAllMocks();
});

describe("apuestas y reparto", () => {
    test("sin importe, muestra el selector de apuestas y no reparte", async () => {
        const u = jugador(1000);
        const i = interaccion(u, { options: { getInteger: () => null } });
        await blackjack.run(null, i);
        expect(titulo(i)).toMatch(/Elige tu apuesta/);
        expect(saldo(u)).toBe(1000);
    });

    test("por debajo del mínimo (10) se rechaza sin cobrar ni repartir", async () => {
        const u = jugador(1000);
        const i = await empezar(u, { apuesta: 5 });
        expect(ultima(i).content).toMatch(/La apuesta mínima es de 10 monedas/);
        expect(ultima(i).flags).toBeDefined();
        expect(saldo(u)).toBe(1000);
        const hit = await pulsar(u, "bj_hit");
        expect(hit.reply).not.toHaveBeenCalled();
    });

    test("sin saldo para la apuesta se rechaza sin cobrar", async () => {
        const u = jugador(50);
        const i = await empezar(u, { apuesta: 100 });
        expect(ultima(i).content).toMatch(/No te llega el efectivo/);
        expect(saldo(u)).toBe(50);
    });

    test("reparte dos cartas a cada uno, cobra la apuesta y deja doblar pero no separar", async () => {
        const u = jugador(1000);
        conBaraja([10, 9, 10, 7, 5]); // jugador 19 · crupier 17
        const i = await empezar(u);
        expect(titulo(i)).toBe("🃏 Blackjack");
        expect(descripcion(i)).toMatch(/Tus cartas: 10 9 \(\*\*19\*\*\)/);
        expect(descripcion(i)).toMatch(/Carta visible del crupier: 10/);
        expect(saldo(u)).toBe(900);
        const botones = ultima(i).components.flatMap((f) => f.components.map((b) => b.data));
        expect(botones.find((b) => b.custom_id === "bj_double").disabled).toBeFalsy();
        expect(botones.find((b) => b.custom_id === "bj_split").disabled).toBe(true);
    });

    test("separar aparece cuando las dos primeras cartas tienen el mismo valor", async () => {
        const u = jugador(1000);
        conBaraja([8, 8, 10, 7]);
        const i = await empezar(u);
        const botones = ultima(i).components.flatMap((f) => f.components.map((b) => b.data));
        expect(botones.find((b) => b.custom_id === "bj_split").disabled).toBeFalsy();
    });

    test("doblar o separar no se ofrecen si el saldo que queda no cubre otra apuesta igual", async () => {
        const u = jugador(150);
        conBaraja([8, 8, 10, 7]);
        const i = await empezar(u, { apuesta: 100 });
        const botones = ultima(i).components.flatMap((f) => f.components.map((b) => b.data));
        expect(botones.find((b) => b.custom_id === "bj_double").disabled).toBe(true);
        expect(botones.find((b) => b.custom_id === "bj_split").disabled).toBe(true);
    });
});

describe("blackjack natural", () => {
    test("el jugador tiene blackjack: cobra 2,5 veces la apuesta y la partida acaba", async () => {
        const u = jugador(1000);
        conBaraja([11, 10, 10, 7]);
        const i = await empezar(u);
        expect(titulo(i)).toBe("🃏 ¡Blackjack natural!");
        expect(descripcion(i)).toMatch(/¡Has ganado `250` monedas!/);
        expect(saldo(u)).toBe(1150);
        expect(ultimaBJ(u).resultado).toBe(150);
        expect(ultima(i).components[0].components[0].data.custom_id).toBe("casino_play_blackjack_100");
        const despues = await pulsar(u, "bj_stand");
        expect(despues.reply).not.toHaveBeenCalled();
        expect(despues.update).not.toHaveBeenCalled();
    });

    test("empate de blackjacks: se devuelve la apuesta", async () => {
        const u = jugador(1000);
        conBaraja([11, 10, 11, 10]);
        const i = await empezar(u);
        expect(titulo(i)).toBe("🃏 Blackjack - Empate de Blackjacks");
        expect(saldo(u)).toBe(1000);
        expect(ultimaBJ(u).resultado).toBe(0);
    });

    test("el crupier tiene blackjack: se pierde la apuesta al repartir", async () => {
        const u = jugador(1000);
        conBaraja([10, 7, 11, 10]);
        const i = await empezar(u);
        expect(titulo(i)).toBe("🃏 El crupier tiene Blackjack");
        expect(descripcion(i)).toMatch(/Perdiste la apuesta/);
        expect(saldo(u)).toBe(900);
        expect(ultimaBJ(u).resultado).toBe(-100);
    });

    test("si no se puede registrar el blackjack del jugador, avisa de error", async () => {
        const u = jugador(1000);
        conBaraja([11, 10, 10, 7]);
        cas.procesarGanancia.mockReturnValueOnce(false);
        const i = await empezar(u);
        expect(ultima(i).content).toMatch(/Error procesando el resultado/);
        expect(ultima(i).embeds).toBeUndefined();
    });

    test("si no se puede registrar la pérdida ante el blackjack del crupier, avisa de error", async () => {
        const u = jugador(1000);
        conBaraja([10, 7, 11, 10]);
        cas.procesarPerdida.mockReturnValueOnce(false);
        const i = await empezar(u);
        expect(ultima(i).content).toMatch(/Error procesando el resultado/);
    });
});

describe("pedir, plantarse y doblar", () => {
    test("pedir carta sigue la partida hasta pasarse, y entonces se pierde la apuesta", async () => {
        const u = jugador(1000);
        conBaraja([2, 3, 10, 8, 10, 10]); // jugador 2+3 · crupier 10+8
        await empezar(u);
        const primera = await pulsar(u, "bj_hit");
        expect(titulo(primera)).toBe("🃏 Blackjack");
        expect(descripcion(primera)).toMatch(/\(\*\*15\*\*\)/);
        expect(saldo(u)).toBe(900);

        const segunda = await pulsar(u, "bj_hit");
        expect(titulo(segunda)).toBe("🃏 Blackjack - ¡Te pasaste!");
        expect(saldo(u)).toBe(900);
        expect(ultimaBJ(u)).toMatchObject({ resultado: -100 });
        expect(JSON.parse(ultimaBJ(u).detalle)).toMatchObject({ tipo: "derrota_bust" });
    });

    test("si no se puede registrar la pérdida al pasarse, avisa de error", async () => {
        const u = jugador(1000);
        conBaraja([10, 6, 10, 7, 10]);
        await empezar(u);
        cas.procesarPerdida.mockReturnValueOnce(false);
        const i = await pulsar(u, "bj_hit");
        expect(ultima(i).content).toMatch(/Error procesando el resultado/);
    });

    test("plantarse gana si el crupier se pasa de 21 (sube a 26): cobra el doble", async () => {
        const u = jugador(1000);
        conBaraja([10, 9, 10, 6, 10]); // jugador 19 · crupier 16 → pide un 10 → 26
        await empezar(u);
        const i = await pulsar(u, "bj_stand");
        expect(titulo(i)).toBe("🃏 Blackjack - Resultado");
        expect(descripcion(i)).toMatch(/¡Ganaste! Has ganado `200` monedas/);
        expect(saldo(u)).toBe(1100);
        expect(ultimaBJ(u).resultado).toBe(100);
    });

    test("plantarse con el mismo total que el crupier devuelve la apuesta", async () => {
        const u = jugador(1000);
        conBaraja([10, 8, 10, 8]);
        await empezar(u);
        const i = await pulsar(u, "bj_stand");
        expect(descripcion(i)).toMatch(/Empate\. Recuperas tu apuesta/);
        expect(saldo(u)).toBe(1000);
    });

    test("plantarse con menos que el crupier pierde la apuesta", async () => {
        const u = jugador(1000);
        conBaraja([10, 7, 10, 9]); // 17 contra 19
        await empezar(u);
        const i = await pulsar(u, "bj_stand");
        expect(descripcion(i)).toMatch(/Perdiste la apuesta/);
        expect(saldo(u)).toBe(900);
    });

    test("si no se puede registrar la victoria al plantarse, avisa de error", async () => {
        const u = jugador(1000);
        conBaraja([10, 9, 10, 6, 10]);
        await empezar(u);
        cas.procesarGanancia.mockReturnValueOnce(false);
        const i = await pulsar(u, "bj_stand");
        expect(ultima(i).content).toMatch(/Error procesando el resultado/);
    });

    test("doblar: paga la segunda apuesta, pide una carta y pierde si el crupier gana", async () => {
        const u = jugador(1000);
        conBaraja([5, 6, 10, 6, 2, 5]); // jugador 11 → 13 · crupier 16 → 21
        await empezar(u);
        const i = await pulsar(u, "bj_double");
        expect(titulo(i)).toBe("🃏 Blackjack - Resultado (Doblar)");
        expect(saldo(u)).toBe(800);
        expect(ultimaBJ(u)).toMatchObject({ resultado: -200 });
    });

    test("doblar y ganar: paga el doble de la apuesta doblada (1000 → 1200)", async () => {
        const u = jugador(1000);
        conBaraja([5, 6, 10, 6, 10, 10]); // jugador 11 → 21 · crupier 16 → 26
        await empezar(u);
        await pulsar(u, "bj_double");
        expect(saldo(u)).toBe(1200);
        expect(ultimaBJ(u)).toMatchObject({ resultado: 200 });
    });

    test("doblar no se puede si el saldo que queda no cubre otra apuesta igual", async () => {
        const u = jugador(150);
        conBaraja([5, 6, 10, 6]);
        await empezar(u, { apuesta: 100 });
        const i = await pulsar(u, "bj_double");
        expect(ultima(i).content).toMatch(/No puedes doblar ahora/);
        expect(saldo(u)).toBe(50);
    });

    test("si no se puede cobrar la segunda apuesta, no se dobla y la partida sigue", async () => {
        const u = jugador(1000);
        conBaraja([5, 6, 10, 6, 10]);
        await empezar(u);
        cobros.cobrarExtraBJ.mockReturnValueOnce({ exito: false, mensaje: "❌ No te llega el efectivo para eso." });
        const fallo = await pulsar(u, "bj_double");
        expect(ultima(fallo).content).toMatch(/No te llega el efectivo para eso/);
        expect(saldo(u)).toBe(900);
        const sigue = await pulsar(u, "bj_stand");
        expect(titulo(sigue)).toBe("🃏 Blackjack - Resultado");
    });

    test("la ayuda se abre en privado durante la partida y no la termina", async () => {
        const u = jugador(1000);
        conBaraja([10, 9, 10, 6, 10]);
        await empezar(u);
        const ayuda = await pulsar(u, "bj_help");
        expect(ayuda.reply.mock.calls[0][0].embeds[0].data.title).toBe("ℹ️ Cómo jugar al Blackjack");
        expect(ayuda.reply.mock.calls[0][0].flags).toBeDefined();
        const sigue = await pulsar(u, "bj_stand");
        expect(titulo(sigue)).toBe("🃏 Blackjack - Resultado");
    });

    test("sin partida, la ayuda sí responde y otros botones no hacen nada", async () => {
        const u = jugador(1000);
        const ayuda = await pulsar(u, "bj_help");
        expect(ayuda.reply.mock.calls[0][0].embeds[0].data.title).toBe("ℹ️ Cómo jugar al Blackjack");
        const otro = await pulsar(u, "bj_hit");
        expect(otro.reply).not.toHaveBeenCalled();
        expect(otro.update).not.toHaveBeenCalled();
    });
});

describe("separar (split)", () => {
    test("no se puede separar si las dos cartas no son iguales", async () => {
        const u = jugador(1000);
        conBaraja([8, 9, 10, 7]);
        await empezar(u);
        const i = await pulsar(u, "bj_split");
        expect(ultima(i).content).toMatch(/No puedes separar ahora/);
        expect(saldo(u)).toBe(900);
    });

    test("cada mano se juega por turnos; una mano que se pasa pierde y la partida acaba con dos pérdidas", async () => {
        const u = jugador(1000);
        conBaraja([8, 8, 10, 9, 2, 10, 5, 10]); // mano 1: 8+2 · mano 2: 8+10 · crupier 19
        await empezar(u);
        const separada = await pulsar(u, "bj_split");
        expect(titulo(separada)).toBe("🃏 Blackjack - Mano 1 (Separada)");
        expect(saldo(u)).toBe(800);

        const sigue = await pulsar(u, "bj_hit_split"); // mano 1: 10 + 5 = 15, sigue
        expect(titulo(sigue)).toBe("🃏 Blackjack - Mano 1 (Separada)");
        expect(descripcion(sigue)).toMatch(/\(\*\*15\*\*\)/);

        const pasa = await pulsar(u, "bj_hit_split"); // mano 1: 15 + 10 = 25, se pasa
        expect(titulo(pasa)).toBe("🃏 Blackjack - Mano 2 (Separada)");
        expect(descripcion(pasa)).toMatch(/¡Se pasó!/);

        const fin = await pulsar(u, "bj_stand_split"); // mano 2: 18 contra 19
        expect(titulo(fin)).toBe("🃏 Blackjack - Doble Derrota");
        expect(descripcion(fin)).toMatch(/Mano 1:.*Se pasó/);
        expect(descripcion(fin)).toMatch(/Mano 2:.*Perdiste/);
        expect(saldo(u)).toBe(800);
        expect(db.prepare("SELECT resultado FROM casino WHERE userId = ? AND juego = 'blackjack' ORDER BY rowid").all(u)).toEqual([
            { resultado: -100 },
            { resultado: -100 },
        ]);
    });

    test("plantarse en una mano avisa de que queda la siguiente, y la última cierra la partida", async () => {
        const u = jugador(1000);
        conBaraja([8, 8, 10, 8, 10, 11]); // mano 1: 8+10 = 18 · mano 2: 8+11 = 19 · crupier 18
        await empezar(u);
        await pulsar(u, "bj_split");
        const primera = await pulsar(u, "bj_stand_split");
        expect(titulo(primera)).toBe("🃏 Blackjack - Mano 2 (Separada)");
        expect(descripcion(primera)).toMatch(/Plantado/);

        const fin = await pulsar(u, "bj_stand_split");
        expect(titulo(fin)).toBe("🃏 Blackjack - Victoria y Empate");
        expect(saldo(u)).toBe(1100); // 800 + 100 (empate) + 200 (gana la mano de 19)
    });

    test("las dos manos ganan y el crupier se pasa de 21: se cuenta como victoria con el aviso", async () => {
        const u = jugador(1000);
        conBaraja([8, 8, 10, 6, 10, 10, 10]); // manos 18 y 18 · crupier 16 → 26
        await empezar(u);
        await pulsar(u, "bj_split");
        await pulsar(u, "bj_stand_split");
        const fin = await pulsar(u, "bj_stand_split");
        expect(titulo(fin)).toBe("🃏 Blackjack - ¡Doble Victoria!");
        expect(descripcion(fin)).toMatch(/\(crupier se pasó\)/);
        expect(ultima(fin).embeds[0].data.footer.text).toBe("Split completado");
        expect(saldo(u)).toBe(1200);
    });

    test("dos ases: solo sale una carta a cada mano, un blackjack cobra 2,5 veces y se muestran las estadísticas", async () => {
        const u = jugador(1000);
        conBaraja([11, 11, 10, 8, 10, 9]); // manos A+10 (blackjack) y A+9 · crupier 18
        const i = await empezar(u);
        expect(i.respuestas).toHaveLength(1);
        const fin = await pulsar(u, "bj_split");
        expect(titulo(fin)).toBe("🃏 Blackjack - ¡Doble Victoria!");
        expect(ultima(fin).embeds[0].data.footer.text).toBe("Split de Ases completado");
        expect(descripcion(fin)).toMatch(/Mano 1:.*🎯 Blackjack/);
        expect(descripcion(fin)).toMatch(/Ganancia neta:\*\* \+250 monedas/);
        expect(saldo(u)).toBe(1250);
        expect(campo(fin, "🎮 Partidas")).toBe("2");
        expect(campo(fin, "📊 Ratio victoria")).toBe("100.0%");
        expect(campo(fin, "💎 Mejor ganancia")).toBe("150");
    });

    test("si no se puede registrar el resultado de una mano, avisa y cierra la partida", async () => {
        const u = jugador(1000);
        conBaraja([8, 8, 10, 9, 2, 10, 5, 10]); // la mano 1 se pasa y pierde
        await empezar(u);
        await pulsar(u, "bj_split");
        await pulsar(u, "bj_hit_split");
        await pulsar(u, "bj_hit_split");
        cas.procesarPerdida.mockReturnValueOnce(false);
        const fin = await pulsar(u, "bj_stand_split");
        expect(ultima(fin).content).toMatch(/Error procesando resultado de mano 1/);
        expect(ultima(fin).components).toEqual([]);

        conBaraja([10, 7, 10, 8]);
        const otra = await empezar(u);
        expect(titulo(otra)).toBe("🃏 Blackjack");
    });

    test("las acciones de split fuera de una partida dividida avisan", async () => {
        const u = jugador(1000);
        conBaraja([10, 7, 10, 8]);
        await empezar(u);
        const hit = await pulsar(u, "bj_hit_split");
        expect(ultima(hit).content).toMatch(/No estás en modo split/);
        const stand = await pulsar(u, "bj_stand_split");
        expect(ultima(stand).content).toMatch(/No estás en modo split/);
    });

    test("si no se puede cobrar la segunda apuesta, no se separa", async () => {
        const u = jugador(1000);
        conBaraja([8, 8, 10, 8]);
        await empezar(u);
        cobros.cobrarExtraBJ.mockReturnValueOnce({ exito: false, mensaje: "❌ No te llega el efectivo para eso." });
        const i = await pulsar(u, "bj_split");
        expect(ultima(i).content).toMatch(/No te llega el efectivo para eso/);
        expect(i.update).not.toHaveBeenCalled();
    });
});

describe("partidas en curso y abandonadas", () => {
    test("no se puede empezar otra partida mientras la actual sigue en curso", async () => {
        const u = jugador(1000);
        conBaraja([10, 9, 10, 7]);
        await empezar(u);
        const otra = await empezar(u);
        expect(ultima(otra).content).toMatch(/Ya tienes una partida de Blackjack en curso/);
        expect(saldo(u)).toBe(900);
    });

    test("una partida sin tocar más de 15 minutos se liquida como perdida y se puede empezar otra", async () => {
        const u = jugador(1000);
        const primera = conBaraja([10, 9, 10, 7]);
        await empezar(u);
        primera.state.ultimaAccion = Date.now() - 16 * 60 * 1000;

        conBaraja([10, 9, 10, 7]);
        const nueva = await empezar(u);
        expect(titulo(nueva)).toBe("🃏 Blackjack");
        expect(ultimaBJ(u)).toMatchObject({ resultado: -100 });
        expect(JSON.parse(ultimaBJ(u).detalle)).toMatchObject({ tipo: "abandono" });
        expect(saldo(u)).toBe(800);
    });

    test("limpiar las partidas abandonadas solo liquida las que llevan más de 15 minutos sin tocar", async () => {
        const abandonada = jugador(1000);
        const viva = jugador(1000);
        const h1 = conBaraja([10, 9, 10, 7]);
        await empezar(abandonada);
        h1.state.ultimaAccion = Date.now() - 20 * 60 * 1000;
        conBaraja([10, 9, 10, 7]);
        await empezar(viva);

        blackjack.limpiarAbandonadas();
        expect(JSON.parse(ultimaBJ(abandonada).detalle)).toMatchObject({ tipo: "abandono" });
        expect(saldo(abandonada)).toBe(900);
        expect(cuantasBJ(viva)).toBe(0);

        const plantarse = await pulsar(viva, "bj_stand");
        expect(titulo(plantarse)).toBe("🃏 Blackjack - Resultado");
        expect(saldo(viva)).toBe(1100);
    });
});

describe("cobros con error en el bust", () => {
    test("una partida con error al cobrar deja de bloquear al jugador", async () => {
        const u = jugador(1000);
        conBaraja([10, 6, 10, 7, 10]);
        await empezar(u);
        cas.procesarPerdida.mockReturnValueOnce(false);
        await pulsar(u, "bj_hit"); // se pasa, pero no se puede cobrar
        const tarde = await pulsar(u, "bj_stand"); // la partida ya no admite jugadas
        expect(ultima(tarde).content).toMatch(/Esta partida ya terminó/);
        conBaraja([10, 7, 10, 8]);
        const otra = await empezar(u);
        expect(titulo(otra)).toBe("🃏 Blackjack");
    });
});
