// /sonidos (comando): el panel público (paginación y botones sonido_play_N), y lo que pasa al pulsar un sonido: ya no
// existe, se toca en el canal de quien pulsa (o en el del bot), y el resultado de reproducir se cuenta en privado.
// Los sonidos se guardan en la BD en memoria; systems/sonidos.reproducir se sustituye, porque no hay voz real.
const db = require("../src/core/db");
const sonidos = require("../src/systems/sonidos");
const sonidosCmd = require("../src/commands/voz/sonidos");

const G = "g-sonidos-cmd";
const EFIMERO = 64;

function anadir(nombre, guildId = G) {
    const { lastInsertRowid } = db
        .prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, nombre, `${nombre}.mp3`, "admin", Date.now());
    return lastInsertRowid;
}

beforeEach(() => {
    db.prepare("DELETE FROM sonidos").run();
});

afterEach(() => {
    jest.restoreAllMocks();
});

function interaccion(customId, { voz = null, guildId = G } = {}) {
    return {
        customId,
        guildId,
        member: voz === undefined ? undefined : { voice: { channel: voz } },
        user: { id: "ana", username: "ana", tag: "ana#0001" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    };
}

describe("definición y /sonidos", () => {
    test("el comando es sonidos y sus botones cuelgan del prefijo sonido_", () => {
        expect(sonidosCmd.data.name).toBe("sonidos");
        expect(sonidosCmd.componentHandlers).toEqual([
            expect.objectContaining({ prefixes: ["sonido_"], method: "handleButton", acl: "sonidos" }),
        ]);
    });

    test("/sonidos sin sonidos dice cómo añadirlos y no tiene botones", async () => {
        const i = interaccion(null);
        await sonidosCmd.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.embeds[0].data.description).toMatch(/Todavía no hay sonidos/);
        expect(payload.components).toHaveLength(0);
    });

    test("/sonidos es público: la respuesta no es efímera y lista los sonidos por nombre", async () => {
        anadir("Trompeta");
        anadir("bombo");
        const i = interaccion(null);
        await sonidosCmd.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBeUndefined();
        expect(payload.embeds[0].data.footer.text).toBe("Página 1 de 1 · 2 sonidos");
        const etiquetas = payload.components.flatMap((fila) => fila.components.map((b) => b.data.label));
        expect(etiquetas).toEqual(["🔊 bombo", "🔊 Trompeta"]);
    });
});

describe("paginación", () => {
    beforeEach(() => {
        for (let n = 1; n <= 21; n++) anadir(`Sonido ${String(n).padStart(2, "0")}`);
    });

    test("con más de 20 sonidos, la segunda página tiene el resto y botones de página", async () => {
        const i = interaccion("sonido_pagina_1");
        await sonidosCmd.handleButton({}, i);
        const payload = i.update.mock.calls[0][0];
        expect(payload.embeds[0].data.footer.text).toBe("Página 2 de 2 · 21 sonidos");
        const botonesSonido = payload.components.slice(0, -1).flatMap((f) => f.components);
        expect(botonesSonido).toHaveLength(1);
        const navegacion = payload.components.at(-1).components;
        expect(navegacion.map((b) => b.data.custom_id)).toEqual(["sonido_pagina_0", "sonido_pagina_2"]);
        expect(navegacion[1].data.disabled).toBe(true);
        expect(navegacion[0].data.disabled).toBe(false);
    });

    test("una página fuera de rango se lleva a la última", async () => {
        const i = interaccion("sonido_pagina_9");
        await sonidosCmd.handleButton({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.footer.text).toBe("Página 2 de 2 · 21 sonidos");
    });
});

describe("pulsar un sonido", () => {
    test("un sonido que ya no existe se lo dice a quien pulsa, en privado", async () => {
        const i = interaccion("sonido_play_999", { voz: null });
        await sonidosCmd.handleButton({}, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Ese sonido ya no existe.", flags: EFIMERO });
        expect(i.deferReply).not.toHaveBeenCalled();
    });

    test("se confirma en cuanto el sonido empieza, en el canal de quien pulsa", async () => {
        const id = anadir("Bocina");
        const canal = { name: "General" };
        const reproducir = jest.spyOn(sonidos, "reproducir").mockImplementation(async (guildId, c, sonido, deps) => {
            deps.alEmpezar();
            return { ok: true };
        });
        const i = interaccion(`sonido_play_${id}`, { voz: canal });
        await sonidosCmd.handleButton({}, i);

        expect(i.deferReply).toHaveBeenCalledWith({ flags: EFIMERO });
        expect(reproducir).toHaveBeenCalledWith(G, canal, expect.objectContaining({ id, nombre: "Bocina" }), expect.any(Object));
        expect(i.editReply).toHaveBeenCalledWith("🔊 Sonando **Bocina** en General.");
    });

    test("si quien pulsa no está en un canal, el sonido va al canal donde está el bot", async () => {
        const id = anadir("Gong");
        const reproducir = jest.spyOn(sonidos, "reproducir").mockImplementation(async (g, c, s, deps) => {
            deps.alEmpezar();
            return { ok: true };
        });
        const i = interaccion(`sonido_play_${id}`, { voz: null });
        await sonidosCmd.handleButton({}, i);
        expect(reproducir.mock.calls[0][1]).toBeNull();
        expect(i.editReply).toHaveBeenCalledWith("🔊 Sonando **Gong** en el canal donde estoy.");
    });

    test("sin miembro en la interacción tampoco falla: se trata como sin canal", async () => {
        const id = anadir("Silbido");
        jest.spyOn(sonidos, "reproducir").mockResolvedValue({ ok: false, motivo: "Entra en un canal de voz." });
        const i = interaccion(`sonido_play_${id}`, { voz: undefined });
        await sonidosCmd.handleButton({}, i);
        expect(sonidos.reproducir.mock.calls[0][1]).toBeNull();
        expect(i.editReply).toHaveBeenCalledWith("❌ Entra en un canal de voz.");
    });

    test("si el sonido no se puede reproducir, se dice el motivo", async () => {
        const id = anadir("Trueno");
        jest.spyOn(sonidos, "reproducir").mockResolvedValue({ ok: false, motivo: "Ya está sonando otro sonido en el servidor." });
        const i = interaccion(`sonido_play_${id}`, { voz: { name: "General" } });
        await sonidosCmd.handleButton({}, i);
        expect(i.editReply).toHaveBeenCalledWith("❌ Ya está sonando otro sonido en el servidor.");
    });

    test("un botón que no es de sonidos no hace nada", async () => {
        const i = interaccion("sonido_otra_cosa");
        const r = await sonidosCmd.handleButton({}, i);
        expect(r).toBeUndefined();
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply).not.toHaveBeenCalled();
    });
});
