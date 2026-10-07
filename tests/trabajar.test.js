// /trabajar: cooldown, cantidad base + bonus por nivel, el % de que salga mal, y que no rompa si
// falla la llamada a Gemini para el texto.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.TRABAJAR_COOLDOWN_SEC = "1800";
process.env.TRABAJAR_BASE_MIN = "20";
process.env.TRABAJAR_BASE_MAX = "50";
process.env.TRABAJAR_BONUS_NIVEL = "2";
process.env.TRABAJAR_PROB_FALLO = "0.12";

const mockRespuestas = [];
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(async () => {
        const r = mockRespuestas.shift();
        if (r instanceof Error) throw r;
        return r;
    }),
}));

const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const { trabajar } = require("../src/systems/duende/trabajo");

const G = "guild-trabajar";
const texto = (t) => ({ text: t, functionCalls: undefined, candidates: [{ finishReason: "STOP" }] });

function usuario(id) {
    return { id, username: id };
}

beforeEach(() => {
    mockRespuestas.length = 0;
    db.prepare("DELETE FROM action_limits WHERE guildId = ?").run(G);
    db.prepare("DELETE FROM banco").run();
    db.prepare("DELETE FROM historial").run();
    db.prepare("DELETE FROM xp_users WHERE guildId = ?").run(G);
});

afterEach(() => {
    if (jest.isMockFunction(Math.random)) Math.random.mockRestore();
});

test("si sale bien, da dinero (base + bonus por nivel) y lo apunta en el historial", async () => {
    db.prepare("INSERT INTO xp_users (guildId, userId, xp, nivel, xp_total) VALUES (?, ?, 0, 10, 0)").run(G, "u1");
    jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0); // no falla; cantidad base = BASE_MIN
    mockRespuestas.push(texto("Has currado de reponedor en el Mercadona."));

    const r = await trabajar(G, usuario("u1"), "canal-1");

    expect(r).toMatchObject({ ok: true, exito: true, cantidad: 20 + 10 * 2 }); // 20 base + 10 nivel * 2
    expect(dinero.cuenta("u1").efectivo).toBe(dinero.INICIAL + 40);
    const mov = db.prepare("SELECT cantidad, tipo FROM historial WHERE userId = 'u1'").get();
    expect(mov).toMatchObject({ cantidad: 40, tipo: "trabajo" });
});

test("si sale mal, no da nada y no toca el historial", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0); // 0 < PROB_FALLO: falla
    mockRespuestas.push(texto("Te han echado por llegar tarde."));

    const r = await trabajar(G, usuario("u2"), "canal-1");

    expect(r).toMatchObject({ ok: true, exito: false, cantidad: 0 });
    expect(dinero.cuenta("u2").efectivo).toBe(dinero.INICIAL);
    expect(db.prepare("SELECT 1 FROM historial WHERE userId = 'u2'").get()).toBeUndefined();
});

test("aplica el cooldown: usarlo otra vez enseguida falla", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    mockRespuestas.push(texto("Turno cumplido."));
    const primera = await trabajar(G, usuario("u3"), "canal-1");
    expect(primera.ok).toBe(true);

    const segunda = await trabajar(G, usuario("u3"), "canal-1");
    expect(segunda.ok).toBe(false);
    expect(segunda.reason).toBe("cooldown");
    expect(segunda.retrySeconds).toBeGreaterThan(0);
});

test("el cooldown es por persona: a otra persona no le afecta", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    mockRespuestas.push(texto("a"), texto("b"));
    await trabajar(G, usuario("u4"), "canal-1");
    const otra = await trabajar(G, usuario("u5"), "canal-1");
    expect(otra.ok).toBe(true);
});

test("si Gemini falla, cae a un texto por defecto sin romper", async () => {
    jest.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0);
    mockRespuestas.push(new Error("sin cuota"));

    const r = await trabajar(G, usuario("u6"), "canal-1");

    expect(r.ok).toBe(true);
    expect(r.exito).toBe(true);
    expect(typeof r.texto).toBe("string");
    expect(r.texto.length).toBeGreaterThan(0);
});
