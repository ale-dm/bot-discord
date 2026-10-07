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
let mockPcmStreamListeners;
const mockOpusStream = () => {
    const listeners = {};
    return {
        on: jest.fn((ev, cb) => (listeners[ev] = cb)),
        pipe: jest.fn(() => {
            mockPcmStreamListeners = {};
            return { on: jest.fn((ev, cb) => (mockPcmStreamListeners[ev] = cb)) };
        }),
        destroy: jest.fn(),
    };
};
let mockConnectionActual;
let mockAudioPlayerOpts;
jest.mock("@discordjs/voice", () => ({
    joinVoiceChannel: jest.fn(() => mockConnectionActual),
    getVoiceConnection: jest.fn(() => null),
    createAudioPlayer: jest.fn((opts) => {
        mockAudioPlayerOpts = opts;
        return { play: jest.fn(), on: jest.fn() };
    }),
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
    const membersCache = new Map([["u-live", { user: { id: "u-live", username: "ale" }, displayName: "ale" }]]);
    return {
        guildId: G,
        guild: { id: G, name: "Server", members: { me: {}, cache: membersCache } },
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
    mockLiveSession.sendRealtimeInput.mockClear();
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

test("el reproductor no da la conversación por acabada por un hueco de audio entre turnos (maxMissedFrames)", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    // Por defecto son 5 (100ms): letal en una conversación real, donde Gemini puede tardar
    // segundos entre turnos sin mandar audio (visto en producción: hablaba el saludo y luego
    // se quedaba muda para siempre, porque el reproductor destruía el stream de ffmpeg).
    expect(mockAudioPlayerOpts).toMatchObject({ behaviors: { maxMissedFrames: Infinity } });
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

test("el audio del usuario se manda por el campo 'audio', no el genérico 'media' (con VAD manual, Gemini necesita ese campo para casarlo con activityStart/End)", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);

    mockPcmStreamListeners.data(Buffer.from("audio-de-verdad"));

    expect(mockLiveSession.sendRealtimeInput).toHaveBeenCalledWith({
        audio: { data: Buffer.from("audio-de-verdad").toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
});

test("cualquiera del canal puede hablarle, no solo quien pidió /conversación", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", "otro-usuario-cualquiera");
    expect(mockConnectionActual.receiver.subscribe).toHaveBeenCalledWith("otro-usuario-cualquiera", expect.anything());
});

test("mientras alguien tiene el turno abierto, se ignora a quien más intente hablar (no se mezclan dos personas en un turno)", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id); // abre el turno u-live
    mockLiveSession.sendRealtimeInput.mockClear();

    mockConnectionActual.receiver.speaking.emit("start", "otro-usuario-cualquiera");

    expect(mockConnectionActual.receiver.subscribe).not.toHaveBeenCalledWith("otro-usuario-cualquiera", expect.anything());
    expect(mockLiveSession.sendRealtimeInput).not.toHaveBeenCalledWith({ activityStart: {} });

    // Al terminar u-live, el turno queda libre para la siguiente persona que hable.
    mockConnectionActual.receiver.speaking.emit("end", i.user.id);
    mockConnectionActual.receiver.speaking.emit("start", "otro-usuario-cualquiera");
    expect(mockConnectionActual.receiver.subscribe).toHaveBeenCalledWith("otro-usuario-cualquiera", expect.anything());
});

test("desactiva la detección automática de actividad de Gemini: Discord no manda audio durante los silencios", async () => {
    await liveVoz.empezarConversacion(interaccionEnVoz());
    const { config } = mockConnect.mock.calls.at(-1)[0];
    expect(config.realtimeInputConfig).toEqual({ automaticActivityDetection: { disabled: true } });
});

test("avisa a Gemini del inicio y fin del turno con las señales de 'hablando' de Discord", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);

    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    expect(mockLiveSession.sendRealtimeInput).toHaveBeenCalledWith({ activityStart: {} });

    mockConnectionActual.receiver.speaking.emit("end", i.user.id);
    expect(mockLiveSession.sendRealtimeInput).toHaveBeenCalledWith({ activityEnd: {} });
});

test("descarta el audio que llega después del activityEnd (Gemini corta la sesión si se le escapa alguno)", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    mockConnectionActual.receiver.speaking.emit("end", i.user.id);
    mockLiveSession.sendRealtimeInput.mockClear();

    // Un trozo "atrasado" del decoder de Opus, llegado con el stream ya "parado" según Discord.
    mockPcmStreamListeners.data(Buffer.from("audio-atrasado"));

    expect(mockLiveSession.sendRealtimeInput).not.toHaveBeenCalledWith(expect.objectContaining({ audio: expect.anything() }));
});

test("el aviso de inicio/fin de turno se manda cada vez que habla, no solo la primera (a diferencia de la suscripción de audio)", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);

    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    mockConnectionActual.receiver.speaking.emit("end", i.user.id);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);

    const avisosInicio = mockLiveSession.sendRealtimeInput.mock.calls.filter(([arg]) => "activityStart" in arg);
    expect(avisosInicio).toHaveLength(2);
    expect(mockConnectionActual.receiver.subscribe).toHaveBeenCalledTimes(1);
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

test("las declaraciones de herramientas incluyen las básicas siempre, y colgar_llamada (solo tiene sentido en la llamada)", () => {
    const declaraciones = liveVoz.construirDeclaracionesHerramientas(G, "canal-texto");
    expect(declaraciones.some((d) => d.name === "consultar_saldo")).toBe(true);
    expect(declaraciones.some((d) => d.name === "colgar_llamada")).toBe(true);
});

test("las instrucciones de sistema recuerdan usar las herramientas sea cual sea la personalidad", () => {
    const instrucciones = liveVoz.construirInstruccionesSistema("canal-texto");
    expect(instrucciones).toMatch(/úsalas siempre/);
    expect(instrucciones).toMatch(/conversación de voz en directo/);
});

test("las instrucciones de sistema avisan de que puede hablar más de una persona y dicen cómo preguntar por otra", () => {
    const instrucciones = liveVoz.construirInstruccionesSistema("canal-texto");
    expect(instrucciones).toMatch(/más de una persona/);
    expect(instrucciones).toMatch(/consultar_perfil_persona/);
});

test("al empezar a hablar alguien, se le identifica a Gemini antes de su turno (como el chat de texto)", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockLiveSession.sendClientContent.mockClear();

    mockConnectionActual.receiver.speaking.emit("start", i.user.id);

    expect(mockLiveSession.sendClientContent).toHaveBeenCalledWith(
        expect.objectContaining({ turns: expect.stringContaining("ale"), turnComplete: false }),
    );
});

test("si Gemini pide colgar_llamada, termina la conversación y responde ok", async () => {
    const i = interaccionEnVoz();
    const onTerminada = jest.fn();
    await liveVoz.empezarConversacion(i, { onTerminada });
    expect(liveVoz.hayConversacionActiva(G)).toBe(true);

    mockLiveCallbacks.onmessage({ toolCall: { functionCalls: [{ id: "call-x", name: "colgar_llamada", args: {} }] } });

    expect(liveVoz.hayConversacionActiva(G)).toBe(false);
    expect(onTerminada).toHaveBeenCalledWith("pedido por voz");
    expect(mockLiveSession.sendToolResponse).toHaveBeenCalledWith({
        functionResponses: [{ id: "call-x", name: "colgar_llamada", response: { ok: true } }],
    });
});

test("modo 'solo si le llaman' (por defecto): sin decir la palabra de llamada, se ignora la respuesta de Gemini", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    mockLiveCallbacks.onmessage({ serverContent: { inputTranscription: { text: "qué tiempo hace hoy" } } });

    mockLiveCallbacks.onmessage({ data: Buffer.from("respuesta-ignorada").toString("base64") });

    expect(mockFFmpegActual.write).not.toHaveBeenCalledWith(Buffer.from("respuesta-ignorada"));
});

test("modo 'solo si le llaman': en cuanto dice 'duende' en el turno, deja pasar la respuesta", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i);
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    mockLiveCallbacks.onmessage({ serverContent: { inputTranscription: { text: "oye duende, qué tiempo hace" } } });

    mockLiveCallbacks.onmessage({ data: Buffer.from("respuesta-permitida").toString("base64") });

    expect(mockFFmpegActual.write).toHaveBeenCalledWith(Buffer.from("respuesta-permitida"));
});

test("modo 'siempre' (soloSiLeLlaman: false): contesta aunque no se diga 'duende'", async () => {
    const i = interaccionEnVoz();
    await liveVoz.empezarConversacion(i, { soloSiLeLlaman: false });
    mockConnectionActual.receiver.speaking.emit("start", i.user.id);
    mockLiveCallbacks.onmessage({ serverContent: { inputTranscription: { text: "qué tal" } } });

    mockLiveCallbacks.onmessage({ data: Buffer.from("respuesta").toString("base64") });

    expect(mockFFmpegActual.write).toHaveBeenCalledWith(Buffer.from("respuesta"));
});

test("DUENDE_TOOL_EXECUTORS sigue teniendo consultar_saldo (si cambia de nombre, este test avisa)", () => {
    expect(typeof DUENDE_TOOL_EXECUTORS.consultar_saldo).toBe("function");
});
