// /escuchar (comando): elegir a quién escuchar (uno mismo o alguien del mismo canal), y el bucle de turnos: cada frase
// reconocida va al Duende por voz y se vuelve a escuchar en una ventana corta; un silencio en el primer turno avisa en
// el canal de texto. No hay micro ni Vosk: el STT se sustituye por un callback que se dispara a mano.
jest.mock("../src/services/stt", () => ({ listenAndTranscribe: jest.fn() }));

const stt = require("../src/services/stt");
const duende = require("../src/commands/duende/duende");
const escuchar = require("../src/commands/voz/escuchar");

const CLIENTE = { id: "bot" };
const CANAL_VOZ = { id: "voz-1", name: "Sala" };

function miembro(id, canalId = CANAL_VOZ.id, nombre = id) {
    // "sin-voz": el miembro no tiene estado de voz en absoluto (no está conectado ni en un canal).
    return { id, displayName: nombre, voice: canalId === "sin-voz" ? undefined : { channelId: canalId } };
}

function interaccion({ enCanal = true, usuarioElegido = null, miembros = {}, textoCanal = null } = {}) {
    const yo = { id: "ana", username: "ana", tag: "ana#0001" };
    const tuMiembro = miembro("ana", enCanal ? CANAL_VOZ.id : null);
    const canal = textoCanal ?? { id: "texto-1", isTextBased: () => true, send: jest.fn(async () => {}) };
    return {
        member: { voice: { channel: enCanal ? CANAL_VOZ : null } },
        guildId: "g-escuchar",
        guild: {
            id: "g-escuchar",
            members: {
                fetch: jest.fn(async (id) => {
                    if (id === "ana") return tuMiembro;
                    if (miembros[id] !== undefined) {
                        if (miembros[id] instanceof Error) throw miembros[id];
                        return miembros[id];
                    }
                    throw new Error("Unknown Member");
                }),
            },
        },
        user: yo,
        channel: canal,
        options: { getUser: jest.fn(() => usuarioElegido) },
        reply: jest.fn(async () => {}),
    };
}

const turnos = () => stt.listenAndTranscribe.mock.calls;
const ultimoCallback = () => turnos().at(-1)[4];

let hablar;

beforeEach(() => {
    stt.listenAndTranscribe.mockReset().mockResolvedValue(undefined);
    hablar = jest.spyOn(duende, "hablar").mockResolvedValue(undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("definición y a quién se escucha", () => {
    test("el comando es escuchar y su opción usuario es opcional", () => {
        expect(escuchar.data.name).toBe("escuchar");
        const usuario = escuchar.data.options.find((o) => o.name === "usuario");
        expect(usuario.required).toBeFalsy();
    });

    test("si no estás en un canal de voz, no se escucha a nadie", async () => {
        const i = interaccion({ enCanal: false });
        await escuchar.run(CLIENTE, i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "¡Debes estar en un canal de voz!", flags: 64 }));
        expect(stt.listenAndTranscribe).not.toHaveBeenCalled();
    });

    test("por defecto se escucha a quien lo pide, en su canal, y se confirma en privado", async () => {
        const i = interaccion();
        await escuchar.run(CLIENTE, i);
        expect(i.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: "Escuchando a **ana** en su próxima intervención de voz...", flags: 64 }),
        );
        const [cliente, guildId, canalId, userId, , opciones] = turnos()[0];
        expect(cliente).toBe(CLIENTE);
        expect([guildId, canalId, userId]).toEqual(["g-escuchar", CANAL_VOZ.id, "ana"]);
        expect(opciones).toEqual({ timeoutMs: undefined }); // el primer turno no tiene plazo
    });

    test("con la opción usuario se escucha a esa persona, si está en el mismo canal", async () => {
        const i = interaccion({ usuarioElegido: { id: "bea", username: "bea", tag: "bea#0002" }, miembros: { bea: miembro("bea") } });
        await escuchar.run(CLIENTE, i);
        expect(turnos()[0][3]).toBe("bea");
        expect(i.reply.mock.calls[0][0].content).toBe("Escuchando a **bea** en su próxima intervención de voz...");
    });

    test("si la persona elegida no se puede consultar, se dice que debe estar en tu canal", async () => {
        const i = interaccion({
            usuarioElegido: { id: "cai", username: "cai", tag: "cai#0003" },
            miembros: { cai: new Error("Unknown Member") },
        });
        await escuchar.run(CLIENTE, i);
        expect(i.reply.mock.calls[0][0].content).toBe("Ese usuario debe estar en tu mismo canal de voz para poder escucharlo.");
        expect(stt.listenAndTranscribe).not.toHaveBeenCalled();
    });

    test("si la persona elegida está en otro canal, no se escucha", async () => {
        const i = interaccion({
            usuarioElegido: { id: "dan", username: "dan", tag: "dan#0004" },
            miembros: { dan: miembro("dan", "otro-canal") },
        });
        await escuchar.run(CLIENTE, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/mismo canal de voz/);
        expect(stt.listenAndTranscribe).not.toHaveBeenCalled();
    });

    test("si la persona elegida no tiene estado de voz, no se escucha", async () => {
        const i = interaccion({
            usuarioElegido: { id: "eli", username: "eli", tag: "eli#0005" },
            miembros: { eli: miembro("eli", "sin-voz") },
        });
        await escuchar.run(CLIENTE, i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/mismo canal de voz/);
        expect(stt.listenAndTranscribe).not.toHaveBeenCalled();
    });
});

describe("turnos de conversación", () => {
    test("cada frase reconocida se responde por voz y el Duende vuelve a escuchar en la ventana corta", async () => {
        const canal = { id: "texto-1", isTextBased: () => true, send: jest.fn() };
        await escuchar.run(CLIENTE, interaccion({ textoCanal: canal }));

        await ultimoCallback()("¿qué hora es?", { guild: { id: "g" }, user: { id: "ana" } });

        expect(hablar).toHaveBeenCalledTimes(1);
        const [cliente, opciones] = hablar.mock.calls[0];
        expect(cliente).toBe(CLIENTE);
        expect(opciones).toMatchObject({
            guild: { id: "g" },
            channel: canal,
            user: { id: "ana" },
            forceVoiceReply: true,
            silentTextReply: true,
        });
        expect(opciones.options.getSubcommand()).toBe("talk");
        expect(opciones.options.getString("texto")).toBe("¿qué hora es?");
        expect(opciones.options.getString("otra")).toBeNull();
        await expect(opciones.deferReply()).resolves.toBeUndefined();
        await expect(opciones.editReply()).resolves.toBeUndefined();
        await expect(opciones.followUp()).resolves.toBeUndefined();

        expect(turnos()).toHaveLength(2);
        expect(turnos()[1][5]).toEqual({ timeoutMs: 60000 }); // ventana de charla activa: un minuto
    });

    test("una frase vacía en el primer turno avisa en el canal de texto de que no se ha entendido", async () => {
        const canal = { id: "texto-1", isTextBased: () => true, send: jest.fn(async () => {}) };
        await escuchar.run(CLIENTE, interaccion({ textoCanal: canal }));
        await ultimoCallback()("   ", {});
        expect(canal.send).toHaveBeenCalledWith(
            "No pude entender el audio. Habla 2-4s más cerca del micro y deja 1-2s de silencio al final.",
        );
        expect(hablar).not.toHaveBeenCalled();
        expect(turnos()).toHaveLength(1);
    });

    test("si el canal no es de texto, el aviso de no entender no se intenta", async () => {
        const canal = { id: "voz-texto", isTextBased: () => false, send: jest.fn() };
        await escuchar.run(CLIENTE, interaccion({ textoCanal: canal }));
        await expect(ultimoCallback()(null, {})).resolves.toBeUndefined();
        expect(canal.send).not.toHaveBeenCalled();
    });

    test("si el aviso no se puede enviar, se sigue sin romper", async () => {
        const canal = {
            id: "texto-1",
            isTextBased: () => true,
            send: jest.fn(async () => Promise.reject(new Error("Missing Permissions"))),
        };
        await escuchar.run(CLIENTE, interaccion({ textoCanal: canal }));
        await expect(ultimoCallback()(undefined, {})).resolves.toBeUndefined();
        await new Promise((r) => setImmediate(r));
        expect(canal.send).toHaveBeenCalledTimes(1);
    });

    test("en un turno de re-armado, el silencio termina la sesión en silencio (sin aviso ni nuevo turno)", async () => {
        const canal = { id: "texto-1", isTextBased: () => true, send: jest.fn(async () => {}) };
        await escuchar.run(CLIENTE, interaccion({ textoCanal: canal }));
        await ultimoCallback()("hola", { guild: {}, user: {} }); // abre el re-armado
        expect(turnos()).toHaveLength(2);

        await ultimoCallback()("", {});
        expect(turnos()).toHaveLength(2);
        expect(canal.send).not.toHaveBeenCalled();
    });
});

describe("errores", () => {
    test("si no se puede empezar a escuchar, se registra y el comando no falla", async () => {
        stt.listenAndTranscribe.mockRejectedValueOnce(new Error("sin conexión de voz"));
        const i = interaccion();
        await expect(escuchar.run(CLIENTE, i)).resolves.toBeUndefined();
        await new Promise((r) => setImmediate(r));
        expect(i.reply).toHaveBeenCalledTimes(1);
    });
});
