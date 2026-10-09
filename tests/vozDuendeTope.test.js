// Respuesta por voz del Duende: tope de reproducción y corte de la respuesta anterior (#217). Los reproductores son
// falsos: no hay Discord ni audio real.

// Tiempos cortos para que el test vaya en tiempo real; la salida por inactividad se dispara casi al momento.
process.env.DUENDE_VOICE_PLAYBACK_MAX_MS = "60";
process.env.DUENDE_VOICE_IDLE_DISCONNECT_MS = "10";

const mockReproductores = [];
let mockTerminaSola = false;

jest.mock("@discordjs/voice", () => ({
    joinVoiceChannel: jest.fn(),
    getVoiceConnection: jest.fn(() => undefined),
    createAudioPlayer: jest.fn(() => {
        const p = new (require("events").EventEmitter)();
        p.play = jest.fn(() => {
            if (mockTerminaSola) setImmediate(() => p.emit("idle"));
        });
        // Como el reproductor de verdad: al parar, pasa a idle.
        p.stop = jest.fn(() => {
            setImmediate(() => p.emit("idle"));
        });
        mockReproductores.push(p);
        return p;
    }),
    createAudioResource: jest.fn(() => ({ volume: { setVolume() {} } })),
    entersState: jest.fn(async () => {}),
    VoiceConnectionStatus: { Ready: "ready", Destroyed: "destroyed", Disconnected: "disconnected" },
    StreamType: { Arbitrary: "arbitrary" },
}));
jest.mock("../src/services/geminiTts", () => ({
    getGeminiTtsAudioStream: jest.fn(async () => ({})),
    GEMINI_TTS_VOICE: "voz-test",
}));

const voiceMock = require("@discordjs/voice");
const { tryVoiceReply } = require("../src/services/duende/voz");

function conexion() {
    return {
        joinConfig: { channelId: "c1" },
        state: { status: "ready" },
        subscribe: jest.fn(() => ({})),
        destroy: jest.fn(),
        on: jest.fn(),
    };
}

function interaccion() {
    const channel = {
        id: "c1",
        name: "Canal",
        permissionsFor: () => ({ has: () => true, toArray: () => [] }),
    };
    const member = { voice: { channel } };
    const guild = {
        id: "g1",
        name: "Servidor",
        voiceAdapterCreator: () => {},
        members: { me: {}, fetch: async () => member },
    };
    return {
        guildId: "g1",
        guild,
        user: { id: "u1", tag: "usuario#1" },
        forceVoiceReply: true,
    };
}

beforeEach(() => {
    mockReproductores.length = 0;
    mockTerminaSola = false;
    voiceMock.joinVoiceChannel.mockReset();
    voiceMock.joinVoiceChannel.mockImplementation(() => conexion());
    voiceMock.getVoiceConnection.mockReset();
    voiceMock.getVoiceConnection.mockImplementation(() => undefined);
});

describe("tope de reproducción", () => {
    test("si el audio no acaba ni falla, la respuesta se corta por tiempo y la promesa se resuelve", async () => {
        const ok = await tryVoiceReply({ guilds: {} }, interaccion(), "Hola, qué tal");
        expect(ok).toBe(true);
        expect(mockReproductores).toHaveLength(1);
        expect(mockReproductores[0].stop).toHaveBeenCalledWith(true);
    });

    test("si el audio acaba solo, no se corta", async () => {
        mockTerminaSola = true;
        const ok = await tryVoiceReply({ guilds: {} }, interaccion(), "Hola, qué tal");
        expect(ok).toBe(true);
        expect(mockReproductores[0].stop).not.toHaveBeenCalled();
    });
});

describe("respuestas solapadas en el mismo servidor", () => {
    test("una respuesta nueva corta la que todavía suena, y la anterior también termina", async () => {
        const primera = tryVoiceReply({ guilds: {} }, interaccion(), "Primera respuesta");
        // Esperar a que la primera llegue a reproducir antes de lanzar la segunda.
        await new Promise((r) => setTimeout(r, 5));
        const segunda = tryVoiceReply({ guilds: {} }, interaccion(), "Segunda respuesta");

        const [okPrimera, okSegunda] = await Promise.all([primera, segunda]);
        expect(okPrimera).toBe(true);
        expect(okSegunda).toBe(true);
        expect(mockReproductores).toHaveLength(2);
        expect(mockReproductores[0].stop).toHaveBeenCalledWith(true);
        expect(mockReproductores[1].play).toHaveBeenCalled();
    });
});
