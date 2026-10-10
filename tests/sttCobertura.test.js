// Speech-to-Text (#239): grabar la intervención de una persona, transcribirla con el servidor Vosk y entregar el
// texto al callback. Sin red ni voz de verdad: la conexión de Discord es un EventEmitter, el decodificador de Opus
// es un paso directo y el servidor Vosk responde con axios.post simulado. Los ficheros temporales van a una carpeta
// propia del test (os.tmpdir y LOG_DIR), no a la del proyecto.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const axios = require("axios");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stt-test-"));
process.env.LOG_DIR = path.join(TMP, "logs");

const mockVoice = {
    joinVoiceChannel: jest.fn(),
    getVoiceConnection: jest.fn(() => undefined),
    EndBehaviorType: { AfterSilence: "AfterSilence", Manual: "Manual" },
};
jest.mock("@discordjs/voice", () => mockVoice);
jest.mock("prism-media", () => ({ opus: { Decoder: jest.fn(() => new (require("stream").PassThrough)()) } }));

const { listenAndTranscribe } = require("../src/services/stt");

const CANAL = "canal-voz";
const GUILD = "g-stt";

// Conexión de voz falsa: el receptor emite «start» cuando alguien empieza a hablar.
function conexion() {
    const speaking = new EventEmitter();
    const conn = {
        receiver: {
            speaking,
            _recordingUsers: undefined,
            subscribe: jest.fn(() => new PassThrough()),
        },
    };
    return conn;
}

function clienteCon(miembros = {}) {
    const cache = new Map(Object.entries(miembros));
    const guild = {
        id: GUILD,
        name: "Servidor de prueba",
        voiceAdapterCreator: () => ({}),
        channels: { fetch: jest.fn(async () => ({ id: CANAL, name: "General" })) },
        members: {
            cache,
            fetch: jest.fn(async (id) => {
                if (miembros[id]) return miembros[id];
                throw new Error("Unknown Member");
            }),
        },
    };
    return { guilds: { fetch: jest.fn(async () => guild) }, guild };
}

// Espera a que el callback reciba algo (o a que pase el plazo), y devuelve sus llamadas.
function esperarCallback(callback, plazo = 2000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("el callback no llegó")), plazo);
        callback.mockImplementation((...args) => {
            clearTimeout(t);
            setTimeout(() => resolve(args), 10);
        });
    });
}

// Simula que una persona habla: el stream de Opus se llena con un poco de audio y se cierra.
function hablar(conn, userId) {
    conn.receiver.speaking.emit("start", userId);
    const stream = conn.receiver.subscribe.mock.results.at(-1)?.value;
    if (stream) {
        stream.write(Buffer.alloc(640));
        stream.end();
    }
    return stream;
}

let postSpy;
let conn;

beforeEach(() => {
    jest.spyOn(os, "tmpdir").mockReturnValue(TMP);
    conn = conexion();
    mockVoice.joinVoiceChannel.mockReset().mockReturnValue(conn);
    mockVoice.getVoiceConnection.mockReset().mockReturnValue(undefined);
    postSpy = jest.spyOn(axios, "post").mockResolvedValue({ status: 200, data: { text: "hola duende" } });
    delete process.env.STT_ONLY_USER_ID;
    // Un plazo corto: si nadie habla, el temporizador de escucha no debe mantener vivo a Jest cinco minutos.
    process.env.STT_LISTEN_TIMEOUT_MS = "1000";
});

afterEach(() => {
    delete process.env.STT_LISTEN_TIMEOUT_MS;
    jest.restoreAllMocks();
});

afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
});

describe("transcripción de una intervención", () => {
    test("une al bot al canal, graba a quien habla y entrega el texto con su perfil", async () => {
        const { guilds } = clienteCon({ u1: { user: { id: "u1", tag: "Ana#1" }, displayName: "Ana" } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        const args = await espera;
        expect(mockVoice.joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: CANAL, guildId: GUILD }));
        expect(args[0]).toBe("hola duende");
        expect(args[1].user.tag).toBe("Ana#1");
        expect(args[1].member.displayName).toBe("Ana");
        expect(postSpy).toHaveBeenCalledWith(
            expect.stringContaining("/transcribe"),
            expect.anything(),
            expect.objectContaining({ timeout: 30000 }),
        );
    });

    test("si ya hay conexión de voz en el servidor la reutiliza sin unirse de nuevo", async () => {
        mockVoice.getVoiceConnection.mockReturnValue(conn);
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        await espera;
        expect(mockVoice.joinVoiceChannel).not.toHaveBeenCalled();
    });

    test("un fallo del servidor Vosk entrega null y guarda el audio para revisarlo", async () => {
        postSpy.mockResolvedValue({ status: 500, data: { error: "modelo no cargado" } });
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        const args = await espera;
        expect(args[0]).toBeNull();
        const fallidos = path.join(TMP, "logs", "stt_failed_wavs");
        expect(fs.readdirSync(fallidos).some((f) => f.endsWith(".wav"))).toBe(true);
    });

    test("si el servidor Vosk no está disponible, la transcripción es null sin lanzar", async () => {
        postSpy.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        const args = await espera;
        expect(args[0]).toBeNull();
    });

    test("una respuesta sin texto cuenta como fallo", async () => {
        postSpy.mockResolvedValue({ status: 200, data: {} });
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        const args = await espera;
        expect(args[0]).toBeNull();
    });

    test("si no se puede obtener el miembro, el callback recibe solo el id", async () => {
        const { guilds } = clienteCon({});
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "fantasma", cb);
        hablar(conn, "fantasma");
        const args = await espera;
        expect(args[0]).toBe("hola duende");
        expect(args[1]).toMatchObject({ user: { id: "fantasma" }, member: null });
    });

    test("un error dentro del callback se registra y no rompe el proceso", async () => {
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn(() => {
            throw new Error("fallo del callback");
        });
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        await new Promise((r) => setTimeout(r, 100));
        expect(cb).toHaveBeenCalledTimes(1);
    });

    test("al terminar no quedan temporales en la carpeta", async () => {
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        await espera;
        expect(fs.readdirSync(TMP).filter((f) => f.startsWith("duende_audio_"))).toEqual([]);
    });
});

describe("a quién se escucha", () => {
    test("con STT_ONLY_USER_ID se ignora a cualquier otra persona", async () => {
        process.env.STT_ONLY_USER_ID = "elegido";
        const { guilds } = clienteCon({});
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "otro", jest.fn());
        conn.receiver.speaking.emit("start", "otro");
        expect(conn.receiver.subscribe).not.toHaveBeenCalled();
    });

    test("sin filtro, se ignora a los bots", async () => {
        const { guilds } = clienteCon({ bot1: { user: { id: "bot1", bot: true } } });
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "", jest.fn());
        conn.receiver.speaking.emit("start", "bot1");
        expect(conn.receiver.subscribe).not.toHaveBeenCalled();
    });

    test("una segunda grabación de la misma persona mientras la primera sigue abierta no se duplica", async () => {
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", jest.fn());
        conn.receiver._recordingUsers = { u1: true };
        conn.receiver.speaking.emit("start", "u1");
        expect(conn.receiver.subscribe).not.toHaveBeenCalled();
    });

    test("pasado el plazo sin que hable nadie, deja de escuchar", async () => {
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", jest.fn(), { timeoutMs: 20 });
        await new Promise((r) => setTimeout(r, 60));
        conn.receiver.speaking.emit("start", "u1");
        expect(conn.receiver.subscribe).not.toHaveBeenCalled();
    });

    test("es de un solo uso: tras la primera intervención no vuelve a grabar", async () => {
        const { guilds } = clienteCon({ u1: { user: { id: "u1" } } });
        const cb = jest.fn();
        const espera = esperarCallback(cb);
        await listenAndTranscribe({ guilds }, GUILD, CANAL, "u1", cb);
        hablar(conn, "u1");
        await espera;
        conn.receiver.speaking.emit("start", "u1");
        expect(conn.receiver.subscribe).toHaveBeenCalledTimes(1);
    });
});
