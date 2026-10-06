// Mensajes espontáneos del Duende (de vez en cuando, sin que nadie le hable, para animar un
// server parado): los "ganchos" que miran datos reales, y cuándo se decide mandar uno o no.
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
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const espontaneo = require("../src/systems/duende/espontaneo");

const G = "guild-espontaneo";
const texto = (t) => ({ text: t, functionCalls: undefined, candidates: [{ finishReason: "STOP" }] });

function limpiarDatos() {
    db.prepare("DELETE FROM tienda").run();
    db.prepare("DELETE FROM objeto").run();
    db.prepare("DELETE FROM inventario").run();
    db.prepare("DELETE FROM apuestas_partidos").run();
    db.prepare("DELETE FROM apuestas_usuario").run();
    db.prepare("DELETE FROM banco").run();
}

beforeEach(() => {
    mockRespuestas.length = 0;
    limpiarDatos();
});

describe("ganchos (qué hay real para comentar)", () => {
    test("tiendaSinVender: nada si no hay objetos a la venta sin comprar", () => {
        expect(espontaneo.GANCHOS[0]()).toBeNull();
    });

    test("tiendaSinVender: detecta un objeto a la venta que nadie ha comprado nunca", () => {
        const obj = db
            .prepare("INSERT INTO objeto (nombre, descripcion, tipo) VALUES ('Capa', 'Mola', 'coleccionable')")
            .run().lastInsertRowid;
        db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, 300, NULL)").run(obj);
        expect(espontaneo.GANCHOS[0]()).toMatch(/Capa.*300/s);
    });

    test("tiendaSinVender: nada si ese objeto ya lo tiene alguien", () => {
        const obj = db
            .prepare("INSERT INTO objeto (nombre, descripcion, tipo) VALUES ('Capa', 'Mola', 'coleccionable')")
            .run().lastInsertRowid;
        db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, 300, NULL)").run(obj);
        db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES ('u1', ?, ?)").run(obj, new Date().toISOString());
        expect(espontaneo.GANCHOS[0]()).toBeNull();
    });

    test("apuestaConPocaGente: nada si no hay partidos próximos", () => {
        expect(espontaneo.GANCHOS[1]()).toBeNull();
    });

    test("apuestaConPocaGente: detecta un partido próximo con 0 o 1 apostantes", () => {
        db.prepare(
            "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, deporte) VALUES ('m1', 'Betis', 'Sevilla', ?, 'laliga')",
        ).run(new Date(Date.now() + 3600_000).toISOString());
        expect(espontaneo.GANCHOS[1]()).toMatch(/Betis-Sevilla/);
    });

    test("apuestaConPocaGente: nada si ya han apostado varios", () => {
        db.prepare(
            "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, deporte) VALUES ('m1', 'Betis', 'Sevilla', ?, 'laliga')",
        ).run(new Date(Date.now() + 3600_000).toISOString());
        db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('a', 'm1', 'home', 100, 2)").run();
        db.prepare("INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota) VALUES ('b', 'm1', 'away', 100, 2)").run();
        expect(espontaneo.GANCHOS[1]()).toBeNull();
    });

    test("rankingDinero: menciona a quien más dinero tiene", () => {
        dinero.cuenta("rico"); // crea la cuenta con el inicial
        db.prepare("UPDATE banco SET enMano = 50000 WHERE userId = 'rico'").run();
        expect(espontaneo.GANCHOS[2]()).toMatch(/<@rico>/);
    });
});

test("elegirGancho: null si ningún gancho aplica", () => {
    expect(espontaneo.elegirGancho()).toBeNull();
});

test("elegirGancho: devuelve el único que aplica", () => {
    const obj = db.prepare("INSERT INTO objeto (nombre, descripcion, tipo) VALUES ('Capa', 'Mola', 'coleccionable')").run().lastInsertRowid;
    db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, 300, NULL)").run(obj);
    expect(espontaneo.elegirGancho()).toMatch(/Capa/);
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

test("generarMensaje: le pasa a Gemini el dato real y usa la personalidad del canal", async () => {
    let promptVisto = "";
    mockRespuestas.push((params) => {
        promptVisto = params.contents[0].parts.map((p) => p.text).join("\n");
        return texto("Vaya tela, nadie compra nada por aquí.");
    });
    const msg = await espontaneo.generarMensaje("canal-1", "Nadie ha comprado la Capa.");
    expect(msg).toBe("Vaya tela, nadie compra nada por aquí.");
    expect(promptVisto).toMatch(/Nadie ha comprado la Capa\./);
    expect(promptVisto).toMatch(/sin que nadie te haya hablado/);
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
        jest.spyOn(Math, "random").mockReturnValue(0.999); // por encima de cualquier PROB razonable
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

    test("manda el mensaje cuando hay un gancho, toca por probabilidad y el canal está en calma", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0);
        mockRespuestas.push(texto("¡Que alguien compre algo, leñe!"));
        const obj = db
            .prepare("INSERT INTO objeto (nombre, descripcion, tipo) VALUES ('Capa', 'Mola', 'coleccionable')")
            .run().lastInsertRowid;
        db.prepare("INSERT INTO tienda (objetoId, precio, stock) VALUES (?, 300, NULL)").run(obj);
        const send = jest.fn();
        await espontaneo.revisarGuild(null, guild({ send }));
        expect(send).toHaveBeenCalledWith("¡Que alguien compre algo, leñe!");
        Math.random.mockRestore();
    });
});
