// #463: autoexclusión del casino. Mientras dure, ninguna de las dos puertas por las que sale dinero del casino
// (descontarApuesta y descontarExtra) cobra nada, con un mensaje que dice la fecha de fin; no se puede cambiar antes de que
// acabe; y al acabar el casino vuelve solo. Las fechas son simuladas con Date.now.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const tx = require("../src/systems/casinoTransactions");
const autoexclusion = require("../src/systems/casinoAutoexclusion");
const juegos = require("../src/commands/juegos/juegos");
const ppt = require("../src/juegos/casino/ppt");

const G = "g-autoexclusion";
const T0 = Date.parse("2026-10-14T12:00:00Z");
const DIA = 24 * 3600 * 1000;
let n = 0;
let reloj;

function jugador(efectivo = 1000) {
    const id = `autoex-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const ahoraEs = (ms) => reloj.mockReturnValue(ms);

beforeEach(() => {
    reloj = jest.spyOn(Date, "now").mockReturnValue(T0);
    guildSettings.setSetting(G, "casino.global_cooldown_sec", 0);
    guildSettings.setSetting(G, "casino.daily_limit", 0);
});
afterEach(() => reloj.mockRestore());

describe("activar", () => {
    test("1 día, 1 semana y 1 mes acaban donde toca", () => {
        const u = jugador();
        expect(autoexclusion.activar(u, "dia")).toEqual({ ok: true, hasta: T0 + DIA });
        const v = jugador();
        expect(autoexclusion.activar(v, "semana").hasta).toBe(T0 + 7 * DIA);
        const w = jugador();
        expect(autoexclusion.activar(w, "mes").hasta).toBe(T0 + 30 * DIA);
    });

    test("un periodo que no existe se rechaza sin guardar nada", () => {
        const u = jugador();
        expect(autoexclusion.activar(u, "eterno").ok).toBe(false);
        expect(autoexclusion.hastaDe(u)).toBeNull();
    });

    test("estando autoexcluido no se puede cambiar ni acortar ni alargar, y el mensaje dice la fecha de fin", () => {
        const u = jugador();
        autoexclusion.activar(u, "mes");
        const r = autoexclusion.activar(u, "dia");
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain(`<t:${Math.floor((T0 + 30 * DIA) / 1000)}:F>`);
        expect(autoexclusion.hastaDe(u)).toBe(T0 + 30 * DIA);
    });

    test("al acabar el periodo ya no está autoexcluido y se puede volver a elegir", () => {
        const u = jugador();
        autoexclusion.activar(u, "dia");
        ahoraEs(T0 + DIA - 1);
        expect(autoexclusion.hastaDe(u)).toBe(T0 + DIA);
        ahoraEs(T0 + DIA);
        expect(autoexclusion.hastaDe(u)).toBeNull();
        expect(autoexclusion.mensajeBloqueo(u)).toBeNull();
        expect(autoexclusion.activar(u, "semana").ok).toBe(true);
    });
});

describe("las dos puertas del casino", () => {
    test("descontarApuesta no cobra en ningún juego y dice hasta cuándo, sin gastar cooldown ni cupo", () => {
        guildSettings.setSetting(G, "casino.daily_limit", 1);
        const u = jugador(1000);
        autoexclusion.activar(u, "dia");
        for (const juego of ["blackjack", "tragaperras", "ruleta", "ppt", "adivinar"]) {
            const r = tx.descontarApuesta(u, 100, G, juego);
            expect(r.exito).toBe(false);
            expect(r.mensaje).toContain("autoexcluido");
            expect(r.mensaje).toContain(`<t:${Math.floor((T0 + DIA) / 1000)}:F>`);
        }
        expect(dinero.efectivo(u)).toBe(1000);

        ahoraEs(T0 + DIA + 1000);
        expect(tx.descontarApuesta(u, 100, G, "ruleta").exito).toBe(true); // el cupo de 1 al día seguía entero
        expect(dinero.efectivo(u)).toBe(900);
    });

    test("descontarExtra (doblar o separar en blackjack) tampoco cobra", () => {
        const u = jugador(1000);
        autoexclusion.activar(u, "semana");
        const r = tx.descontarExtra(u, 100, G);
        expect(r.exito).toBe(false);
        expect(r.mensaje).toContain("autoexcluido");
        expect(dinero.efectivo(u)).toBe(1000);
        ahoraEs(T0 + 7 * DIA);
        expect(tx.descontarExtra(u, 100, G).exito).toBe(true);
    });

    test("solo afecta a quien se ha autoexcluido", () => {
        const a = jugador(1000);
        const b = jugador(1000);
        autoexclusion.activar(a, "dia");
        expect(tx.descontarApuesta(b, 100, G, "ruleta").exito).toBe(true);
    });

    test("un juego real (PPT) responde con el aviso y no descuenta nada", async () => {
        const u = jugador(1000);
        autoexclusion.activar(u, "dia");
        const reply = jest.fn();
        await ppt.run(null, {
            user: { id: u, username: u, tag: `${u}#0` },
            guildId: G,
            options: { getString: () => "piedra", getInteger: () => 100 },
            reply,
        });
        expect(reply.mock.calls[0][0].content).toContain("autoexcluido");
        expect(dinero.efectivo(u)).toBe(1000);
    });
});

describe("el panel del casino", () => {
    const boton = (userId, customId) => ({
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: userId, username: userId, tag: userId },
        message: { interaction: { user: { id: userId } } },
        update: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    });
    const ids = (p) => p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));
    const pulsar = async (u, id) => {
        const i = boton(u, id);
        await juegos.handleButton(null, i);
        return i.update.mock.calls[0][0];
    };

    test("el resumen del casino tiene el acceso 🔒 Autoexclusión, que ofrece los tres periodos", async () => {
        const u = jugador();
        expect(ids(await pulsar(u, "casino_home"))).toContain("casino_autoex");
        const pantalla = await pulsar(u, "casino_autoex");
        expect(ids(pantalla)).toEqual(["casino_autoex_dia", "casino_autoex_semana", "casino_autoex_mes", "casino_home"]);
    });

    test("elegir un periodo pide confirmación y no activa nada hasta confirmar", async () => {
        const u = jugador();
        const confirmar = await pulsar(u, "casino_autoex_semana");
        expect(ids(confirmar)).toEqual(["casino_autoex_ok_semana", "casino_autoex"]);
        expect(autoexclusion.hastaDe(u)).toBeNull();

        const hecho = await pulsar(u, "casino_autoex_ok_semana");
        expect(hecho.embeds[0].toJSON().description).toContain(`<t:${Math.floor((T0 + 7 * DIA) / 1000)}:F>`);
        expect(autoexclusion.hastaDe(u)).toBe(T0 + 7 * DIA);
    });

    test("ya autoexcluido, la pantalla enseña la fecha y ningún botón para quitarla; el resumen avisa", async () => {
        const u = jugador();
        autoexclusion.activar(u, "dia");
        const pantalla = await pulsar(u, "casino_autoex");
        expect(ids(pantalla)).toEqual(["casino_home"]);
        expect(pantalla.embeds[0].toJSON().description).toContain("No se puede levantar antes");
        expect((await pulsar(u, "casino_home")).embeds[0].toJSON().description).toContain("autoexcluido");
        // Confirmar de nuevo (mensaje viejo) no cambia nada.
        await pulsar(u, "casino_autoex_ok_mes");
        expect(autoexclusion.hastaDe(u)).toBe(T0 + DIA);
    });

    test("un periodo inventado vuelve a la pantalla de periodos", async () => {
        const u = jugador();
        expect(ids(await pulsar(u, "casino_autoex_eterno"))).toContain("casino_autoex_dia");
    });
});
