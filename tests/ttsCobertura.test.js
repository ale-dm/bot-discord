// /tts (comando): el bot lee un texto en el canal de voz de quien lo pide. Cubre las validaciones (estar en un canal,
// permisos), la cola por servidor, la conexión (nueva, reutilizada, la que se reconecta, la que falla), los errores de
// generar el audio y del reproductor, y el cierre de la conexión cuando la cola se vacía.
// @discordjs/voice y Gemini TTS se sustituyen: no hay audio ni red. La cola vive en el módulo, así que cada prueba usa
// su propio servidor para no heredar nada de otra.
const { EventEmitter } = require("events");

const mockVoz = {
    createAudioPlayer: jest.fn(),
    createAudioResource: jest.fn(),
    joinVoiceChannel: jest.fn(),
    getVoiceConnection: jest.fn(),
    entersState: jest.fn(),
    VoiceConnectionStatus: { Ready: "ready", Signalling: "signalling", Destroyed: "destroyed" },
    AudioPlayerStatus: { Idle: "idle", Playing: "playing" },
    StreamType: { Arbitrary: "arbitrary", Raw: "raw" },
};
jest.mock("@discordjs/voice", () => mockVoz);
jest.mock("../src/services/geminiTts", () => ({
    getGeminiTtsAudioStream: jest.fn(),
    GEMINI_TTS_VOICE: "Charon",
}));

const { getGeminiTtsAudioStream } = require("../src/services/geminiTts");
const tts = require("../src/commands/voz/tts");

const EFIMERO = 64;
let n = 0;
const nuevoServidor = () => `g-tts-${++n}`;

class ReproductorFalso extends EventEmitter {
    constructor() {
        super();
        this.play = jest.fn();
        this.stop = jest.fn();
    }
}

function conexion(status = mockVoz.VoiceConnectionStatus.Ready) {
    return {
        state: { status },
        destroy: jest.fn(),
        subscribe: jest.fn(),
    };
}

// Permisos del bot en el canal: por defecto, puede conectar y hablar.
function canal(permisos = { Connect: true, Speak: true }, id = "voz-1") {
    return {
        id,
        name: "Sala",
        permissionsFor: () => ({ has: (p) => permisos[p] !== false }),
        guild: { voiceAdapterCreator: jest.fn(() => ({})) },
    };
}

function interaccion({ guildId = nuevoServidor(), texto = "Hola a todos", voz = null, canalVoz = canal() } = {}) {
    return {
        guildId,
        guild: { id: guildId, members: { me: { id: "bot" } } },
        member: { voice: { channel: canalVoz } },
        user: { id: "ana", username: "ana" },
        options: {
            getString: jest.fn((nombre) => (nombre === "texto" ? texto : nombre === "voz" ? voz : null)),
        },
        reply: jest.fn(async () => {}),
        followUp: jest.fn(async () => ({})),
        editReply: jest.fn(async () => {}),
    };
}

// Deja que todas las promesas pendientes se resuelvan (sin temporizadores, que se controlan aparte).
const esperar = () => new Promise((resolve) => setImmediate(resolve));

// El último reproductor creado por el módulo.
const ultimoReproductor = () => mockVoz.createAudioPlayer.mock.results.at(-1).value;

let conn;

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    mockVoz.createAudioPlayer.mockReset().mockImplementation(() => new ReproductorFalso());
    mockVoz.createAudioResource.mockReset().mockImplementation(() => ({ volume: { setVolume: jest.fn() } }));
    mockVoz.getVoiceConnection.mockReset().mockReturnValue(undefined);
    conn = conexion();
    mockVoz.joinVoiceChannel.mockReset().mockReturnValue(conn);
    mockVoz.entersState.mockReset().mockResolvedValue(conn);
    getGeminiTtsAudioStream.mockReset().mockResolvedValue({ fakeStream: true });
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

describe("definición del comando", () => {
    test("se llama tts, el texto es obligatorio y la voz tiene siete opciones", () => {
        expect(tts.data.name).toBe("tts");
        const json = tts.data.toJSON();
        const texto = json.options.find((o) => o.name === "texto");
        expect(texto.required).toBe(true);
        const voz = json.options.find((o) => o.name === "voz");
        expect(voz.required).toBeFalsy();
        expect(voz.choices.map((c) => c.value)).toEqual(["Puck", "Kore", "Charon", "Fenrir", "Algenib", "Sulafat", "Despina"]);
    });
});

describe("validaciones", () => {
    test("sin estar en un canal de voz no se puede usar, y se dice en privado", async () => {
        const i = interaccion({ canalVoz: null });
        await tts.run({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "❌ Debes estar en un canal de voz para usar TTS.", flags: EFIMERO });
        expect(mockVoz.joinVoiceChannel).not.toHaveBeenCalled();
    });

    test("sin miembro en la interacción también se trata como fuera de canal", async () => {
        const i = interaccion();
        i.member = null;
        await tts.run({}, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Debes estar en un canal de voz/);
    });

    test("sin permiso para conectar, se avisa y no se entra", async () => {
        const i = interaccion({ canalVoz: canal({ Connect: false }) });
        await tts.run({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "❌ No tengo permisos para entrar o hablar en ese canal.", flags: EFIMERO });
        expect(mockVoz.joinVoiceChannel).not.toHaveBeenCalled();
    });

    test("sin permiso para hablar, también se avisa", async () => {
        const i = interaccion({ canalVoz: canal({ Speak: false }) });
        await tts.run({}, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/No tengo permisos/);
    });
});

describe("reproducir", () => {
    test("entra al canal, responde con la voz por defecto y lee el texto con ella", async () => {
        const i = interaccion({ texto: "Buenas tardes" });
        await tts.run({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "🔊 Reproduciendo con voz **Charon**...", flags: EFIMERO });
        expect(mockVoz.joinVoiceChannel).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: "voz-1", guildId: i.guildId, selfDeaf: false }),
        );
        expect(mockVoz.entersState).toHaveBeenCalledWith(conn, "ready", 20_000);
        await esperar();
        expect(getGeminiTtsAudioStream).toHaveBeenCalledWith("Buenas tardes", { voice: "Charon" });
        expect(mockVoz.createAudioResource).toHaveBeenCalledWith({ fakeStream: true }, { inputType: "arbitrary", inlineVolume: true });
        expect(ultimoReproductor().play).toHaveBeenCalledTimes(1);
        expect(conn.subscribe).toHaveBeenCalledWith(ultimoReproductor());
    });

    test("la voz elegida se usa tanto en el mensaje como en la síntesis", async () => {
        const i = interaccion({ voz: "Kore" });
        await tts.run({}, i);
        expect(i.reply.mock.calls[0][0].content).toBe("🔊 Reproduciendo con voz **Kore**...");
        await esperar();
        expect(getGeminiTtsAudioStream).toHaveBeenCalledWith("Hola a todos", { voice: "Kore" });
    });

    test("el volumen del recurso se pone a 1 antes de tocar", async () => {
        const i = interaccion();
        await tts.run({}, i);
        await esperar();
        const recurso = mockVoz.createAudioResource.mock.results[0].value;
        expect(recurso.volume.setVolume).toHaveBeenCalledWith(1.0);
    });

    test("cuando el audio acaba y no hay nada más, la conexión se cierra a los dos segundos", async () => {
        const i = interaccion();
        await tts.run({}, i);
        await esperar();
        ultimoReproductor().emit("idle");
        expect(conn.destroy).not.toHaveBeenCalled();
        jest.advanceTimersByTime(2000);
        expect(conn.destroy).toHaveBeenCalledTimes(1);
    });

    test("si la conexión ya estaba cerrada al querer cerrarla, no pasa nada", async () => {
        conn.destroy.mockImplementation(() => {
            throw new Error("ya destruida");
        });
        const i = interaccion();
        await tts.run({}, i);
        await esperar();
        ultimoReproductor().emit("idle");
        expect(() => jest.advanceTimersByTime(2000)).not.toThrow();
        expect(conn.destroy).toHaveBeenCalled();
    });
});

describe("cola por servidor", () => {
    test("si ya hay algo sonando, la nueva petición se encola y se confirma con su posición", async () => {
        const g = nuevoServidor();
        await tts.run({}, interaccion({ guildId: g, texto: "primero" }));
        await esperar();

        const segunda = interaccion({ guildId: g, texto: "segundo" });
        await tts.run({}, segunda);
        expect(segunda.reply).toHaveBeenCalledWith({ content: "🔁 Añadido a la cola (posición 1) — voz: **Charon**", flags: EFIMERO });
        expect(getGeminiTtsAudioStream).toHaveBeenCalledTimes(1);

        // Cuando acaba el primero, empieza el segundo sin volver a conectar.
        ultimoReproductor().emit("idle");
        await esperar();
        expect(getGeminiTtsAudioStream).toHaveBeenLastCalledWith("segundo", { voice: "Charon" });
        expect(mockVoz.joinVoiceChannel).toHaveBeenCalledTimes(1);
    });

    test("un error del reproductor pasa al siguiente de la cola", async () => {
        const g = nuevoServidor();
        await tts.run({}, interaccion({ guildId: g, texto: "uno" }));
        await esperar();
        await tts.run({}, interaccion({ guildId: g, texto: "dos" }));

        ultimoReproductor().emit("error", new Error("reproductor atascado"));
        await esperar();
        expect(getGeminiTtsAudioStream).toHaveBeenLastCalledWith("dos", { voice: "Charon" });
    });

    test("si la síntesis de un mensaje falla, se avisa a quien lo pidió y la cola sigue", async () => {
        const g = nuevoServidor();
        getGeminiTtsAudioStream.mockRejectedValueOnce(new Error("Gemini TTS no generó audio"));
        const primera = interaccion({ guildId: g, texto: "mudo" });
        await tts.run({}, primera);
        await esperar();

        expect(primera.followUp).toHaveBeenCalledWith({
            content: "❌ No he podido generar el audio ahora mismo. Prueba otra vez en un rato.",
            flags: EFIMERO,
        });
        // Sin nada más en la cola, la conexión se cierra.
        jest.advanceTimersByTime(2000);
        expect(conn.destroy).toHaveBeenCalled();
    });

    test("si tampoco se puede avisar del fallo, no se rompe y la cola sigue", async () => {
        const g = nuevoServidor();
        getGeminiTtsAudioStream.mockRejectedValueOnce(new Error("sin audio"));
        const primera = interaccion({ guildId: g, texto: "mudo" });
        primera.followUp.mockRejectedValue(new Error("Unknown interaction"));
        await tts.run({}, primera);
        await esperar();
        expect(primera.followUp).toHaveBeenCalledTimes(1);
        expect(() => jest.advanceTimersByTime(2000)).not.toThrow();
    });

    test("un mensaje que falla no impide leer el siguiente", async () => {
        const g = nuevoServidor();
        getGeminiTtsAudioStream.mockRejectedValueOnce(new Error("sin audio"));
        await tts.run({}, interaccion({ guildId: g, texto: "primero" }));
        await esperar();
        // El primero ha fallado y la cola está vacía; el siguiente entra como nuevo.
        await tts.run({}, interaccion({ guildId: g, texto: "segundo" }));
        await esperar();
        expect(getGeminiTtsAudioStream).toHaveBeenLastCalledWith("segundo", { voice: "Charon" });
    });
});

describe("conexión de voz", () => {
    test("si ya hay una conexión lista en el servidor, se reutiliza sin volver a entrar", async () => {
        const g = nuevoServidor();
        const lista = conexion(mockVoz.VoiceConnectionStatus.Ready);
        mockVoz.getVoiceConnection.mockReturnValue(lista);
        await tts.run({}, interaccion({ guildId: g }));
        await esperar();
        expect(mockVoz.joinVoiceChannel).not.toHaveBeenCalled();
        expect(mockVoz.entersState).not.toHaveBeenCalled();
        expect(lista.subscribe).toHaveBeenCalledWith(ultimoReproductor());
    });

    test("una conexión que quedó a medias se destruye y se vuelve a conectar", async () => {
        const g = nuevoServidor();
        const colgada = conexion(mockVoz.VoiceConnectionStatus.Signalling);
        mockVoz.getVoiceConnection.mockReturnValue(colgada);
        await tts.run({}, interaccion({ guildId: g }));
        await esperar();
        expect(colgada.destroy).toHaveBeenCalledTimes(1);
        expect(mockVoz.joinVoiceChannel).toHaveBeenCalledTimes(1);
        expect(conn.subscribe).toHaveBeenCalled();
    });

    test("si la conexión a medias no se puede destruir, se sigue igual con una nueva", async () => {
        const g = nuevoServidor();
        const colgada = conexion(mockVoz.VoiceConnectionStatus.Signalling);
        colgada.destroy.mockImplementation(() => {
            throw new Error("ya estaba muerta");
        });
        mockVoz.getVoiceConnection.mockReturnValue(colgada);
        await tts.run({}, interaccion({ guildId: g }));
        await esperar();
        expect(mockVoz.joinVoiceChannel).toHaveBeenCalledTimes(1);
        expect(getGeminiTtsAudioStream).toHaveBeenCalledTimes(1);
    });

    test("si no se llega a conectar, se avisa, se limpia la cola y el siguiente intento empieza de cero", async () => {
        const g = nuevoServidor();
        mockVoz.entersState.mockRejectedValueOnce(new Error("timeout de voz"));
        const i = interaccion({ guildId: g, texto: "no entro" });
        await tts.run({}, i);
        expect(conn.destroy).toHaveBeenCalledTimes(1);
        expect(i.editReply).toHaveBeenCalledWith({ content: "❌ No pude conectarme al canal de voz." });
        expect(getGeminiTtsAudioStream).not.toHaveBeenCalled();

        // Otro intento en el mismo servidor no se queda en «ya hay cola»: vuelve a conectar.
        await tts.run({}, interaccion({ guildId: g, texto: "ahora sí" }));
        await esperar();
        expect(mockVoz.joinVoiceChannel).toHaveBeenCalledTimes(2);
        expect(getGeminiTtsAudioStream).toHaveBeenCalledWith("ahora sí", { voice: "Charon" });
    });

    test("si al fallar la conexión tampoco se puede destruir la conexión a medias, se avisa igual", async () => {
        const g = nuevoServidor();
        conn.destroy.mockImplementation(() => {
            throw new Error("destruida");
        });
        mockVoz.entersState.mockRejectedValueOnce(new Error("timeout"));
        const i = interaccion({ guildId: g });
        await tts.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith({ content: "❌ No pude conectarme al canal de voz." });
    });

    test("si ni siquiera se puede crear la conexión, se avisa igual", async () => {
        const g = nuevoServidor();
        mockVoz.joinVoiceChannel.mockImplementationOnce(() => {
            throw new Error("adaptador roto");
        });
        const i = interaccion({ guildId: g });
        await tts.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith({ content: "❌ No pude conectarme al canal de voz." });
    });
});
