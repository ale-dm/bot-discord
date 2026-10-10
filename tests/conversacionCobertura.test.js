// /conversación (comando): empezar o terminar la conversación de voz en directo, las opciones (modo, con, tertulia),
// los mensajes de vuelta y el aviso cuando termina sola. El servicio liveVoz se queda con sus funciones reales, pero
// se espían las que tocan Discord y Gemini, así que aquí no se conecta nada.
const liveVoz = require("../src/services/duende/liveVoz");
const conversacion = require("../src/commands/voz/conversacion");

const EFIMERO = 64;

let hayActiva;
let parar;
let empezar;

beforeEach(() => {
    hayActiva = jest.spyOn(liveVoz, "hayConversacionActiva").mockReturnValue(false);
    parar = jest.spyOn(liveVoz, "pararConversacion").mockReturnValue(true);
    empezar = jest.spyOn(liveVoz, "empezarConversacion").mockResolvedValue({ ok: true, voiceChannel: { name: "General" } });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function interaccion({
    guildId = "g-conv",
    modo = null,
    con = null,
    tertulia = null,
    canal = { id: "t1", send: jest.fn(async () => {}) },
} = {}) {
    return {
        guildId,
        channelId: "t1",
        channel: canal,
        user: { id: "ana", username: "ana", tag: "ana#0001" },
        options: {
            getString: jest.fn((n) => (n === "modo" ? modo : null)),
            getUser: jest.fn((n) => (n === "con" ? con : null)),
            getBoolean: jest.fn((n) => (n === "tertulia" ? tertulia : null)),
        },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    };
}

describe("definición del comando", () => {
    test("se llama conversación, con las opciones modo, con y tertulia", () => {
        expect(conversacion.data.name).toBe("conversación");
        const nombres = conversacion.data.options.map((o) => o.name);
        expect(nombres).toEqual(["modo", "con", "tertulia"]);
        const modo = conversacion.data.options.find((o) => o.name === "modo").toJSON();
        expect(modo.choices.map((c) => c.value)).toEqual(["mencion", "siempre"]);
    });
});

describe("empezar", () => {
    test("fuera de un servidor no se puede, y se dice en privado", async () => {
        const i = interaccion({ guildId: null });
        await conversacion.run({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Esto solo funciona en un servidor.", flags: EFIMERO });
        expect(empezar).not.toHaveBeenCalled();
    });

    test("por defecto solo contesta si le llaman por su nombre, y lo dice al empezar", async () => {
        const i = interaccion();
        await conversacion.run({}, i);
        expect(i.deferReply).toHaveBeenCalledWith();
        const opciones = empezar.mock.calls[0][1];
        expect(opciones).toMatchObject({ soloSiLeLlaman: true, soloEscuchaA: null, tertulia: false });
        expect(i.editReply.mock.calls[0][0]).toBe(
            "🟢 Conversación en directo empezada en **General**. Solo te contestará si dices «Duende» al hablar. Dile que cuelgue o usa `/conversación` otra vez para terminarla.",
        );
    });

    test("con modo «siempre» contesta a todo", async () => {
        const i = interaccion({ modo: "siempre" });
        await conversacion.run({}, i);
        expect(empezar.mock.calls[0][1].soloSiLeLlaman).toBe(false);
        expect(i.editReply.mock.calls[0][0]).toContain("Te contestará a todo lo que digas.");
        expect(i.editReply.mock.calls[0][0]).not.toContain("«Duende»");
    });

    test("con «con» solo escucha a esa persona, y se nombra en el mensaje", async () => {
        const i = interaccion({ con: { id: "u-2", username: "Bea" } });
        await conversacion.run({}, i);
        expect(empezar.mock.calls[0][1].soloEscuchaA).toBe("u-2");
        expect(i.editReply.mock.calls[0][0]).toContain(" Solo escuchará a **Bea**.");
    });

    test("con tertulia escucha a todo el canal a la vez, y se dice", async () => {
        const i = interaccion({ tertulia: true });
        await conversacion.run({}, i);
        expect(empezar.mock.calls[0][1].tertulia).toBe(true);
        expect(i.editReply.mock.calls[0][0]).toContain(" Escucho a todo el canal a la vez (tertulia).");
    });

    test("si no se puede empezar, se muestra el motivo tal cual", async () => {
        empezar.mockResolvedValue({ ok: false, error: "¡Debes estar en un canal de voz!" });
        const i = interaccion();
        await conversacion.run({}, i);
        expect(i.editReply).toHaveBeenCalledWith("¡Debes estar en un canal de voz!");
    });

    test("al terminar, avisa en el canal de texto desde el que se pidió, con el motivo si lo hay", async () => {
        const i = interaccion();
        await conversacion.run({}, i);
        const onTerminada = empezar.mock.calls[0][1].onTerminada;
        onTerminada("pedido por voz");
        expect(i.channel.send).toHaveBeenCalledWith("🔴 Conversación en directo terminada (pedido por voz).");
    });

    test("al terminar sin motivo, el aviso no lleva paréntesis", async () => {
        const i = interaccion();
        await conversacion.run({}, i);
        empezar.mock.calls[0][1].onTerminada(undefined);
        expect(i.channel.send).toHaveBeenCalledWith("🔴 Conversación en directo terminada.");
    });

    test("si el canal de texto no se puede usar al terminar, no se rompe nada", async () => {
        const i = interaccion({ canal: null });
        await conversacion.run({}, i);
        expect(() => empezar.mock.calls[0][1].onTerminada("x")).not.toThrow();
    });

    test("si el aviso de fin no se puede enviar, se registra y no sale a ningún lado", async () => {
        const i = interaccion();
        i.channel.send.mockRejectedValue(new Error("Missing Access"));
        await conversacion.run({}, i);
        expect(() => empezar.mock.calls[0][1].onTerminada("x")).not.toThrow();
        await new Promise((r) => setImmediate(r));
        expect(i.channel.send).toHaveBeenCalledTimes(1);
    });
});

describe("terminar", () => {
    test("si ya hay una conversación en el servidor, /conversación la termina y lo confirma", async () => {
        hayActiva.mockReturnValue(true);
        const i = interaccion({ guildId: "g-activa" });
        await conversacion.run({}, i);
        expect(parar).toHaveBeenCalledWith("g-activa", "pedido con /conversación");
        expect(empezar).not.toHaveBeenCalled();
        expect(i.reply).toHaveBeenCalledWith("🔴 Conversación en directo terminada.");
        expect(i.deferReply).not.toHaveBeenCalled();
    });
});
