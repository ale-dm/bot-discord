// Conversación de voz en directo (/conversación, Gemini Live API): las herramientas que puede
// usar, el límite de una conversación a la vez por servidor, y los dos cortes de coste
// obligatorios (inactividad y tope de duración) — todo sin tocar audio ni sockets reales.
process.env.GOOGLE_API_KEY = "clave-de-prueba";
process.env.DUENDE_LIVE_IDLE_DISCONNECT_MS = "1000";
process.env.DUENDE_LIVE_MAX_DURATION_MS = "5000";

const { EventEmitter } = require("events");
const mockConnection = () => ({
    joinConfig: { channelId: "canal-voz" },
    receiver: { subscribe: jest.fn(() => mockOpusStream()), speaking: new EventEmitter() },
    subscribe: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
});
const mockOpusStream = () => {
    const listeners = {};
    return {
        on: jest.fn((ev, cb) => (listeners[ev] = cb)),
        pipe: jest.fn(() => ({ on: jest.fn((ev, cb) => (listeners[ev] = cb)) })),
        destroy: jest.fn(),
    };
};
let mockConnectionActual;
jest.mock("@discordjs/voice", () => ({
    joinVoiceChannel: jest.fn(() => mockConnectionActual),
    getVoiceConnection: jest.fn(() => null),
    createAudioPlayer: jest.fn(() => ({ play: jest.fn(), on: jest.fn() })),
    createAudioResource: jest.fn(() => ({})),
    entersState: jest.fn(async () => {}),
    VoiceConnectionStatus: { Ready: "ready", Disconnected: "disconnected", Destroyed: "destroyed" },
    StreamType: { Raw: "raw" },
    EndBehaviorType: { Manual: "manual" },
}));
const mockFFmpeg = () => ({ write: jest.fn(), end: jest.fn(), on: jest.fn(), destroy: jest.fn() });
let mockFFmpegActual;
let mockFFmpegArgs;
jest.mock("prism-media", () => ({
    FFmpeg: jest.fn((opts) => {
        mockFFmpegArgs = opts.args;
        mockFFmpegActual = mockFFmpeg();
        return mockFFmpegActual;
    }),
    opus: { Decoder: jest.fn() },
}));

const mockLiveSession = {
    close: jest.fn(),
    sendRealtimeInput: jest.fn(),
    sendToolResponse: jest.fn(),
    sendClientContent: jest.fn(),
};
let mockLiveCallbacks;
const mockConnect = jest.fn(async (opts) => {
    mockLiveCallbacks = opts.callbacks;
    return mockLiveSession;
});
jest.mock("../src/services/geminiClient", () => ({
    ...jest.requireActual("../src/services/geminiClient"),
    getGenAI: () => ({ live: { connect: mockConnect } }),
}));

const liveVoz = require("../src/services/duende/liveVoz");
const { DUENDE_TOOL_EXECUTORS } = require("../src/services/duende/herramientas");

const G = "guild-live";

function interaccionEnVoz() {
    mockConnectionActual = mockConnection();
    return {
        guildId: G,
        guild: { id: G, name: "Server", members: { me: {} } },
        channelId: "canal-texto",
        user: { id: "u-live", username: "ale" },
        member: {
            voice: {
                channel: {
                    id: "canal-voz",
                    name: "General",
                    permissionsFor: () => ({ has: () => true }),
                },
            },
        },
    };
}

beforeEach(() => {
    jest.useFakeTimers();
    mockConnect.mockClear();
    mockLiveSession.sendClientContent.mockClear();
});

afterEach(() => {
    liveVoz.pararConversacion(G);
    jest.useRealTimers();
});

test("sin canal de voz, no empieza", async () => {
    const i = interaccionEnVoz();
    i.member.voice.channel = null;
    const r = await liveVoz.empezarConversacion(i);
    expect(r).toEqual({ ok: false, error: "¡Debes estar en un canal de voz!" });
    expect(mockConnect).not.toHaveBeenCalled();
});

test("solo una conversación a la vez por servidor", async () => {
    const i = interaccionEnVoz();
    const primera = await liveVoz.empezarConversacion(i);
    expect(primera.ok).toBe(true);
    const segunda = await liveVoz.empezarConversacion(interaccionEnVoz());
    expect(segunda).toMatchObject({ ok: false });
    expect(segunda.error).toMatch(/Ya hay una conversación/);
});

test("parar limpia la conexión, la sesión de Gemini y avisa con el motivo", async () => {
    const i = interaccionEnVoz();
    const onTerminada = jest.fn();
    await liveVoz.empezarConversacion(i, { onTerminada });
    expect(liveVoz.hayConversacionActiva(G)).toBe(true);

    const ok = liveVoz.pararConversacion(G, "pedido con /conversación");
    expect(ok).toBe(true);
    expect(liveVoz.hayConversacionActiva(G)).toBe(false);
    expect(mockLiveSession.close).toHaveBeenCalled();
    expect(mockConnectionActual.destroy).toHaveBeenCalled();
    expect(onTerminada).toHaveBeenCalledWith("pedido con /conversación");
});

test("se corta sola tras el tiempo de inactividad configurado", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    expect(liveVoz.hayConversacionActiva(G)).toBe(true);

    jest.advanceTimersByTime(20_000); // pasa de sobra el umbral + el intervalo de comprobación
    expect(liveVoz.hayConversacionActiva(G)).toBe(false);
});

test("se corta sola al llegar al tope de duración, aunque haya actividad", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    // "Actividad" cada 500ms, por debajo del umbral de inactividad (1000ms) para siempre.
    for (let t = 0; t < 10; t++) {
        jest.advanceTimersByTime(500);
        if (!liveVoz.hayConversacionActiva(G)) break;
    }
    expect(liveVoz.hayConversacionActiva(G)).toBe(false);
});

test("los argumentos de ffmpeg no duplican pipe:1 (prism-media ya lo añade solo)", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    expect(mockFFmpegArgs).not.toContain("pipe:1");
    expect(mockFFmpegArgs).toContain("pipe:0"); // la entrada sí la pone este código
});

test("el audio que manda Gemini se escribe en ffmpeg directamente (sin .stdin, que no existe)", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    mockLiveCallbacks.onmessage({ data: Buffer.from("audio-falso").toString("base64") });
    expect(mockFFmpegActual.write).toHaveBeenCalledWith(Buffer.from("audio-falso"));
});

test("al conectar, pide un saludo inicial para confirmar que la salida de audio funciona", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    expect(mockLiveSession.sendClientContent).toHaveBeenCalledWith(expect.objectContaining({ turnComplete: true }));
});

test("no se suscribe al audio del usuario hasta que empieza a hablar (no al conectar)", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    expect(mockConnectionActual.receiver.subscribe).not.toHaveBeenCalled();

    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    expect(mockConnectionActual.receiver.subscribe).toHaveBeenCalledWith(i.user.id, expect.anything());
});

test("si habla otra persona del canal, no se suscribe a su audio", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", "otro-usuario-cualquiera");
    expect(mockConnectionActual.receiver.subscribe).not.toHaveBeenCalled();
});

test("si la persona habla varias veces, solo se suscribe una vez", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    expect(mockConnectionActual.receiver.subscribe).toHaveBeenCalledTimes(1);
});

test("las herramientas que pide Gemini se ejecutan con las de siempre y se responden", async () => {
    const toolContext = { guildId: G, userId: "u-live", guild: { id: G }, channelId: "canal-texto" };
    const toolCall = { functionCalls: [{ id: "call-1", name: "consultar_saldo", args: {} }] };

    await liveVoz.responderLlamadasHerramientas(mockLiveSession, toolCall, toolContext);

    expect(mockLiveSession.sendToolResponse).toHaveBeenCalledTimes(1);
    const { functionResponses } = mockLiveSession.sendToolResponse.mock.calls[0][0];
    expect(functionResponses).toHaveLength(1);
    expect(functionResponses[0]).toMatchObject({ id: "call-1", name: "consultar_saldo" });
    expect(functionResponses[0].response).not.toHaveProperty("error");
});

test("una herramienta desconocida no rompe la respuesta", async () => {
    await liveVoz.responderLlamadasHerramientas(
        mockLiveSession,
        { functionCalls: [{ id: "x", name: "no_existe", args: {} }] },
        { guildId: G, userId: "u-live" },
    );
    const { functionResponses } = mockLiveSession.sendToolResponse.mock.calls.at(-1)[0];
    expect(functionResponses[0].response).toEqual({ error: "Herramienta desconocida." });
});

test("las declaraciones de herramientas incluyen las básicas siempre", () => {
    const declaraciones = liveVoz.construirDeclaracionesHerramientas(G, "canal-texto");
    expect(declaraciones.some((d) => d.name === "consultar_saldo")).toBe(true);
});

test("las instrucciones de sistema recuerdan usar las herramientas sea cual sea la personalidad", () => {
    const instrucciones = liveVoz.construirInstruccionesSistema("canal-texto");
    expect(instrucciones).toMatch(/úsalas siempre/);
    expect(instrucciones).toMatch(/conversación de voz en directo/);
});

test("DUENDE_TOOL_EXECUTORS sigue teniendo consultar_saldo (si cambia de nombre, este test avisa)", () => {
    expect(typeof DUENDE_TOOL_EXECUTORS.consultar_saldo).toBe("function");
});
