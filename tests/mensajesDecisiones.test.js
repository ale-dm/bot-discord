// Qué pasa con cada mensaje de texto (#240): bots, duplicados, comandos, canal permitido, mensajes de bajo esfuerzo y
// cuándo contesta el Duende. El cliente es falso: se captura el manejador de «messageCreate» y se le pasan mensajes.
const guildSettings = require("../src/systems/guildSettings");
const xpSystem = require("../src/systems/xpSystem");
const duendeCommand = require("../src/commands/duende/duende");
const { registrarMensajes } = require("../src/core/mensajes");

jest.mock("../src/commands/duende/duende", () => ({ hablar: jest.fn(async () => {}) }));
jest.mock("../src/systems/duende/recuerdosAuto", () => ({ observar: jest.fn() }));

const G = "g-mensajes-decisiones";
let n = 0;

function cliente() {
    let manejador = null;
    return {
        user: { id: "bot-id" },
        on: (evento, fn) => {
            if (evento === "messageCreate") manejador = fn;
        },
        emitir: (mensaje) => manejador(mensaje),
    };
}

function mensaje({ contenido = "hola", bot = false, id = `msg-${++n}`, mencion = false, canal = `canal-${++n}` } = {}) {
    const react = jest.fn(async () => {});
    return {
        id,
        content: contenido,
        channelId: canal,
        guildId: G,
        guild: { id: G },
        member: { id: "u1" },
        author: { id: "u1", bot, tag: "usuario#1" },
        attachments: new Map(),
        mentions: { has: (x) => mencion && x === "bot-id" },
        channel: { id: canal, sendTyping: jest.fn(async () => {}), send: jest.fn(async () => {}) },
        react,
    };
}

let c;
beforeEach(() => {
    jest.clearAllMocks();
    c = cliente();
    registrarMensajes(c);
    jest.spyOn(xpSystem, "handleMessageXp").mockResolvedValue();
    guildSettings.setSetting(G, "duende.allowed_channel_id", "");
    jest.spyOn(Math, "random").mockReturnValue(0); // siempre contesta, salvo que se pida otra cosa
});
afterEach(() => {
    jest.restoreAllMocks();
});

describe("qué mensajes se miran", () => {
    test("un bot no se atiende", async () => {
        await c.emitir(mensaje({ bot: true, contenido: "duende, hola" }));
        expect(duendeCommand.hablar).not.toHaveBeenCalled();
        expect(xpSystem.handleMessageXp).not.toHaveBeenCalled();
    });

    test("un mensaje repetido (mismo id) se ignora la segunda vez", async () => {
        const id = `repetido-${++n}`;
        await c.emitir(mensaje({ id, mencion: true }));
        await c.emitir(mensaje({ id, mencion: true }));
        expect(duendeCommand.hablar).toHaveBeenCalledTimes(1);
    });

    test("un comando (empieza por /) no lo contesta el Duende", async () => {
        await c.emitir(mensaje({ contenido: "/perfil", mencion: true }));
        expect(duendeCommand.hablar).not.toHaveBeenCalled();
    });

    test("un mensaje vacío sin imagen no se atiende", async () => {
        await c.emitir(mensaje({ contenido: "   ", mencion: true }));
        expect(duendeCommand.hablar).not.toHaveBeenCalled();
    });
});

describe("cuándo contesta el Duende", () => {
    test("si le hablan por su nombre o con una mención, contesta aunque la probabilidad sea baja", async () => {
        Math.random.mockReturnValue(0.99);
        await c.emitir(mensaje({ contenido: "oye duende, ¿qué tal?" }));
        expect(duendeCommand.hablar).toHaveBeenCalledTimes(1);
    });

    test("sin llamarle, contesta solo si el azar lo deja", async () => {
        Math.random.mockReturnValue(0.99);
        await c.emitir(mensaje({ contenido: "qué buen día hace" }));
        expect(duendeCommand.hablar).not.toHaveBeenCalled();
    });

    test("en un canal permitido, solo contesta en ese canal", async () => {
        guildSettings.setSetting(G, "duende.allowed_channel_id", "canal-permitido");
        await c.emitir(mensaje({ contenido: "duende, hola", canal: "otro-canal" }));
        expect(duendeCommand.hablar).not.toHaveBeenCalled();
        await c.emitir(mensaje({ contenido: "duende, hola", canal: "canal-permitido" }));
        expect(duendeCommand.hablar).toHaveBeenCalledTimes(1);
    });

    test("un mensaje de bajo esfuerzo solo recibe una reacción, sin respuesta", async () => {
        const m = mensaje({ contenido: "jajaja", mencion: true });
        await c.emitir(m);
        expect(m.react).toHaveBeenCalledTimes(1);
        expect(duendeCommand.hablar).not.toHaveBeenCalled();
    });

    test("la XP se da a cada mensaje, contesten o no", async () => {
        Math.random.mockReturnValue(0.99);
        await c.emitir(mensaje({ contenido: "qué buen día hace" }));
        expect(xpSystem.handleMessageXp).toHaveBeenCalledTimes(1);
    });
});
