// /robar (comando): las validaciones (servidor, bots, uno mismo), el cooldown y la víctima pobre, y los mensajes de
// éxito y de fallo, con 🔒 Candado y 💣 Trampa de la víctima. Usa la lógica real de systems/robar.js y la BD en
// memoria; Math.random fija si sale bien (< probabilidad) y la cantidad o la multa.
process.env.ROBAR_COOLDOWN_SEC = "7200";
process.env.ROBAR_MIN_VICTIMA = "150";
process.env.ROBAR_PROB_EXITO = "0.65";
process.env.ROBAR_BASE_MIN = "50";
process.env.ROBAR_BASE_MAX = "150";
process.env.ROBAR_BONUS_NIVEL = "2";
process.env.ROBAR_MULTA_MIN = "30";
process.env.ROBAR_MULTA_MAX = "80";

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const { MIN_VICTIMA } = require("../src/systems/robar");
const robarCmd = require("../src/commands/economia/robar");

const G = "g-robar-cmd";
const EFIMERO = 64;
let contador = 0;

beforeEach(() => {
    db.prepare("DELETE FROM robos_cooldown").run();
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Un objeto de la tienda con efecto (🔒 o 💣) comprado y guardado en el inventario de la víctima.
function ponerObjeto(userId, nombre, efecto) {
    dinero.efectivo(userId); // crea la cuenta (y el usuario) si no existía
    const { lastInsertRowid } = db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, efecto) VALUES (?, ?, ?, ?)")
        .run(nombre, "objeto de prueba", "proteccion", efecto);
    db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, lastInsertRowid, new Date().toISOString());
}

const inventarioDe = (userId) => db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ?").get(userId).n;

function interaccion({ ladron = `ladron${++contador}`, victima = null, guildId = G } = {}) {
    const objetivo = victima ?? { id: `victima${++contador}`, username: `Víctima${contador}`, tag: `v${contador}#0001`, bot: false };
    return {
        guildId,
        user: { id: ladron, username: ladron, tag: `${ladron}#0001` },
        options: {
            getUser: jest.fn((nombre, requerido) => {
                if (nombre !== "persona") throw new Error("opción inesperada");
                expect(requerido).toBe(true);
                return objetivo;
            }),
        },
        reply: jest.fn(async () => {}),
        _victima: objetivo,
    };
}

const respuesta = (i) => i.reply.mock.calls[0][0];

describe("definición y validaciones", () => {
    test("el comando es robar y pide la persona obligatoria", () => {
        expect(robarCmd.data.name).toBe("robar");
        const persona = robarCmd.data.options.find((o) => o.name === "persona");
        expect(persona.required).toBe(true);
    });

    test("fuera de un servidor no se puede robar, y se dice en privado", async () => {
        const i = interaccion({ guildId: null });
        await robarCmd.run({}, i);
        expect(respuesta(i)).toEqual({ content: "Esto solo funciona en un servidor.", flags: EFIMERO });
    });

    test("no se puede robar a un bot", async () => {
        const i = interaccion({ victima: { id: "bot1", username: "Bot", tag: "Bot#0", bot: true } });
        await robarCmd.run({}, i);
        expect(respuesta(i)).toEqual({ content: "❌ No puedes robarle a un bot.", flags: EFIMERO });
    });

    test("no se puede robar a uno mismo", async () => {
        const i = interaccion({ ladron: "yo" });
        i._victima = null;
        i.options.getUser = () => ({ id: "yo", username: "yo", tag: "yo#0001", bot: false });
        await robarCmd.run({}, i);
        expect(respuesta(i)).toEqual({ content: "❌ No puedes robarte a ti mismo.", flags: EFIMERO });
    });

    test("no se roba nada a alguien con menos efectivo que el mínimo, y no se gasta el cooldown", async () => {
        const i = interaccion();
        dinero.efectivo(i._victima.id);
        dinero.cobrar(i._victima.id, dinero.efectivo(i._victima.id) - (MIN_VICTIMA - 1));
        await robarCmd.run({}, i);
        expect(respuesta(i).content).toBe(
            `❌ ${i._victima.username} no tiene ni ${MIN_VICTIMA} 🪙 en efectivo: no merece la pena robarle.`,
        );
        expect(respuesta(i).flags).toBe(EFIMERO);
        expect(db.prepare("SELECT COUNT(*) AS n FROM robos_cooldown").get().n).toBe(0);
    });
});

describe("cooldown", () => {
    test("un segundo intento seguido se rechaza con los minutos que faltan", async () => {
        const ladron = "ladron-cd";
        const primera = interaccion({ ladron });
        dinero.pagar(primera._victima.id, 1000);
        jest.spyOn(Math, "random").mockReturnValue(0);
        await robarCmd.run({}, primera);

        const segunda = interaccion({ ladron, victima: primera._victima });
        await robarCmd.run({}, segunda);
        expect(respuesta(segunda).flags).toBe(EFIMERO);
        expect(respuesta(segunda).content).toMatch(/^⏳ Todavía no puedes volver a robar\. Espera (119|120) min más\.$/);
    });
});

describe("resultado del robo", () => {
    test("un robo que sale bien: lo robado sale del efectivo de la víctima y se anuncia en público", async () => {
        const i = interaccion();
        dinero.pagar(i._victima.id, 1000);
        const efectivoVictima = dinero.efectivo(i._victima.id);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0); // éxito, cantidad base mínima (50)
        await robarCmd.run({}, i);
        expect(i.reply.mock.calls[0][0]).toBe(
            `🥷 Le has robado **50** 🪙 a ${i._victima.username}. Dinero negro: lo puedes gastar, pero no meterlo en el banco hasta blanquearlo.`,
        );
        expect(dinero.efectivo(i._victima.id)).toBe(efectivoVictima - 50);
        expect(dinero.negro(i.user.id)).toBe(50);
    });

    test("el importe se escribe con separador de miles en español (a partir de cinco cifras)", async () => {
        const i = interaccion();
        dinero.pagar(i._victima.id, 20000);
        // nivel 5000 del ladrón: 50 base + 5000 * 2 = 10050
        db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 5000, 0)").run(G, i.user.id);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
        await robarCmd.run({}, i);
        expect(respuesta(i)).toContain("**10.050** 🪙");
    });

    test("un robo fallido: se cobra la multa al ladrón y se avisa en público", async () => {
        const i = interaccion();
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // falla, multa mínima (30)
        const antes = dinero.efectivo(i.user.id);
        await robarCmd.run({}, i);
        expect(respuesta(i)).toBe(`🚨 Te han pillado intentando robar a ${i._victima.username}. Pagas una multa de **30** 🪙.`);
        expect(dinero.efectivo(i.user.id)).toBe(antes - 30);
    });

    test("un robo fallido de quien no tiene ni para la multa lo dice sin cobrar", async () => {
        const i = interaccion();
        dinero.cobrar(i.user.id, dinero.efectivo(i.user.id)); // el ladrón se queda sin efectivo
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99);
        await robarCmd.run({}, i);
        expect(respuesta(i)).toBe(`🚨 Te han pillado intentando robar a ${i._victima.username}, pero no tenías ni para la multa.`);
    });
});

describe("objetos de protección de la víctima", () => {
    test("un 🔒 Candado se menciona en el mensaje y se gasta con el intento", async () => {
        const i = interaccion();
        dinero.pagar(i._victima.id, 1000);
        ponerObjeto(i._victima.id, "Candado", "antirrobo:20");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.3).mockReturnValueOnce(0); // 0.3 < 0.45 (65 - 20): sale bien
        await robarCmd.run({}, i);
        expect(respuesta(i)).toMatch(/^🔒 Víctima\d+ tenía \*\*Candado\*\* \(lo ha gastado en tu intento\)\. 🥷 Le has robado \*\*50\*\*/);
        expect(inventarioDe(i._victima.id)).toBe(0);
    });

    test("una 💣 Trampa salta si el robo falla: la multa se multiplica y la trampa se gasta", async () => {
        const i = interaccion();
        ponerObjeto(i._victima.id, "Trampa", "trampa:3");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // falla, multa mínima x3
        const antes = dinero.efectivo(i.user.id);
        await robarCmd.run({}, i);
        expect(respuesta(i)).toBe(
            `💣 ¡Ha saltado su **Trampa**: la multa se multiplica! 🚨 Te han pillado intentando robar a ${i._victima.username}. Pagas una multa de **90** 🪙.`,
        );
        expect(dinero.efectivo(i.user.id)).toBe(antes - 90);
        expect(inventarioDe(i._victima.id)).toBe(0);
    });

    test("la 💣 Trampa no salta si el robo sale bien: sigue en el inventario", async () => {
        const i = interaccion();
        dinero.pagar(i._victima.id, 1000);
        ponerObjeto(i._victima.id, "Trampa", "trampa:3");
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
        await robarCmd.run({}, i);
        expect(respuesta(i)).not.toContain("Trampa");
        expect(inventarioDe(i._victima.id)).toBe(1);
    });

    test("un robo fallido con candado y trampa a la vez menciona los dos, en ese orden", async () => {
        const i = interaccion();
        dinero.pagar(i._victima.id, 1000);
        ponerObjeto(i._victima.id, "Candado", "antirrobo:50");
        ponerObjeto(i._victima.id, "Trampa", "trampa:2");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.9).mockReturnValueOnce(0); // falla incluso con candado
        await robarCmd.run({}, i);
        const texto = respuesta(i);
        expect(texto.indexOf("🔒")).toBeLessThan(texto.indexOf("💣"));
        expect(texto).toContain("**60** 🪙");
        expect(inventarioDe(i._victima.id)).toBe(0);
    });
});
