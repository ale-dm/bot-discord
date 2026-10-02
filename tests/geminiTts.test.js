// Voz del bot con Gemini TTS: modelos nuevos por la Interactions API, el antiguo por generateContent, reintento si
// responde sin audio (lo que pasaba en producción con gemini-2.5-flash-preview-tts: finishReason OTHER) y paso al
// siguiente modelo. Y que el WAV que sale se puede reproducir en Discord (ffmpeg → Opus), si hay ffmpeg.
process.env.GOOGLE_API_KEY = "clave-de-prueba"; // la clave por defecto se lee al cargar el módulo
const tts = require("../src/services/geminiTts");
const { textoParaVoz } = require("../src/services/duende/voz");

const KEY = { apiKey: "clave-de-prueba" };
// 0,2 s de un tono de 440 Hz en PCM 16 bits mono.
const pcmTono = (rate = 24000, segundos = 0.2) => {
    const n = Math.round(rate * segundos);
    const b = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
    return b;
};
const respuesta = (status, json) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
const interaccionConAudio = (buffer, mime = "audio/wav") => ({
    id: "int-1",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "audio", mime_type: mime, data: buffer.toString("base64") }] }],
});
const generateContentConAudio = (buffer) => ({
    candidates: [
        {
            finishReason: "STOP",
            content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: buffer.toString("base64") } }] },
        },
    ],
});
const sinAudio = { candidates: [{ finishReason: "OTHER", content: {} }] };

let llamadas;
function simular(...respuestas) {
    llamadas = [];
    global.fetch = jest.fn(async (url, opts) => {
        const body = JSON.parse(opts.body);
        llamadas.push({ url, body, modelo: body.model || /models\/([^:]+)/.exec(url)?.[1] });
        const r = respuestas.shift();
        if (!r) throw new Error("sin más respuestas simuladas");
        return typeof r === "function" ? r(url, body) : r;
    });
}
beforeEach(() => tts.__test.reiniciar());

describe("síntesis", () => {
    test("por defecto, gemini-3.8-flash-tts por la Interactions API, con el texto tal cual, y devuelve el WAV", async () => {
        const wav = tts.pcmToWav(pcmTono());
        simular(respuesta(200, interaccionConAudio(wav)));
        const r = await tts.synthesizeSpeech("Hola, pesado.", { ...KEY, voice: "Kore" });
        expect(r.equals(wav)).toBe(true);
        expect(llamadas).toHaveLength(1);
        expect(llamadas[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
        expect(llamadas[0].body).toMatchObject({
            model: "gemini-3.8-flash-tts",
            input: [{ type: "user_input", content: [{ type: "text", text: "Hola, pesado." }] }],
            response_format: { type: "audio" },
            generation_config: { speech_config: [{ voice: "Kore" }] },
        });
        expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("clave-de-prueba");
    });

    test("si llega PCM crudo, se envuelve en un WAV con su frecuencia", async () => {
        const pcm = pcmTono(16000);
        simular(respuesta(200, interaccionConAudio(pcm, "audio/l16;rate=16000")));
        const r = await tts.synthesizeSpeech("Hola", KEY);
        expect(r.toString("ascii", 0, 4)).toBe("RIFF");
        expect(r.readUInt32LE(24)).toBe(16000);
        expect(r.length).toBe(44 + pcm.length);
    });

    test("sin audio (finishReason OTHER) se reintenta, y si sigue sin audio pasa al siguiente modelo; luego empieza por él", async () => {
        const wav = tts.pcmToWav(pcmTono());
        simular(respuesta(200, sinAudio), respuesta(200, sinAudio), respuesta(200, interaccionConAudio(wav)));
        expect((await tts.synthesizeSpeech("Hola", KEY)).equals(wav)).toBe(true);
        expect(llamadas.map((l) => l.modelo)).toEqual(["gemini-3.8-flash-tts", "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);

        simular(respuesta(200, interaccionConAudio(wav)));
        await tts.synthesizeSpeech("Otra", KEY);
        expect(llamadas.map((l) => l.modelo)).toEqual(["gemini-3.8-flash-lite-tts"]);
    });

    test("un modelo que no existe (404) no se reintenta; el 2.5 va por generateContent y devuelve PCM", async () => {
        const pcm = pcmTono();
        simular(
            respuesta(404, { error: { message: "models/gemini-3.8-flash-tts is not found" } }),
            respuesta(404, { error: { message: "not found" } }),
            respuesta(200, generateContentConAudio(pcm)),
        );
        const r = await tts.synthesizeSpeech("Hola", KEY);
        expect(llamadas.map((l) => l.modelo)).toEqual([
            "gemini-3.8-flash-tts",
            "gemini-3.8-flash-lite-tts",
            "gemini-2.5-flash-preview-tts",
        ]);
        expect(llamadas[2].url).toMatch(/models\/gemini-2\.5-flash-preview-tts:generateContent$/);
        expect(llamadas[2].body.generationConfig).toMatchObject({ responseModalities: ["AUDIO"] });
        expect(r.readUInt32LE(24)).toBe(24000);
        expect(r.length).toBe(44 + pcm.length);
    });

    test("con el modelo retirado configurado en el .env, también se prueba el nuevo", async () => {
        const wav = tts.pcmToWav(pcmTono());
        simular(respuesta(200, sinAudio), respuesta(200, sinAudio), respuesta(200, interaccionConAudio(wav)));
        await tts.synthesizeSpeech("Hola", { ...KEY, model: "gemini-2.5-flash-preview-tts" });
        expect(llamadas.map((l) => l.modelo)).toEqual([
            "gemini-2.5-flash-preview-tts",
            "gemini-2.5-flash-preview-tts",
            "gemini-3.8-flash-tts",
        ]);
    });

    test("con la clave mala (401) no se prueba nada más", async () => {
        simular(respuesta(401, { error: { message: "API key not valid" } }));
        await expect(tts.synthesizeSpeech("Hola", KEY)).rejects.toThrow(/no disponible: gemini-3.8-flash-tts: HTTP 401/);
        expect(llamadas).toHaveLength(1);
    });

    test("si ninguno da audio, el error dice qué le pasó a cada uno", async () => {
        simular(...Array.from({ length: 6 }, () => respuesta(200, sinAudio)));
        await expect(tts.synthesizeSpeech("Hola", KEY)).rejects.toThrow(
            /no generó audio \(gemini-3\.8-flash-tts: respuesta sin audio \(fin=OTHER.*gemini-2\.5-flash-preview-tts: respuesta sin audio/,
        );
        expect(llamadas).toHaveLength(6);
    });
});

describe("/paneladmin → 🩺 Sistema → 🔊 Probar voz", () => {
    const { handleSistemaButton } = require("../src/adminPanel/sistema");
    const pulsar = async () => {
        const i = {
            customId: "paneladmin_sis_voz",
            user: { tag: "admin" },
            deferReply: jest.fn(async () => {}),
            editReply: jest.fn(async () => {}),
        };
        expect(await handleSistemaButton(i)).toBe(true);
        return i.editReply.mock.calls[0][0];
    };

    test("dice qué modelo ha funcionado y adjunta el audio para oírlo", async () => {
        const wav = tts.pcmToWav(pcmTono(24000, 1));
        simular(respuesta(200, sinAudio), respuesta(200, sinAudio), respuesta(200, interaccionConAudio(wav)));
        const r = await pulsar();
        expect(r.content).toMatch(/✅ Voz generada con \*\*gemini-3\.8-flash-lite-tts\*\* en [\d.]+ s \(1\.0 s de audio\)/);
        expect(r.files[0]).toMatchObject({ name: "prueba-voz.wav" });
        expect(r.files[0].attachment.equals(wav)).toBe(true);
    });

    test("si no hay voz, explica qué le pasó a cada modelo", async () => {
        simular(...Array.from({ length: 6 }, () => respuesta(200, sinAudio)));
        const r = await pulsar();
        expect(r.content).toMatch(/❌ No se pudo generar la voz .*\n.*gemini-3\.8-flash-tts: respuesta sin audio/);
    });
});

describe("texto para decir en voz alta", () => {
    test("sin menciones, emojis del servidor, enlaces ni formato", () => {
        const guild = { members: { cache: new Map([["370221478538379265", { displayName: "Ale" }]]) } };
        expect(textoParaVoz("**Oye** <@370221478538379265>, mira <:pepe:123456> https://x.com/a y `esto`", guild)).toBe(
            "Oye Ale, mira y esto",
        );
    });

    test("como mucho 200 caracteres, sin cortar una palabra", () => {
        const t = textoParaVoz("palabra ".repeat(60));
        expect(t.length).toBeLessThanOrEqual(200);
        expect(t.endsWith("palabra")).toBe(true);
    });
});

// El audio que sale del TTS pasa por @discordjs/voice: ffmpeg lo convierte a Opus a 48 kHz (lo que se manda a Discord).
// Si el WAV estuviera mal (cabecera doble, frecuencia equivocada), aquí no saldría ningún paquete.
// Se busca igual que lo hace @discordjs/voice (prism-media): el del sistema o ffmpeg-static.
let hayFfmpeg = true;
try {
    require("prism-media").FFmpeg.getInfo();
} catch {
    hayFfmpeg = false;
}
(hayFfmpeg ? test : test.skip)(
    "el WAV del TTS se convierte en paquetes Opus para Discord",
    async () => {
        const { createAudioResource, StreamType } = require("@discordjs/voice");
        const { Readable } = require("stream");
        const recurso = createAudioResource(Readable.from(tts.pcmToWav(pcmTono(24000, 1))), { inputType: StreamType.Arbitrary });
        const paquetes = await new Promise((resolve, reject) => {
            const lista = [];
            recurso.playStream.on("data", (p) => lista.push(p));
            recurso.playStream.on("end", () => resolve(lista));
            recurso.playStream.on("error", reject);
        });
        // 1 s de audio son 50 paquetes de 20 ms.
        expect(paquetes.length).toBeGreaterThanOrEqual(45);
        expect(paquetes.every((p) => Buffer.isBuffer(p) && p.length > 0)).toBe(true);
    },
    20000,
);
