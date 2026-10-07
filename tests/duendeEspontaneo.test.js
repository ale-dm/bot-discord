// Mensajes espontáneos del Duende (de vez en cuando, sin que nadie le hable, dirigidos a alguien
// que conoce, para animar un server parado): el gancho que elige a esa persona, y cuándo se
// decide mandar un mensaje o no.
process.env.GOOGLE_API_KEY = "clave-de-prueba";

const mockRespuestas = [];
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    generateContentWithTimeout: jest.fn(async (params) => {
        const r = mockRespuestas.shift();
        return typeof r === "function" ? r(params) : r;
    }),
}));

const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const espontaneo = require("../src/systems/duende/espontaneo");

const G = "guild-espontaneo";
const texto = (t) => ({ text: t, functionCalls: undefined, candidates: [{ finishReason: "STOP" }] });

beforeEach(() => {
    mockRespuestas.length = 0;
    db.prepare("DELETE FROM duende_perfiles").run();
});

describe("personaAlAzar (el único gancho)", () => {
    test("nada si no hay ningún perfil", () => {
        expect(espontaneo.GANCHOS[0]()).toBeNull();
    });

    test("nada si el único perfil no tiene Discord ID (viene de un JSON antiguo sin vincular)", () => {
        db.prepare("INSERT INTO duende_perfiles (username, nombre, descripcion, notas) VALUES ('viejo', 'Viejo', 'algo', '[]')").run();
        expect(espontaneo.GANCHOS[0]()).toBeNull();
    });

    test("nada si el único perfil con Discord ID no tiene ni descripción ni notas", () => {
        db.prepare("INSERT INTO duende_perfiles (discord_id, nombre, notas) VALUES ('u1', 'Fulano', '[]')").run();
        expect(espontaneo.GANCHOS[0]()).toBeNull();
    });

    test("elige a quien tiene Discord ID y descripción o notas, con su texto de perfil", () => {
        db.prepare(
            "INSERT INTO duende_perfiles (discord_id, nombre, descripcion, notas) VALUES ('u1', 'Fulano', 'Es muy del Barça', '[]')",
        ).run();
        const gancho = espontaneo.GANCHOS[0]();
        expect(gancho).toEqual({ texto: "Es muy del Barça", discordId: "u1" });
    });
});

test("elegirGancho: null si no hay nadie a quien dirigirse", () => {
    expect(espontaneo.elegirGancho()).toBeNull();
});

test("generarMensaje: usa lo que sabe de la persona y la personalidad del canal, y no pide menciones a Gemini", async () => {
    let promptVisto = "";
    mockRespuestas.push((params) => {
        promptVisto = params.contents[0].parts.map((p) => p.text).join("\n");
        return texto("¡Eh, tú! ¿Sigues sin perder contra el Madrid?");
    });
    const msg = await espontaneo.generarMensaje("canal-1", { texto: "Es muy del Barça", discordId: "u1" });
    expect(msg).toBe("¡Eh, tú! ¿Sigues sin perder contra el Madrid?");
    expect(promptVisto).toMatch(/Es muy del Barça/);
    expect(promptVisto).toMatch(/segunda persona/);
    expect(promptVisto).toMatch(/No pongas\s+menciones ni arrobas/);
});

describe("canalEnCalma", () => {
    const canal = (createdTimestamp) => ({
        id: "c1",
        messages: { fetch: async () => ({ first: () => (createdTimestamp == null ? undefined : { createdTimestamp }) }) },
    });

    test("en calma si no hay ningún mensaje", async () => {
        expect(await espontaneo.canalEnCalma(canal(null))).toBe(true);
    });

    test("en calma si el último mensaje es de hace más de QUIET_MS", async () => {
        expect(await espontaneo.canalEnCalma(canal(Date.now() - espontaneo.QUIET_MS - 1000))).toBe(true);
    });

    test("no está en calma si hay un mensaje reciente", async () => {
        expect(await espontaneo.canalEnCalma(canal(Date.now()))).toBe(false);
    });

    test("si falla la consulta, se trata como no en calma (mejor no molestar)", async () => {
        const roto = { id: "c1", messages: { fetch: async () => Promise.reject(new Error("sin permiso")) } };
        expect(await espontaneo.canalEnCalma(roto)).toBe(false);
    });
});

describe("revisarGuild (toda la decisión junta)", () => {
    function guild(channelFns = {}) {
        return {
            id: G,
            name: "Server",
            channels: {
                fetch: async () =>
                    channelFns.fetch === undefined
                        ? {
                              id: "canal-1",
                              isTextBased: () => true,
                              send: channelFns.send || jest.fn(),
                              messages: { fetch: async () => ({ first: () => undefined }) },
                          }
                        : channelFns.fetch(),
            },
        };
    }

    beforeEach(() => {
        guildSettings.setManySettings(G, { "duende.espontaneo_enabled": 1, "duende.espontaneo_channel_id": "canal-1" });
    });

    test("no hace nada si está desactivado", async () => {
        guildSettings.setSetting(G, "duende.espontaneo_enabled", 0);
        const send = jest.fn();
        await espontaneo.revisarGuild(null, guild({ send }));
        expect(send).not.toHaveBeenCalled();
    });

    test("no hace nada si no hay canal elegido", async () => {
        guildSettings.setSetting(G, "duende.espontaneo_channel_id", "");
        const send = jest.fn();
        await espontaneo.revisarGuild(null, guild({ send }));
        expect(send).not.toHaveBeenCalled();
    });

    test("no hace nada si no toca por probabilidad", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0.999);
        const send = jest.fn();
        await espontaneo.revisarGuild(null, guild({ send }));
        expect(send).not.toHaveBeenCalled();
        Math.random.mockRestore();
    });

    test("no hace nada si el canal no está en calma", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0);
        const send = jest.fn();
        const canalActivo = {
            id: "canal-1",
            isTextBased: () => true,
            send,
            messages: { fetch: async () => ({ first: () => ({ createdTimestamp: Date.now() }) }) },
        };
        await espontaneo.revisarGuild(null, guild({ fetch: () => canalActivo }));
        expect(send).not.toHaveBeenCalled();
        Math.random.mockRestore();
    });

    test("no hace nada si no hay nadie a quien dirigirse", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0);
        const send = jest.fn();
        await espontaneo.revisarGuild(null, guild({ send }));
        expect(send).not.toHaveBeenCalled();
        Math.random.mockRestore();
    });

    test("manda el mensaje mencionando a la persona cuando todo encaja", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0);
        db.prepare(
            "INSERT INTO duende_perfiles (discord_id, nombre, descripcion, notas) VALUES ('u1', 'Fulano', 'Es muy del Barça', '[]')",
        ).run();
        mockRespuestas.push(texto("¡Eh, Fulano! ¿Dónde te has metido?"));
        const send = jest.fn();
        await espontaneo.revisarGuild(null, guild({ send }));
        expect(send).toHaveBeenCalledWith("<@u1> ¡Eh, Fulano! ¿Dónde te has metido?");
        Math.random.mockRestore();
    });
});
