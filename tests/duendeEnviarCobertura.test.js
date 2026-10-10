// Envío de la respuesta del Duende (chat/enviar.js): edición segura con troceado a 2000 caracteres, GIF, propuestas con
// botones y respuesta por voz con respaldo de texto. Discord, la voz, Giphy y las propuestas están simulados: no se
// llama a ninguna API real.
jest.mock("../src/services/duende/voz", () => ({ tryVoiceReply: jest.fn() }));
jest.mock("../src/services/giphy", () => ({ getGifForText: jest.fn() }));
jest.mock("../src/paneles/duendeEconomia", () => ({
    mensajePropuesta: jest.fn((p) => ({ embeds: [], components: [], marca: p.tipo })),
}));

const { MessageFlags } = require("discord.js");
const { tryVoiceReply } = require("../src/services/duende/voz");
const { getGifForText } = require("../src/services/giphy");
const { mensajePropuesta } = require("../src/paneles/duendeEconomia");
const enviar = require("../src/services/duende/chat/enviar");

const AVISO = "\n\n(Respuesta truncada por longitud)";

// Interacción de Discord con los métodos que usa el envío. Por defecto, todo sale bien.
function interaccion(extra = {}) {
    return {
        editReply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
        channel: { id: "canal-1", send: jest.fn(async () => {}) },
        ephemeral: false,
        ...extra,
    };
}

let random;
beforeEach(() => {
    jest.clearAllMocks();
    random = jest.spyOn(Math, "random");
});

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.DUENDE_GIF_PROB;
});

describe("safeEditReply", () => {
    test("un texto que cabe se edita tal cual", async () => {
        const i = interaccion();
        expect(await enviar.safeEditReply(i, "hola")).toBe(true);
        expect(i.editReply).toHaveBeenCalledWith({ content: "hola" });
        expect(i.followUp).not.toHaveBeenCalled();
    });

    test("un valor que no es texto se convierte y lo vacío sale como cadena vacía", async () => {
        const i = interaccion();
        await enviar.safeEditReply(i, 42);
        await enviar.safeEditReply(i, null);
        expect(i.editReply.mock.calls.map(([m]) => m.content)).toEqual(["42", ""]);
    });

    test("un texto de más de 2000 caracteres se corta en la respuesta y el resto sale en trozos", async () => {
        const texto = Array.from({ length: 4500 }, (_, n) => String.fromCharCode(97 + (n % 26))).join("");
        const i = interaccion();
        expect(await enviar.safeEditReply(i, texto)).toBe(true);

        const primera = i.editReply.mock.calls[0][0].content;
        expect(primera).toBe(texto.slice(0, 1950) + AVISO);
        expect(primera.length).toBeLessThanOrEqual(2000);

        const trozos = i.followUp.mock.calls.map(([m]) => m.content);
        expect(trozos.every((t) => t.length <= 2000)).toBe(true);
        // Lo que sale en los trozos es exactamente lo que no cupo en la primera respuesta, sin huecos ni repeticiones.
        expect(trozos.join("")).toBe(texto.slice(1950));
    });

    test("en privado, los trozos también salen como efímeros", async () => {
        const i = interaccion({ ephemeral: true });
        await enviar.safeEditReply(i, "x".repeat(2100));
        expect(i.followUp.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
    });

    test("en público los trozos no llevan marca de efímero", async () => {
        const i = interaccion();
        await enviar.safeEditReply(i, "x".repeat(2100));
        expect(i.followUp.mock.calls[0][0].flags).toBeUndefined();
    });

    test("si el trozo final falla, para ahí y la respuesta cuenta como enviada", async () => {
        const i = interaccion();
        i.followUp.mockRejectedValueOnce(new Error("Unknown interaction"));
        const texto = "y".repeat(6000);
        expect(await enviar.safeEditReply(i, texto)).toBe(true);
        expect(i.followUp).toHaveBeenCalledTimes(1);
    });

    test("si editar falla en un texto largo, reenvía lo truncado como seguimiento", async () => {
        const i = interaccion();
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        expect(await enviar.safeEditReply(i, "z".repeat(2100))).toBe(true);
        expect(i.followUp).toHaveBeenCalledTimes(1);
        expect(i.followUp.mock.calls[0][0].content).toBe("z".repeat(1950) + AVISO);
    });

    test("si editar falla y no hay seguimiento posible, devuelve false sin lanzar", async () => {
        const i = interaccion({ followUp: undefined });
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        expect(await enviar.safeEditReply(i, "z".repeat(2100))).toBe(false);
    });

    test("si el reenvío de respaldo también falla, devuelve false", async () => {
        const i = interaccion();
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        i.followUp.mockRejectedValueOnce(new Error("Unknown interaction"));
        expect(await enviar.safeEditReply(i, "z".repeat(2100))).toBe(false);
    });

    test("un texto corto que no se puede editar devuelve false", async () => {
        const i = interaccion();
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        expect(await enviar.safeEditReply(i, "corto")).toBe(false);
        expect(i.followUp).not.toHaveBeenCalled();
    });
});

describe("recortarParaDiscord", () => {
    test("un texto corto sale igual y un valor que no es texto se convierte", () => {
        expect(enviar.recortarParaDiscord("hola")).toBe("hola");
        expect(enviar.recortarParaDiscord(7)).toBe("7");
        expect(enviar.recortarParaDiscord(null)).toBe("");
    });

    test("un texto en el límite exacto del margen no se corta", () => {
        const texto = "a".repeat(1980);
        expect(enviar.recortarParaDiscord(texto)).toBe(texto);
    });

    test("un texto más largo se corta y se marca como truncado", () => {
        const r = enviar.recortarParaDiscord("b".repeat(3000));
        expect(r.startsWith("b".repeat(1980))).toBe(true);
        expect(r.endsWith("(Respuesta truncada por longitud)")).toBe(true);
    });

    // Hallazgo: el margen de 20 caracteres no cuenta el aviso (35 caracteres). Un texto largo sale con 2015
    // caracteres, por encima del límite de 2000 de Discord. Lo usa /escuchar cuando la voz falla: el mensaje
    // con 🗣️ se rechaza. Se deja como test.failing hasta que se corrija.
    test.failing("lo que devuelve recortarParaDiscord cabe en 2000 caracteres (fallo de producto, chat/enviar.js)", () => {
        expect(enviar.recortarParaDiscord("c".repeat(5000)).length).toBeLessThanOrEqual(2000);
    });
});

describe("buscarGifParaRespuesta", () => {
    test("con la probabilidad por defecto (8 %) y un número bajo, busca un GIF con texto y entrada", async () => {
        random.mockReturnValue(0.01);
        getGifForText.mockResolvedValueOnce("https://gif/risa.gif");
        expect(await enviar.buscarGifParaRespuesta("respuesta", "pregunta")).toBe("https://gif/risa.gif");
        expect(getGifForText).toHaveBeenCalledWith("respuesta", "pregunta");
    });

    test("con un número por encima de la probabilidad no busca nada", async () => {
        random.mockReturnValue(0.5);
        expect(await enviar.buscarGifParaRespuesta("respuesta", "pregunta")).toBeNull();
        expect(getGifForText).not.toHaveBeenCalled();
    });

    test("si no encuentra GIF relevante devuelve null", async () => {
        random.mockReturnValue(0.01);
        getGifForText.mockResolvedValueOnce(null);
        expect(await enviar.buscarGifParaRespuesta("respuesta", "")).toBeNull();
    });

    test("si la búsqueda de GIF falla, la respuesta sale igual sin GIF", async () => {
        random.mockReturnValue(0.01);
        getGifForText.mockRejectedValueOnce(new Error("Giphy caído"));
        expect(await enviar.buscarGifParaRespuesta("respuesta", "")).toBeNull();
    });

    test("DUENDE_GIF_PROB cambia la probabilidad", async () => {
        process.env.DUENDE_GIF_PROB = "0.9";
        random.mockReturnValue(0.5);
        getGifForText.mockResolvedValueOnce("https://gif/x.gif");
        expect(await enviar.buscarGifParaRespuesta("r", "")).toBe("https://gif/x.gif");
    });

    test("un DUENDE_GIF_PROB que no es número usa el 8 %", async () => {
        process.env.DUENDE_GIF_PROB = "mucho";
        random.mockReturnValue(0.5);
        expect(await enviar.buscarGifParaRespuesta("r", "")).toBeNull();
        expect(getGifForText).not.toHaveBeenCalled();
    });

    // Hallazgo: DUENDE_GIF_PROB=0 es falsy para «||» y cae al 8 %. Con 0 no debería salir ningún GIF.
    test.failing("DUENDE_GIF_PROB=0 apaga los GIF (fallo de producto, chat/enviar.js)", async () => {
        process.env.DUENDE_GIF_PROB = "0";
        random.mockReturnValue(0.05);
        await enviar.buscarGifParaRespuesta("r", "");
        expect(getGifForText).not.toHaveBeenCalled();
    });
});

describe("enviarRespuestaTexto", () => {
    test("manda el texto y, si hay GIF, lo manda como seguimiento", async () => {
        const i = interaccion();
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: "https://gif/a.gif" });
        expect(i.editReply).toHaveBeenCalledWith({ content: "hola" });
        expect(i.followUp).toHaveBeenCalledWith({ content: "https://gif/a.gif" });
        expect(i.channel.send).not.toHaveBeenCalled();
    });

    test("sin GIF no hay seguimiento", async () => {
        const i = interaccion();
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: null });
        expect(i.followUp).not.toHaveBeenCalled();
    });

    test("si el seguimiento del GIF falla, lo manda al canal", async () => {
        const i = interaccion();
        i.followUp.mockRejectedValueOnce(new Error("Unknown interaction"));
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: "https://gif/b.gif" });
        expect(i.channel.send).toHaveBeenCalledWith("https://gif/b.gif");
    });

    test("si el GIF no sale ni por seguimiento ni por el canal, no lanza", async () => {
        const i = interaccion();
        i.followUp.mockRejectedValueOnce(new Error("x"));
        i.channel.send.mockRejectedValueOnce(new Error("Missing Access"));
        await expect(enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: "https://gif/c.gif" })).resolves.toBeUndefined();
    });

    test("si el texto no sale, avisa con un seguimiento y no manda el GIF", async () => {
        const i = interaccion();
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        await enviar.enviarRespuestaTexto(i, { sendText: "corto", gifUrl: "https://gif/d.gif" });
        expect(i.followUp).toHaveBeenCalledTimes(1);
        expect(i.followUp.mock.calls[0][0].content).toContain("No he podido enviar la respuesta principal");
    });

    test("si tampoco sale el aviso, lo intenta en el canal y, si falla, no lanza", async () => {
        const i = interaccion();
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        i.followUp.mockRejectedValueOnce(new Error("Unknown interaction"));
        await enviar.enviarRespuestaTexto(i, { sendText: "corto", gifUrl: null });
        expect(i.channel.send).toHaveBeenCalledWith(expect.stringContaining("No he podido enviar la respuesta principal"));

        const j = interaccion();
        j.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        j.followUp.mockRejectedValueOnce(new Error("x"));
        j.channel.send.mockRejectedValueOnce(new Error("Missing Access"));
        await expect(enviar.enviarRespuestaTexto(j, { sendText: "corto", gifUrl: null })).resolves.toBeUndefined();
    });

    test("sin seguimiento ni canal donde avisar, no lanza", async () => {
        const i = interaccion({ followUp: undefined, channel: undefined });
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        await expect(enviar.enviarRespuestaTexto(i, { sendText: "corto", gifUrl: null })).resolves.toBeUndefined();
    });

    test("con la respuesta en voz silenciosa no edita ni manda nada por texto", async () => {
        const i = interaccion({ silentTextReply: true });
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: "https://gif/e.gif" });
        expect(i.editReply).not.toHaveBeenCalled();
        expect(i.followUp).not.toHaveBeenCalled();
        expect(i.channel.send).not.toHaveBeenCalled();
    });

    test("cada propuesta sale en su propio mensaje con sus botones", async () => {
        const i = interaccion();
        const propuestas = [{ tipo: "ppt" }, { tipo: "prestamo" }];
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: null, propuestas });
        expect(mensajePropuesta).toHaveBeenCalledTimes(2);
        expect(i.followUp.mock.calls.map(([m]) => m.marca)).toEqual(["ppt", "prestamo"]);
        expect(i.followUp.mock.calls[0][0].flags).toBeUndefined();
    });

    test("las propuestas de una respuesta privada salen efímeras", async () => {
        const i = interaccion({ ephemeral: true });
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: null, propuestas: [{ tipo: "ppt" }] });
        expect(i.followUp.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
    });

    test("una propuesta que no sale no impide las demás", async () => {
        const i = interaccion();
        i.followUp.mockRejectedValueOnce(new Error("Unknown interaction"));
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: null, propuestas: [{ tipo: "ppt" }, { tipo: "reto" }] });
        expect(i.followUp).toHaveBeenCalledTimes(2);
    });

    test("si el texto no salió, no manda propuestas", async () => {
        const i = interaccion();
        i.editReply.mockRejectedValueOnce(new Error("Unknown Message"));
        await enviar.enviarRespuestaTexto(i, { sendText: "corto", gifUrl: null, propuestas: [{ tipo: "ppt" }] });
        expect(mensajePropuesta).not.toHaveBeenCalled();
    });

    test("en voz silenciosa las propuestas sí salen", async () => {
        const i = interaccion({ silentTextReply: true });
        await enviar.enviarRespuestaTexto(i, { sendText: "hola", gifUrl: null, propuestas: [{ tipo: "ppt" }] });
        expect(i.followUp).toHaveBeenCalledTimes(1);
    });
});

describe("responderPorVoz", () => {
    const client = { id: "cliente" };

    test("en voz silenciosa, si la voz sale no escribe nada en el canal", async () => {
        tryVoiceReply.mockResolvedValueOnce(true);
        const i = interaccion({ silentTextReply: true });
        await enviar.responderPorVoz(client, i, "hola", "hola");
        expect(tryVoiceReply).toHaveBeenCalledWith(client, i, "hola");
        expect(i.channel.send).not.toHaveBeenCalled();
    });

    test("en voz silenciosa, si la voz no sale, manda el texto al canal sin menciones masivas", async () => {
        tryVoiceReply.mockResolvedValueOnce(false);
        const i = interaccion({ silentTextReply: true });
        await enviar.responderPorVoz(client, i, "hola", "Hola a todos");
        expect(i.channel.send).toHaveBeenCalledWith({ content: "🗣️ Hola a todos", allowedMentions: { parse: ["users"] } });
    });

    test("en voz silenciosa, si la voz no sale y no hay canal, no pasa nada", async () => {
        tryVoiceReply.mockResolvedValueOnce(false);
        const i = interaccion({ silentTextReply: true, channel: undefined });
        await expect(enviar.responderPorVoz(client, i, "hola", "hola")).resolves.toBeUndefined();
    });

    test("fuera de voz silenciosa lanza la voz sin esperarla y no escribe en el canal", async () => {
        tryVoiceReply.mockResolvedValueOnce(false);
        const i = interaccion();
        await enviar.responderPorVoz(client, i, "hola", "hola");
        expect(tryVoiceReply).toHaveBeenCalledTimes(1);
        expect(i.channel.send).not.toHaveBeenCalled();
    });

    test("si la voz lanza un error, no se propaga", async () => {
        tryVoiceReply.mockImplementationOnce(() => {
            throw new Error("sin conexión de voz");
        });
        const i = interaccion();
        await expect(enviar.responderPorVoz(client, i, "hola", "hola")).resolves.toBeUndefined();
    });

    test("si la voz silenciosa rechaza, el error se registra sin mandar el texto", async () => {
        tryVoiceReply.mockRejectedValueOnce(new Error("TTS roto"));
        const i = interaccion({ silentTextReply: true });
        await expect(enviar.responderPorVoz(client, i, "hola", "hola")).resolves.toBeUndefined();
        expect(i.channel.send).not.toHaveBeenCalled();
    });
});
