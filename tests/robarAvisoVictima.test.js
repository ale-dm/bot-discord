// #432: /robar avisa a la víctima por DM. Un robo con éxito le dice cuánto le han quitado; un intento fallido solo si saltó su
// candado o su trampa; nunca dice quién ha sido; y con los DM cerrados el comando responde igual.
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
const { textoAvisoVictima } = require("../src/systems/robar");
const robarCmd = require("../src/commands/economia/robar");

const G = "g-robar-aviso";
let contador = 0;

beforeEach(() => {
    db.prepare("DELETE FROM robos_cooldown").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
});
afterEach(() => jest.restoreAllMocks());

function ponerObjeto(userId, nombre, efecto) {
    dinero.efectivo(userId);
    const { lastInsertRowid } = db
        .prepare("INSERT INTO objeto (nombre, descripcion, tipo, efecto) VALUES (?, ?, ?, ?)")
        .run(nombre, "objeto de prueba", "proteccion", efecto);
    db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(userId, lastInsertRowid, new Date().toISOString());
}

/** Una interacción de /robar; la víctima tiene un `send` que guarda los DM (o falla si tiene los DM cerrados). */
function interaccion({ dmCerrados = false } = {}) {
    const n = ++contador;
    const victima = {
        id: `aviso-victima-${n}`,
        username: `Víctima${n}`,
        tag: `v${n}#0001`,
        bot: false,
        send: jest.fn(async () => {
            if (dmCerrados) throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
        }),
    };
    const ladron = `aviso-ladron-${n}`;
    return {
        guildId: G,
        user: { id: ladron, username: ladron, tag: `${ladron}#0001` },
        options: { getUser: () => victima },
        reply: jest.fn(async () => {}),
        victima,
        ladron,
    };
}

describe("el DM de un robo con éxito", () => {
    test("dice la cantidad robada, sin revelar quién ha sido", async () => {
        const i = interaccion();
        dinero.pagar(i.victima.id, 1000);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0); // éxito, 50 monedas
        await robarCmd.run({}, i);

        expect(i.victima.send).toHaveBeenCalledTimes(1);
        const dm = i.victima.send.mock.calls[0][0].content;
        expect(dm).toBe("🥷 Alguien te ha robado **50** 🪙 en efectivo.");
        expect(dm).not.toContain(i.ladron);
        expect(dm).not.toContain(`<@${i.ladron}>`);
    });

    test("si tenía un candado que se gastó y aun así le robaron, se lo cuenta", async () => {
        const i = interaccion();
        dinero.pagar(i.victima.id, 1000);
        ponerObjeto(i.victima.id, "Candado", "antirrobo:20");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.3).mockReturnValueOnce(0);
        await robarCmd.run({}, i);
        expect(i.victima.send.mock.calls[0][0].content).toBe(
            "🥷 Alguien te ha robado **50** 🪙 en efectivo. Tu 🔒 **Candado** se ha gastado en el intento.",
        );
    });
});

describe("el DM de un intento fallido", () => {
    test("con un candado que se gasta, le llega el aviso", async () => {
        const i = interaccion();
        dinero.pagar(i.victima.id, 1000);
        ponerObjeto(i.victima.id, "Candado", "antirrobo:50");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.9).mockReturnValueOnce(0);
        await robarCmd.run({}, i);
        const dm = i.victima.send.mock.calls[0][0].content;
        expect(dm).toBe("🛡️ Alguien ha intentado robarte y le ha salido mal. Tu 🔒 **Candado** se ha gastado en el intento.");
        expect(dm).not.toContain(i.ladron);
    });

    test("con una trampa que salta, le llega el aviso con la multa que ha pagado el ladrón", async () => {
        const i = interaccion();
        ponerObjeto(i.victima.id, "Trampa", "trampa:3");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // multa mínima ×3 = 90
        await robarCmd.run({}, i);
        expect(i.victima.send.mock.calls[0][0].content).toBe(
            "🛡️ Alguien ha intentado robarte y le ha salido mal. Tu 💣 **Trampa** ha saltado: ha pagado una multa de **90** 🪙.",
        );
    });

    test("sin candado ni trampa, la víctima no recibe nada", async () => {
        const i = interaccion();
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0);
        await robarCmd.run({}, i);
        expect(i.victima.send).not.toHaveBeenCalled();
    });

    test("si no se puede robar (cooldown o víctima pobre), tampoco se avisa", async () => {
        const i = interaccion();
        dinero.efectivo(i.victima.id);
        dinero.cobrar(i.victima.id, dinero.efectivo(i.victima.id));
        await robarCmd.run({}, i);
        expect(i.victima.send).not.toHaveBeenCalled();
        expect(textoAvisoVictima({ ok: false, reason: "cooldown" })).toBeNull();
    });
});

describe("DM cerrados", () => {
    test("el comando responde igual y no falla", async () => {
        const i = interaccion({ dmCerrados: true });
        dinero.pagar(i.victima.id, 1000);
        jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
        await expect(robarCmd.run({}, i)).resolves.toBeUndefined();
        expect(i.victima.send).toHaveBeenCalledTimes(1);
        expect(i.reply.mock.calls[0][0]).toContain(`Le has robado **50** 🪙 a ${i.victima.username}`);
    });
});
