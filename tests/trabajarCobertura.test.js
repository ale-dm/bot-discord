// /trabajar (comando): solo en servidores, el cooldown de 30 min (mensaje con los minutos que faltan), el resultado
// con o sin suerte, y el texto de respaldo si Gemini no contesta. La lógica real (systems/duende/trabajo.js) corre
// contra la BD en memoria; Gemini se simula en geminiClient.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.TRABAJAR_COOLDOWN_SEC = "1800";
process.env.TRABAJAR_BASE_MIN = "20";
process.env.TRABAJAR_BASE_MAX = "50";
process.env.TRABAJAR_BONUS_NIVEL = "2";
process.env.TRABAJAR_PROB_FALLO = "0.12";

const mockRespuestas = [];
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(async (params) => {
        const r = mockRespuestas.shift();
        if (r instanceof Error) throw r;
        return typeof r === "function" ? r(params) : r;
    }),
}));

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const trabajarCmd = require("../src/commands/economia/trabajar");

const G = "g-trabajar-cmd";
const EFIMERO = 64;
const texto = (t) => ({ text: t, functionCalls: undefined, candidates: [{ finishReason: "STOP" }] });

function interaccion({ guildId = G, id = "u-trab", username = "ana", canal = "canal-1" } = {}) {
    return {
        guildId,
        channelId: canal,
        user: { id, username, tag: `${username}#0001` },
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

beforeEach(() => {
    mockRespuestas.length = 0;
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM impuestos_reglas WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM impuestos_bote WHERE guildId = ?").run(G);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("definición y servidor", () => {
    test("el comando es trabajar, sin opciones", () => {
        expect(trabajarCmd.data.name).toBe("trabajar");
        expect(trabajarCmd.data.options).toHaveLength(0);
    });

    test("fuera de un servidor no trabaja nadie, y se dice en privado", async () => {
        const i = interaccion({ guildId: null });
        await trabajarCmd.run({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Esto solo funciona en un servidor.", flags: EFIMERO });
        expect(i.deferReply).not.toHaveBeenCalled();
    });
});

describe("resultado", () => {
    test("con suerte: paga base + bonus por nivel y el texto de Gemini va con la cantidad", async () => {
        db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 10, 0)").run(G, "u-trab");
        const antes = dinero.efectivo("u-trab");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // no falla; base mínima (20)
        mockRespuestas.push(texto("Has currado de reponedor en el Mercadona."));
        const i = interaccion();
        await trabajarCmd.run({}, i);

        expect(i.deferReply).toHaveBeenCalledWith();
        expect(i.editReply).toHaveBeenCalledWith(
            "Has currado de reponedor en el Mercadona.\n\n💰 Has ganado **40** 🪙.", // 20 base + 10 de nivel * 2
        );
        // Hay un impuesto de ingreso por defecto en cada servidor: se cobra en silencio (solo se ve en Movimientos).
        const impuesto = -db
            .prepare("SELECT COALESCE(SUM(cantidad), 0) AS n FROM historial WHERE userId = 'u-trab' AND tipo = 'impuesto'")
            .get().n;
        expect(impuesto).toBeGreaterThanOrEqual(0);
        expect(dinero.efectivo("u-trab")).toBe(antes + 40 - impuesto);
        expect(i.editReply.mock.calls[0][0]).not.toMatch(/impuesto/i);
    });

    test("cantidades de cuatro cifras se escriben con separador de miles solo a partir de cinco", async () => {
        db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 5000, 0)").run(G, "u-rico");
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // 20 + 5000 * 2 = 10020
        mockRespuestas.push(texto("Un buen día."));
        const i = interaccion({ id: "u-rico" });
        await trabajarCmd.run({}, i);
        expect(i.editReply.mock.calls[0][0]).toContain("**10.020** 🪙");
    });

    test("sin suerte: no se paga nada y el texto de Gemini va tal cual", async () => {
        const antes = dinero.efectivo("u-trab");
        jest.spyOn(Math, "random").mockReturnValueOnce(0); // 0 < 0.12: falla
        mockRespuestas.push(texto("Te han timado con unos billetes falsos."));
        const i = interaccion();
        await trabajarCmd.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith("Te han timado con unos billetes falsos.");
        expect(dinero.efectivo("u-trab")).toBe(antes);
    });

    test("si Gemini falla y hubo suerte, el texto de respaldo dice cuánto se ha ganado", async () => {
        jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0);
        mockRespuestas.push(new Error("Gemini caído"));
        const i = interaccion({ id: "u-caido" });
        await trabajarCmd.run({}, i);
        expect(i.editReply.mock.calls[0][0]).toBe("Has trabajado y ganado 20 monedas.\n\n💰 Has ganado **20** 🪙.");
    });

    test("si Gemini falla y no hubo suerte, el texto de respaldo lo dice", async () => {
        jest.spyOn(Math, "random").mockReturnValueOnce(0);
        mockRespuestas.push(new Error("timeout"));
        const i = interaccion({ id: "u-caido-2" });
        await trabajarCmd.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith("Esta vez no has ganado nada.");
    });

    test("sin nombre de usuario se usa el id en el registro y el texto no se rompe", async () => {
        jest.spyOn(Math, "random").mockReturnValueOnce(0);
        mockRespuestas.push(texto("Nada hoy."));
        const i = interaccion({ id: "sin-nombre" });
        i.user.username = undefined;
        await trabajarCmd.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith("Nada hoy.");
    });
});

describe("cooldown", () => {
    test("una segunda vez seguida se rechaza con los minutos que faltan y no se paga nada", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0.99);
        mockRespuestas.push(texto("Primera vez."));
        await trabajarCmd.run({}, interaccion({ id: "u-cd" }));
        const antes = dinero.efectivo("u-cd");

        const i = interaccion({ id: "u-cd" });
        await trabajarCmd.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith("⏳ Todavía no puedes volver a trabajar. Espera 30 min más.");
        expect(dinero.efectivo("u-cd")).toBe(antes);
    });

    test("el cooldown es por persona: otra persona del mismo servidor puede trabajar", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0.99);
        mockRespuestas.push(texto("Uno."), texto("Dos."));
        await trabajarCmd.run({}, interaccion({ id: "u-a" }));
        const otra = interaccion({ id: "u-b" });
        await trabajarCmd.run({}, otra);
        expect(otra.editReply.mock.calls[0][0]).toMatch(/^Dos\./);
    });
});
