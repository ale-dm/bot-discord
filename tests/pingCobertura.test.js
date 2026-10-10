// /ping: la latencia del bot (desde que llega la interacción hasta que se ve el mensaje) y la de la API de Discord
// (client.ws.ping). Sin Discord: la interacción y el mensaje enviado son objetos simulados.
const ping = require("../src/commands/general/ping");

function interaccion({ creada = 1000, enviada = 1150, fetchFalla = false } = {}) {
    const mensaje = { createdTimestamp: enviada };
    return {
        createdTimestamp: creada,
        reply: jest.fn(async () => {}),
        fetchReply: fetchFalla ? jest.fn(async () => Promise.reject(new Error("Unknown interaction"))) : jest.fn(async () => mensaje),
        editReply: jest.fn(async () => {}),
    };
}

describe("/ping", () => {
    test("se llama ping y no pide opciones", () => {
        expect(ping.data.name).toBe("ping");
        expect(ping.data.options).toHaveLength(0);
    });

    test("primero contesta «Calculando ping...» y luego edita el mensaje con un embed", async () => {
        const i = interaccion();
        await ping.run({ ws: { ping: 42 } }, i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Calculando ping..." });
        expect(i.fetchReply).toHaveBeenCalledTimes(1);
        const edicion = i.editReply.mock.calls[0][0];
        expect(edicion.content).toBeNull();
        expect(edicion.embeds).toHaveLength(1);
    });

    test("la latencia del bot es el tiempo entre la interacción y el mensaje enviado; la de la API sale de client.ws", async () => {
        const i = interaccion({ creada: 1000, enviada: 1150 });
        await ping.run({ ws: { ping: 42 } }, i);
        const campos = i.editReply.mock.calls[0][0].embeds[0].data.fields;
        expect(campos[0]).toMatchObject({ name: "Latencia del bot", value: "`150 ms`", inline: true });
        expect(campos[1]).toMatchObject({ name: "Latencia de la API", value: "`42 ms`", inline: true });
    });

    test("el embed tiene título, color y marca de hora", async () => {
        const i = interaccion();
        await ping.run({ ws: { ping: 7 } }, i);
        const data = i.editReply.mock.calls[0][0].embeds[0].data;
        expect(data.title).toBe("🏓 ¡Pong!");
        expect(data.color).toBe(0x00ff99);
        expect(data.timestamp).toBeDefined();
    });

    test("una latencia de API de 0 ms se muestra tal cual (no se oculta como falsy)", async () => {
        const i = interaccion();
        await ping.run({ ws: { ping: 0 } }, i);
        expect(i.editReply.mock.calls[0][0].embeds[0].data.fields[1].value).toBe("`0 ms`");
    });

    test("si Discord no devuelve el mensaje enviado, el error sube al manejador de comandos", async () => {
        const i = interaccion({ fetchFalla: true });
        await expect(ping.run({ ws: { ping: 1 } }, i)).rejects.toThrow("Unknown interaction");
        expect(i.editReply).not.toHaveBeenCalled();
    });
});
