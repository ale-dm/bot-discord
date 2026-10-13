// 🎰 Tirada automática de la tragaperras (#354): la serie de tiradas (con sus cortes) y los botones del mensaje. La serie usa el
// cobro y el reparto reales del casino sobre la BD en memoria; solo el azar y las esperas se simulan.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const casinoTx = require("../src/systems/casinoTransactions");
const autoexclusion = require("../src/systems/casinoAutoexclusion");
const sistema = require("../src/systems/casino/tragaperras");
const tragaperras = require("../src/juegos/casino/tragaperras");

const G = "g-tragaperras-auto";
const EFIMERO = 64;
let n = 0;
function jugador(efectivo = 10000) {
    const id = `tp-auto-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const saldo = (id) => dinero.efectivo(id);
const filasTP = (id) =>
    db.prepare("SELECT apuesta, resultado FROM casino WHERE userId = ? AND juego = 'tragaperras' ORDER BY rowid").all(id);

beforeEach(() => {
    guildSettings.setManySettings(G, { "casino.global_cooldown_sec": 0, "casino.daily_limit": 0, "casino.max_bet": 100000 });
    db.prepare("DELETE FROM slots_jackpot").run();
    db.prepare("INSERT INTO slots_jackpot (id, cantidad) VALUES (1, 10000)").run();
});
afterEach(() => jest.restoreAllMocks());

const sinPausa = { pausa: async () => {} };

describe("la serie de tiradas", () => {
    test("hace exactamente las tiradas pedidas, cobra cada una y suma lo ganado", async () => {
        const u = jugador();
        const antes = saldo(u);
        const r = await sistema.jugarSerie({ userId: u, guildId: null, username: "ana", apuesta: 50, tiradas: 10 }, sinPausa);
        expect(r).toMatchObject({ tiradas: 10, hechas: 10, apuesta: 50, apostado: 500, parada: false, motivo: null });
        expect(filasTP(u)).toHaveLength(10);
        expect(r.neto).toBe(r.ganado - r.apostado);
        // Sin servidor no hay impuesto: el efectivo cambia justo en el neto (el bote aparte, si salió el jackpot, ya está en `ganado`).
        expect(saldo(u)).toBe(antes + r.neto);
        expect(r.aciertos).toBeLessThanOrEqual(10);
    });

    test("cada tirada pasa por el cobro normal, y si un cobro falla la serie se corta y dice por qué", async () => {
        const u = jugador(120); // alcanza para dos tiradas de 50
        const r = await sistema.jugarSerie({ userId: u, guildId: null, username: "ana", apuesta: 50, tiradas: 25 }, sinPausa);
        expect(r.hechas).toBeGreaterThanOrEqual(2);
        expect(r.hechas).toBeLessThan(25);
        expect(r.motivo).toMatch(/No te llega el efectivo/);
        expect(r.apostado).toBe(r.hechas * 50);
    });

    test("respeta el cooldown global: con espera entre jugadas, la segunda tirada ya no se hace", async () => {
        guildSettings.setSetting(G, "casino.global_cooldown_sec", 30);
        const u = jugador();
        const r = await sistema.jugarSerie({ userId: u, guildId: G, username: "ana", apuesta: 50, tiradas: 10 }, sinPausa);
        expect(r.hechas).toBe(1);
        expect(r.motivo).toBeTruthy();
    });

    test("respeta el cupo diario del casino", async () => {
        guildSettings.setSetting(G, "casino.daily_limit", 3);
        const u = jugador();
        const r = await sistema.jugarSerie({ userId: u, guildId: G, username: "ana", apuesta: 50, tiradas: 10 }, sinPausa);
        expect(r.hechas).toBe(3);
        expect(r.motivo).toBeTruthy();
    });

    test("respeta la autoexclusión: no hace ninguna tirada", async () => {
        const u = jugador();
        expect(autoexclusion.activar(u, "dia").ok).toBe(true);
        const r = await sistema.jugarSerie({ userId: u, guildId: null, username: "ana", apuesta: 50, tiradas: 10 }, sinPausa);
        expect(r.hechas).toBe(0);
        expect(r.motivo).toBeTruthy();
        expect(filasTP(u)).toHaveLength(0);
    });

    test("si sale el jackpot, la serie se detiene y el premio se acredita una sola vez", async () => {
        const girar = jest
            .fn()
            .mockReturnValueOnce({ resultado: { tipo: "perdida", ganancia: 0 }, nuevoJackpot: 10005 })
            .mockReturnValueOnce({ resultado: { tipo: "jackpot", ganancia: 10005 }, nuevoJackpot: 10000 });
        const r = await sistema.jugarSerie(
            { userId: "x", guildId: null, username: "ana", apuesta: 50, tiradas: 10 },
            { ...sinPausa, descontar: () => ({ exito: true }), girar },
        );
        expect(girar).toHaveBeenCalledTimes(2);
        expect(r).toMatchObject({ hechas: 2, jackpot: true, ganado: 10005, apostado: 100, neto: 9905, mejor: 9955, nuevoJackpot: 10000 });
    });

    test("se puede parar: no se hacen más tiradas y no es un fallo", async () => {
        let hechas = 0;
        const r = await sistema.jugarSerie(
            { userId: "x", guildId: null, username: "ana", apuesta: 10, tiradas: 25 },
            {
                ...sinPausa,
                descontar: () => ({ exito: true }),
                girar: () => {
                    hechas++;
                    return { resultado: { tipo: "perdida", ganancia: 0 }, nuevoJackpot: 1 };
                },
                debeParar: () => hechas >= 3,
            },
        );
        expect(r).toMatchObject({ hechas: 3, parada: true, motivo: null });
    });

    test("cuenta los aciertos (más que la apuesta), la mejor ganancia y avisa del progreso", async () => {
        const ganancias = [0, 50, 100, 0, 300];
        let i = 0;
        const progreso = [];
        const r = await sistema.jugarSerie(
            { userId: "x", guildId: null, username: "ana", apuesta: 50, tiradas: 5 },
            {
                ...sinPausa,
                descontar: () => ({ exito: true }),
                girar: () => ({ resultado: { tipo: "doble", ganancia: ganancias[i++] }, nuevoJackpot: 1 }),
                alProgreso: (resumen) => progreso.push(resumen.hechas),
            },
        );
        expect(r).toMatchObject({ hechas: 5, aciertos: 2, mejor: 250, ganado: 450, apostado: 250, neto: 200 });
        expect(progreso).toEqual([1, 2, 3, 4, 5]);
    });

    test("pausa entre tiradas, pero no tras la última", async () => {
        const pausa = jest.fn(async () => {});
        await sistema.jugarSerie(
            { userId: "x", guildId: null, username: "ana", apuesta: 10, tiradas: 4 },
            { pausa, descontar: () => ({ exito: true }), girar: () => ({ resultado: { tipo: "perdida", ganancia: 0 }, nuevoJackpot: 1 }) },
        );
        expect(pausa).toHaveBeenCalledTimes(3);
        expect(pausa).toHaveBeenCalledWith(sistema.PAUSA_AUTO_MS);
    });
});

describe("el mensaje y sus botones", () => {
    const interaccion = (customId, userId, extra = {}) => ({
        customId,
        guildId: null,
        user: { id: userId, username: "ana", tag: "ana#1" },
        values: [],
        reply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        ...extra,
    });
    const embeds = (i) => i.editReply.mock.calls.map((c) => c[0]);
    const ultimo = (i) => embeds(i).at(-1);

    beforeEach(() => {
        jest.spyOn(global, "setTimeout").mockImplementation((fn) => {
            fn();
            return 0;
        });
    });

    test("el resultado de una tirada lleva el desplegable «Auto x10 / x25 / x50»", async () => {
        const u = jugador();
        const i = interaccion("", u, { options: { getInteger: () => 50 }, deferReply: jest.fn(async () => {}) });
        await tragaperras.run(null, i);
        const filas = ultimo(i).components;
        expect(filas).toHaveLength(2);
        const menu = filas[1].components[0];
        expect(menu.data.custom_id).toBe("tragaperras_auto_50");
        expect(menu.options.map((o) => [o.data.label, o.data.value])).toEqual([
            ["🔁 Auto x10", "10"],
            ["🔁 Auto x25", "25"],
            ["🔁 Auto x50", "50"],
        ]);
    });

    test("la tirada automática hace las tiradas pedidas y deja un solo resumen con el neto", async () => {
        const u = jugador();
        const i = interaccion("tragaperras_auto_50", u, { values: ["10"] });
        await tragaperras.handleButton(null, i);
        expect(i.deferUpdate).toHaveBeenCalled();
        expect(filasTP(u)).toHaveLength(10);
        const final = ultimo(i);
        expect(final.embeds[0].data.title).toBe("🎰 Tirada automática - Resumen");
        expect(final.embeds[0].data.description).toMatch(/\*\*Tiradas:\*\* 10 de 10 \(50 monedas cada una\)/);
        expect(final.embeds[0].data.description).toMatch(/\*\*Apostado:\*\* 500 monedas/);
        expect(final.embeds[0].data.description).toMatch(/✅ Serie completa|JACKPOT/);
        expect(final.components).toHaveLength(2); // los botones de siempre y el desplegable para otra serie
        expect(final.components[1].components[0].data.custom_id).toBe("tragaperras_auto_50");
    });

    test("mientras dura, el mensaje enseña el progreso con un botón para parar", async () => {
        const u = jugador();
        const i = interaccion("tragaperras_auto_20", u, { values: ["10"] });
        await tragaperras.handleButton(null, i);
        const enCurso = embeds(i).filter((p) => p.embeds[0].data.title === "🎰 Tirada automática en marcha…");
        expect(enCurso.length).toBeGreaterThan(0);
        expect(enCurso[0].components[0].components[0].data.custom_id).toBe("tragaperras_parar");
    });

    test("si la primera tirada no se puede cobrar, avisa en privado y no toca el mensaje", async () => {
        const u = jugador(10);
        const i = interaccion("tragaperras_auto_50", u, { values: ["10"] });
        await tragaperras.handleButton(null, i);
        expect(i.followUp).toHaveBeenCalledWith({ content: expect.stringMatching(/No te llega el efectivo/), flags: EFIMERO });
        expect(i.editReply).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(10);
    });

    test("una serie cortada a mitad dice por qué en el resumen", async () => {
        const u = jugador(120);
        const i = interaccion("tragaperras_auto_50", u, { values: ["25"] });
        await tragaperras.handleButton(null, i);
        expect(ultimo(i).embeds[0].data.description).toMatch(/⚠️ La serie se cortó: .*No te llega el efectivo/);
    });

    test("⏹️ Parar detiene la serie en curso; quien no tiene serie solo recibe el acuse", async () => {
        const pendientes = [];
        jest.spyOn(global, "setTimeout").mockImplementation((fn) => {
            pendientes.push(fn);
            return 0;
        });
        const u = jugador();
        const serie = tragaperras.handleButton(null, interaccion("tragaperras_auto_10", u, { values: ["50"] }));
        for (let k = 0; k < 20 && pendientes.length < 1; k++) await Promise.resolve();
        const parar = interaccion("tragaperras_parar", u);
        await tragaperras.handleButton(null, parar);
        expect(parar.deferUpdate).toHaveBeenCalled();
        while (pendientes.length) {
            pendientes.shift()();
            await new Promise((r) => setImmediate(r));
        }
        await serie;
        expect(filasTP(u).length).toBeLessThan(50);
        const ajena = interaccion("tragaperras_parar", jugador());
        await tragaperras.handleButton(null, ajena);
        expect(ajena.deferUpdate).toHaveBeenCalled();
    });

    test("no se puede lanzar una serie mientras otra tirada está en curso, ni una opción que no existe", async () => {
        const u = jugador();
        const pendientes = [];
        jest.spyOn(global, "setTimeout").mockImplementation((fn) => {
            pendientes.push(fn);
            return 0;
        });
        const primera = tragaperras.handleButton(null, interaccion("tragaperras_auto_10", u, { values: ["10"] }));
        for (let k = 0; k < 20 && pendientes.length < 1; k++) await Promise.resolve();
        const segunda = interaccion("tragaperras_auto_10", u, { values: ["10"] });
        await tragaperras.handleButton(null, segunda);
        expect(segunda.reply).toHaveBeenCalledWith({ content: expect.stringMatching(/Ya estás girando/), flags: EFIMERO });
        while (pendientes.length) {
            pendientes.shift()();
            await new Promise((r) => setImmediate(r));
        }
        await primera;

        const rara = interaccion("tragaperras_auto_10", u, { values: ["7"] });
        await tragaperras.handleButton(null, rara);
        expect(rara.deferUpdate).not.toHaveBeenCalled();
    });

    test("el jackpot corta la serie y el resumen lo dice", async () => {
        const u = jugador();
        jest.spyOn(Math, "random").mockReturnValue(0.99999); // el último símbolo en cada carrete: 7️⃣ 7️⃣ 7️⃣
        const i = interaccion("tragaperras_auto_50", u, { values: ["10"] });
        await tragaperras.handleButton(null, i);
        expect(ultimo(i).embeds[0].data.description).toMatch(/Tiradas:\*\* 1 de 10/);
        expect(ultimo(i).embeds[0].data.description).toMatch(/🏆 ¡JACKPOT!/);
        expect(casinoTx.obtenerSaldo(u)).toBeGreaterThan(10000);
    });
});
