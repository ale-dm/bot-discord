// /bola8: una respuesta al azar de la lista (sí / no / duda, cada una con su color), la pregunta recortada a 1000
// caracteres y el pie con quien preguntó. Math.random se fija para elegir la respuesta de cada prueba.
const bola8 = require("../src/commands/duende/bola8");

const COLOR_SI = 0x2ecc71;
const COLOR_NO = 0xe74c3c;
const COLOR_DUDA = 0xf1c40f;

// La lista tiene 15 respuestas: con (k + 0.5) / 15 cae exactamente en la posición k.
const enPosicion = (k) => (k + 0.5) / 15;

function interaccion(pregunta = "¿Llueve mañana?") {
    return {
        options: { getString: jest.fn((nombre) => (nombre === "pregunta" ? pregunta : null)) },
        user: { id: "u-1", username: "ana" },
        reply: jest.fn(async () => {}),
    };
}

async function preguntar(pregunta, azar) {
    const spy = jest.spyOn(Math, "random").mockReturnValue(azar);
    const i = interaccion(pregunta);
    try {
        await bola8.run({}, i);
    } finally {
        spy.mockRestore();
    }
    return i.reply.mock.calls[0][0].embeds[0].data;
}

describe("/bola8", () => {
    test("se llama bola8 y pide la pregunta obligatoria", () => {
        expect(bola8.data.name).toBe("bola8");
        const pregunta = bola8.data.options.find((o) => o.name === "pregunta");
        expect(pregunta.required).toBe(true);
    });

    test("responde con un embed de la bola 8 con la pregunta y quien la hizo", async () => {
        const data = await preguntar("¿Llueve mañana?", enPosicion(0));
        expect(data.title).toBe("🔮 La Bola 8 del Duende");
        expect(data.fields[0]).toMatchObject({ name: "❓ Pregunta", value: "¿Llueve mañana?" });
        expect(data.footer.text).toBe("Preguntado por ana");
    });

    test("las respuestas afirmativas (0-4) salen en verde", async () => {
        const data = await preguntar("x", enPosicion(0));
        expect(data.color).toBe(COLOR_SI);
        expect(data.fields[1].value).toBe("**Sí, sin duda.**");
        expect((await preguntar("x", enPosicion(4))).color).toBe(COLOR_SI);
    });

    test("las negativas (5-9) salen en rojo", async () => {
        const data = await preguntar("x", enPosicion(5));
        expect(data.color).toBe(COLOR_NO);
        expect(data.fields[1].value).toBe("**No. Ni lo intentes.**");
        expect((await preguntar("x", enPosicion(9))).color).toBe(COLOR_NO);
    });

    test("las evasivas (10-14) salen en amarillo", async () => {
        const data = await preguntar("x", enPosicion(10));
        expect(data.color).toBe(COLOR_DUDA);
        expect(data.fields[1].value).toBe("**Pregúntame en otro momento, ahora ando liado.**");
        expect((await preguntar("x", enPosicion(14))).color).toBe(COLOR_DUDA);
    });

    test("el valor más alto del azar (casi 1) usa la última respuesta y no se sale de la lista", async () => {
        const data = await preguntar("x", 0.9999999);
        expect(data.fields[1].value).toBe("**Concéntrate y vuelve a preguntar.**");
        expect(data.color).toBe(COLOR_DUDA);
    });

    test("los espacios de los extremos de la pregunta se quitan", async () => {
        const data = await preguntar("   ¿Me toca la lotería?   ", enPosicion(0));
        expect(data.fields[0].value).toBe("¿Me toca la lotería?");
    });

    test("una pregunta de más de 1000 caracteres se corta en el campo", async () => {
        const data = await preguntar("p".repeat(1500), enPosicion(0));
        expect(data.fields[0].value).toHaveLength(1000);
    });

    test("una pregunta de exactamente 1000 caracteres no se corta", async () => {
        const data = await preguntar("q".repeat(1000), enPosicion(0));
        expect(data.fields[0].value).toHaveLength(1000);
        expect(data.fields[0].value).toBe("q".repeat(1000));
    });
});
