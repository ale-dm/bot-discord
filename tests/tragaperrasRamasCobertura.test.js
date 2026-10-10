// Tragaperras (#239, cobertura): las ramas que no cubren tests/tragaperras.test.js. Las carreras del casino
// (dinero, RTP) están simuladas; los carretes se fuerzan con Math.random a partir de los pesos de cada símbolo, y el
// tiempo de la animación se acorta para que la prueba no tarde.
const db = require("../src/core/db");
const casinoTx = require("../src/systems/casinoTransactions");
const tragaperras = require("../src/juegos/casino/tragaperras");

jest.mock("../src/systems/casinoTransactions", () => ({
    registrarUsuario: jest.fn(),
    descontarApuesta: jest.fn(),
    procesarGanancia: jest.fn(),
    procesarPerdida: jest.fn(),
    obtenerSaldo: jest.fn(),
    applyRtp: jest.fn(),
}));

const { calcularGanancia } = tragaperras.__test;

// Mismo orden y pesos que SIMBOLOS en la fuente: el azar elige el símbolo según el peso acumulado.
const SIMBOLOS = ["🍒", "🍋", "🍊", "🍇", "🔔", "💎", "⭐", "7️⃣"];
const PESOS = [30, 25, 20, 15, 10, 5, 3, 2];
const ACUMULADO = PESOS.reduce((acc, p) => [...acc, (acc.at(-1) ?? 0) + p], []);
const PESO_TOTAL = ACUMULADO.at(-1);
// Un valor de Math.random que cae en el centro del tramo de ese símbolo.
const azarPara = (simbolo) => {
    const i = SIMBOLOS.indexOf(simbolo);
    return (ACUMULADO[i] - PESOS[i] / 2) / PESO_TOTAL;
};

let randomSpy;
const forzarCarretes = (a, b, c) => {
    randomSpy.mockReturnValueOnce(azarPara(a)).mockReturnValueOnce(azarPara(b)).mockReturnValueOnce(azarPara(c));
};

const TITULO_ANIMACION = "🎰 TRAGAPERRAS 🎰";

function interaccion({ customId = "", apuesta = null, userId = "u-tragaperras", username = "ana" } = {}) {
    return {
        customId,
        guildId: "g-tragaperras",
        user: { id: userId, username, tag: `${username}#0001` },
        options: { getInteger: () => apuesta },
        reply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
    };
}

// El último embed de resultado que se ha editado en el mensaje (no el de la animación).
const ultimoResultado = (i) => {
    const llamadas = i.editReply.mock.calls.map((c) => c[0]);
    return llamadas.filter((p) => p.embeds?.[0]?.data?.title !== TITULO_ANIMACION).at(-1).embeds[0].data;
};

beforeEach(() => {
    // Sin esperas reales: la animación y las pausas se ejecutan al instante.
    jest.spyOn(global, "setTimeout").mockImplementation((fn) => {
        fn();
        return 0;
    });
    randomSpy = jest.spyOn(Math, "random");
    db.prepare("DELETE FROM slots_jackpot").run();
    db.prepare("INSERT INTO slots_jackpot (id, cantidad) VALUES (1, 10000)").run();

    casinoTx.registrarUsuario.mockReset();
    casinoTx.descontarApuesta.mockReset().mockReturnValue({ exito: true });
    casinoTx.procesarGanancia.mockReset().mockReturnValue(true);
    casinoTx.procesarPerdida.mockReset();
    casinoTx.obtenerSaldo.mockReset().mockReturnValue(900);
    casinoTx.applyRtp.mockReset().mockImplementation((guild, juego, apuesta, ganancia) => ganancia);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("calcularGanancia: combinaciones que faltaban", () => {
    test("sin override, el jackpot es el del bote guardado", () => {
        db.prepare("UPDATE slots_jackpot SET cantidad = 777 WHERE id = 1").run();
        expect(calcularGanancia(["7️⃣", "7️⃣", "7️⃣"], 100).ganancia).toBe(777);
    });

    test("si no hay fila de bote, el jackpot base es 10.000", () => {
        db.prepare("DELETE FROM slots_jackpot").run();
        expect(calcularGanancia(["7️⃣", "7️⃣", "7️⃣"], 100).ganancia).toBe(10000);
    });

    test("un doble formado por las dos últimas columnas usa ese símbolo", () => {
        const r = calcularGanancia(["🍋", "🍒", "🍒"], 100);
        expect(r.tipo).toBe("doble");
        expect(r.mensaje).toContain("Doble Cereza");
    });

    test("un doble formado por la primera y la última columna usa ese símbolo", () => {
        const r = calcularGanancia(["🍒", "🍋", "🍒"], 100);
        expect(r.tipo).toBe("doble");
        expect(r.mensaje).toContain("Doble Cereza");
    });

    test("un doble de 7 paga 17 veces (50 / 3, redondeado hacia arriba)", () => {
        const r = calcularGanancia(["7️⃣", "7️⃣", "🍒"], 100);
        expect(r.multiplicador).toBe("x17");
        expect(r.ganancia).toBe(1700);
    });
});

describe("resultado en el mensaje", () => {
    test("un triple se muestra en verde, con su banner", async () => {
        forzarCarretes("💎", "💎", "💎");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        const embed = ultimoResultado(i);
        expect(embed.title).toBe("🎊 ¡TRIPLE!");
        expect(embed.color).toBe(0x2ecc71);
        expect(embed.footer.text).toBe("¡Excelente! ¡Sigue así! 🌟");
        expect(embed.description).toContain("COMBINACIÓN PERFECTA");
    });

    test("un doble con beneficio se muestra como DOBLE, en azul", async () => {
        forzarCarretes("🍇", "🍇", "🍒");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        const embed = ultimoResultado(i);
        expect(embed.title).toBe("🎉 ¡DOBLE!");
        expect(embed.color).toBe(0x3498db);
        expect(embed.footer.text).toBe("¡Bien! ¡Sigue probando! 💪");
        expect(embed.description).toContain("+100 monedas");
    });

    test("un doble que solo devuelve la apuesta se muestra como recuperación, en gris", async () => {
        forzarCarretes("🍒", "🍒", "🍋");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        const embed = ultimoResultado(i);
        expect(embed.title).toBe("🔁 RECUPERAS APUESTA");
        expect(embed.color).toBe(0x95a5a6);
        expect(embed.footer.text).toBe("Al menos recuperaste la apuesta 👌");
    });

    test("sin premio se registra la pérdida y se muestra en rojo con la apuesta en negativo", async () => {
        forzarCarretes("🍒", "🍋", "🍊");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        const embed = ultimoResultado(i);
        expect(casinoTx.procesarPerdida).toHaveBeenCalledWith("u-tragaperras", "tragaperras", 100, expect.any(String), expect.any(Object));
        expect(embed.title).toBe("😢 SIN PREMIO");
        expect(embed.color).toBe(0xe74c3c);
        expect(embed.description).toContain("-100 monedas");
    });

    test("el jackpot se paga, reinicia el bote y lo anuncia", async () => {
        db.prepare("UPDATE slots_jackpot SET cantidad = 40000 WHERE id = 1").run();
        forzarCarretes("7️⃣", "7️⃣", "7️⃣");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        const embed = ultimoResultado(i);
        expect(casinoTx.procesarGanancia).toHaveBeenCalledWith(
            "u-tragaperras",
            "tragaperras",
            100,
            40000,
            expect.stringContaining("JACKPOT"),
            expect.any(Object),
        );
        expect(embed.footer.text).toBe("¡FELICIDADES! ¡Ganaste el JACKPOT! 🎉");
        expect(embed.description).toContain("Jackpot reiniciado: **10,000** monedas");
    });

    test("si el pago del jackpot falla, el bote no se reinicia", async () => {
        db.prepare("UPDATE slots_jackpot SET cantidad = 40000 WHERE id = 1").run();
        casinoTx.procesarGanancia.mockReturnValue(false);
        forzarCarretes("7️⃣", "7️⃣", "7️⃣");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        expect(db.prepare("SELECT cantidad FROM slots_jackpot WHERE id = 1").get().cantidad).toBe(40000 + 10);
    });

    test("si el pago de una victoria falla, no se da por pagada (solo queda el registro)", async () => {
        casinoTx.procesarGanancia.mockReturnValue(false);
        forzarCarretes("💎", "💎", "💎");
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        expect(casinoTx.procesarGanancia).toHaveBeenCalledTimes(1);
        expect(ultimoResultado(i).title).toBe("🎊 ¡TRIPLE!");
    });

    test("si editar el mensaje con botones falla, se reintenta sin ellos", async () => {
        forzarCarretes("🍒", "🍋", "🍊");
        const i = interaccion({ apuesta: 100 });
        i.editReply.mockImplementation(async (p) => {
            const esResultado = p.embeds?.[0]?.data?.title !== TITULO_ANIMACION;
            if (esResultado && p.components?.length) throw new Error("Unknown message");
        });
        await tragaperras.run(null, i);
        const ultima = i.editReply.mock.calls.at(-1)[0];
        expect(ultima.components).toEqual([]);
        expect(ultima.embeds[0].data.title).toBe("😢 SIN PREMIO");
    });

    test("si la animación falla, el giro sigue y el resultado llega igual", async () => {
        forzarCarretes("🍒", "🍋", "🍊");
        const i = interaccion({ apuesta: 100 });
        i.editReply.mockImplementation(async (p) => {
            if (p.embeds?.[0]?.data?.title === TITULO_ANIMACION) throw new Error("animación caída");
        });
        await tragaperras.run(null, i);
        expect(casinoTx.procesarPerdida).toHaveBeenCalled();
        expect(ultimoResultado(i).title).toBe("😢 SIN PREMIO");
    });
});

describe("entrada al juego", () => {
    test("sin apuesta se enseña el selector de importes, con el bote", async () => {
        const i = interaccion({ apuesta: null });
        await tragaperras.run(null, i);
        const panel = i.reply.mock.calls[0][0];
        expect(panel.embeds[0].data.description).toContain("Jackpot actual");
        expect(casinoTx.descontarApuesta).not.toHaveBeenCalled();
    });

    test("con saldo insuficiente el aviso sale aparte y el juego no empieza", async () => {
        casinoTx.descontarApuesta.mockReturnValue({ exito: false, mensaje: "No tienes saldo" });
        const i = interaccion({ apuesta: 100 });
        await tragaperras.run(null, i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes saldo" }));
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(casinoTx.procesarPerdida).not.toHaveBeenCalled();
    });

    test("un giro de un botón con saldo insuficiente avisa con un seguimiento", async () => {
        casinoTx.descontarApuesta.mockReturnValue({ exito: false, mensaje: "No tienes saldo" });
        const i = interaccion();
        await tragaperras.jugar(i, 100, "u-tragaperras", "ana", true);
        expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes saldo" }));
        expect(i.reply).not.toHaveBeenCalled();
    });

    test("si ya hay un giro en curso, se avisa al que lo pide y no se cobra otra vez", async () => {
        let soltar;
        randomSpy.mockReturnValue(0.5);
        const primera = interaccion({ apuesta: 100 });
        primera.editReply.mockImplementationOnce(() => new Promise((resolve) => (soltar = resolve)));
        const en_curso = tragaperras.run(null, primera);
        await new Promise((r) => setImmediate(r));

        const segunda = interaccion({ apuesta: 100 });
        await tragaperras.run(null, segunda);
        expect(segunda.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Ya tienes una tragaperras en curso") }),
        );
        expect(casinoTx.descontarApuesta).toHaveBeenCalledTimes(1);

        soltar();
        await en_curso;
    });

    test("un botón que llega con un giro en curso se ignora en silencio", async () => {
        let soltar;
        randomSpy.mockReturnValue(0.5);
        const primera = interaccion({ apuesta: 100 });
        primera.editReply.mockImplementationOnce(() => new Promise((resolve) => (soltar = resolve)));
        const en_curso = tragaperras.run(null, primera);
        await new Promise((r) => setImmediate(r));

        const boton = interaccion();
        await tragaperras.jugar(boton, 100, "u-tragaperras", "ana", true);
        expect(boton.reply).not.toHaveBeenCalled();
        expect(boton.followUp).not.toHaveBeenCalled();

        soltar();
        await en_curso;
    });
});

describe("botones", () => {
    test("repetir gira con la misma apuesta", async () => {
        forzarCarretes("🍒", "🍋", "🍊");
        const i = interaccion({ customId: "tragaperras_repetir_250" });
        await tragaperras.handleButton(null, i);
        expect(i.deferUpdate).toHaveBeenCalled();
        expect(casinoTx.descontarApuesta).toHaveBeenCalledWith("u-tragaperras", 250, "g-tragaperras");
    });

    test("jugar con una cantidad concreta gira con esa cantidad", async () => {
        forzarCarretes("🍒", "🍋", "🍊");
        const i = interaccion({ customId: "tragaperras_jugar_500" });
        await tragaperras.handleButton(null, i);
        expect(casinoTx.descontarApuesta).toHaveBeenCalledWith("u-tragaperras", 500, "g-tragaperras");
    });

    test("repetir o jugar mientras se gira avisa y no gira", async () => {
        let soltar;
        randomSpy.mockReturnValue(0.5);
        const primera = interaccion({ apuesta: 100 });
        primera.editReply.mockImplementationOnce(() => new Promise((resolve) => (soltar = resolve)));
        const en_curso = tragaperras.run(null, primera);
        await new Promise((r) => setImmediate(r));

        for (const customId of ["tragaperras_repetir_100", "tragaperras_jugar_100"]) {
            const i = interaccion({ customId });
            await tragaperras.handleButton(null, i);
            expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Ya estás girando") }));
        }
        expect(casinoTx.descontarApuesta).toHaveBeenCalledTimes(1);

        soltar();
        await en_curso;
    });

    test("la ayuda se muestra en privado, con la tabla de símbolos", async () => {
        const i = interaccion({ customId: "tragaperras_ayuda" });
        await tragaperras.handleButton(null, i);
        const { embeds, flags } = i.reply.mock.calls[0][0];
        expect(embeds[0].data.title).toContain("CÓMO JUGAR");
        expect(embeds[0].data.description).toContain("Cereza");
        expect(flags).toBeDefined();
    });

    test("las estadísticas del casino se piden solo de la tragaperras", async () => {
        const i = interaccion({ customId: "tragaperras_stats" });
        await tragaperras.handleButton(null, i);
        expect(i.reply).toHaveBeenCalledTimes(1);
        expect(i.reply.mock.calls[0][0].flags).toBeDefined();
    });

    test("un botón desconocido no hace nada", async () => {
        const i = interaccion({ customId: "tragaperras_otra_cosa" });
        await tragaperras.handleButton(null, i);
        expect(i.reply).not.toHaveBeenCalled();
        expect(i.deferUpdate).not.toHaveBeenCalled();
    });
});
