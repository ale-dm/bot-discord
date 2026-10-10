// Piedra, papel o tijera del casino (juegos/casino/ppt) de principio a fin: apuesta, jugada del duende y lo que se
// cobra o se paga. ppt no tiene inyección de azar, así que el duende se fija con Math.random (en el orden en que
// lo usa: primero la jugada, luego la frase). Sin servidor (guildId null) no hay impuesto ni RTP, así que las cuentas
// del saldo son exactas.
const { MessageFlags } = require("discord.js");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const cas = require("../src/systems/casinoTransactions");
// Los espías van antes de cargar ppt: ppt desestructura estas funciones al cargarse.
const pagoFalla = jest.spyOn(cas, "procesarGanancia");
const perdidaFalla = jest.spyOn(cas, "procesarPerdida");
const ppt = require("../src/juegos/casino/ppt");

let n = 0;
let azar = null;
/** Un jugador con exactamente `efectivo` en mano (las cuentas nuevas arrancan con un saldo inicial). */
const jugador = (efectivo = 1000) => {
    const id = `ppt-cob-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
};
const saldo = (id) => dinero.efectivo(id);
/** Fija las siguientes llamadas a Math.random (0 → piedra/primera frase, 0.4 → papel, 0.7 → tijera). */
function azarFijo(...valores) {
    azar = jest.spyOn(Math, "random");
    valores.forEach((v) => azar.mockReturnValueOnce(v));
    return azar;
}
const DUENDE = { piedra: 0.1, papel: 0.4, tijera: 0.7 };

async function jugar(userId, jugada, cantidad) {
    const reply = jest.fn();
    const i = {
        user: { id: userId, username: userId, tag: `${userId}#0` },
        guildId: null,
        options: { getString: () => jugada, getInteger: () => cantidad },
        reply,
    };
    await ppt.run(null, i);
    return reply.mock.calls[0][0];
}
const ultimaPartida = (id) =>
    db.prepare("SELECT resultado, detalle FROM casino WHERE userId = ? AND juego = 'ppt' ORDER BY rowid DESC LIMIT 1").get(id);
const descripcion = (p) => p.embeds[0].data.description;

afterEach(() => {
    azar?.mockRestore();
    azar = null;
});

describe("resultado de cada partida", () => {
    test.each([
        ["piedra", "tijera", "piedra gana a tijera"],
        ["papel", "piedra", "papel gana a piedra"],
        ["tijera", "papel", "tijera gana a papel"],
    ])("victoria: %s contra el duende (%s): %s", async (usuario, duende) => {
        const u = jugador(1000);
        azarFijo(DUENDE[duende], 0);
        const p = await jugar(u, usuario, 100);
        expect(p.embeds[0].data.title).toBe("🎉 ¡Ganaste!");
        expect(descripcion(p)).toMatch(/Ganaste \*\*100\*\* monedas/);
        expect(ultimaPartida(u)).toMatchObject({ resultado: 100 });
        expect(JSON.parse(ultimaPartida(u).detalle)).toMatchObject({ jugadaUsuario: usuario, jugadaDuende: duende });
    });

    test("victoria: cobra la apuesta y paga el doble (saldo 900 → 1100)", async () => {
        const u = jugador(1000);
        azarFijo(DUENDE.tijera, 0);
        const p = await jugar(u, "piedra", 100);
        expect(saldo(u)).toBe(1100);
        expect(descripcion(p)).toMatch(/Saldo actual: \*\*1100\*\*/);
    });

    test("derrota: pierde la apuesta y el saldo baja", async () => {
        const u = jugador(1000);
        azarFijo(DUENDE.papel, 0);
        const p = await jugar(u, "piedra", 100);
        expect(p.embeds[0].data.title).toBe("💀 Perdiste");
        expect(descripcion(p)).toMatch(/Perdiste \*\*100\*\* monedas/);
        expect(saldo(u)).toBe(900);
        expect(ultimaPartida(u).resultado).toBe(-100);
    });

    test("empate: recupera la apuesta, así que el saldo no cambia y el resultado es 0", async () => {
        const u = jugador(1000);
        azarFijo(DUENDE.piedra, 0);
        const p = await jugar(u, "piedra", 100);
        expect(p.embeds[0].data.title).toBe("🤝 Empate");
        expect(descripcion(p)).toMatch(/Recuperas tu apuesta/);
        expect(saldo(u)).toBe(1000);
        expect(ultimaPartida(u).resultado).toBe(0);
    });

    test("el botón de repetir vuelve a pedir la jugada con el mismo importe", async () => {
        const u = jugador(1000);
        azarFijo(DUENDE.piedra, 0);
        const p = await jugar(u, "papel", 100);
        expect(p.components[0].components[0].data.custom_id).toBe("casino_play_ppt_100");
    });
});

describe("apuestas no válidas", () => {
    test("sin saldo para la apuesta, avisa en privado y no juega", async () => {
        const u = jugador(50);
        const p = await jugar(u, "piedra", 100);
        expect(p.content).toMatch(/No te llega el efectivo/);
        expect(p.flags).toBe(MessageFlags.Ephemeral);
        expect(p.embeds).toBeUndefined();
        expect(saldo(u)).toBe(50);
        expect(ultimaPartida(u)).toBeUndefined();
    });

    test("por debajo del mínimo (10) no se juega", async () => {
        const u = jugador(1000);
        const p = await jugar(u, "piedra", 5);
        expect(p.content).toMatch(/La apuesta mínima es de 10 monedas/);
        expect(saldo(u)).toBe(1000);
    });

    test("en el límite: apostar justo el mínimo y todo el saldo sí se puede", async () => {
        const minimo = jugador(1000);
        azarFijo(DUENDE.tijera, 0);
        await jugar(minimo, "piedra", 10);
        expect(saldo(minimo)).toBe(1010);

        const todo = jugador(100);
        azarFijo(DUENDE.papel, 0);
        const p = await jugar(todo, "piedra", 100);
        expect(p.embeds[0].data.title).toBe("💀 Perdiste");
        expect(saldo(todo)).toBe(0);
    });
});

describe("fallos al registrar la partida", () => {
    test("si no se puede pagar la victoria, avisa de error y no muestra resultado", async () => {
        const u = jugador(1000);
        azarFijo(DUENDE.tijera, 0);
        pagoFalla.mockReturnValueOnce(false);
        const p = await jugar(u, "piedra", 100);
        expect(p.content).toMatch(/Hubo un error procesando la partida/);
        expect(p.embeds).toBeUndefined();
    });

    test("si no se puede registrar la derrota, avisa de error y no muestra resultado", async () => {
        const u = jugador(1000);
        azarFijo(DUENDE.papel, 0);
        perdidaFalla.mockReturnValueOnce(false);
        const p = await jugar(u, "piedra", 100);
        expect(p.content).toMatch(/Hubo un error procesando la partida/);
        expect(p.embeds).toBeUndefined();
    });
});
