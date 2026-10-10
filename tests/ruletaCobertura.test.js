// Ruleta del casino (juegos/casino/ruleta) de principio a fin: el tipo de apuesta, qué paga cada una, el RTP, el
// botón Repetir y la animación. La ruleta no tiene inyección de azar: en animarYGirar, Math.random se llama tres
// veces y en este orden: el número que sale, la casilla de la que arranca la rueda y las vueltas. Se fijan con
// mockReturnValueOnce (número n → (n + 0.5) / 37). Los relojes son simulados para que la animación sea instantánea.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const guildSettings = require("../src/systems/guildSettings");
const ruleta = require("../src/juegos/casino/ruleta");

const GUILD_RTP = "g-ruleta-rtp";
guildSettings.setSetting(GUILD_RTP, "casino.rtp_ruleta", 50);

let n = 0;
let azar = null;
/** Un jugador con exactamente `efectivo` en mano (las cuentas nuevas arrancan con un saldo inicial). */
function jugador(efectivo = 1000) {
    const id = `ruleta-cob-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const saldo = (id) => dinero.efectivo(id);
const ultimaRuleta = (id) =>
    db.prepare("SELECT resultado, detalle FROM casino WHERE userId = ? AND juego = 'ruleta' ORDER BY rowid DESC LIMIT 1").get(id);

/** La próxima tirada: sale `numero`, la rueda arranca en la casilla `inicio` y da el mínimo de vueltas. */
function salidaEn(numero, inicio = 0) {
    azar = jest.spyOn(Math, "random");
    azar.mockReturnValueOnce((numero + 0.5) / 37)
        .mockReturnValueOnce((inicio + 0.5) / 37)
        .mockReturnValue(0);
}

/** Un /ruleta: la interacción del comando con su respuesta diferida y su edición. */
function comando(userId, { apuesta = 100, numero = null, tipo = null, guildId = null, editReply, deferReply } = {}) {
    return {
        user: { id: userId, username: userId, tag: `${userId}#0` },
        guildId,
        options: {
            getInteger: (nombre) => (nombre === "apuesta" ? apuesta : nombre === "numero" ? numero : null),
            getString: (nombre) => (nombre === "tipo" ? tipo : null),
        },
        reply: jest.fn(async () => {}),
        deferReply: deferReply || jest.fn(async () => {}),
        editReply: editReply || jest.fn(async () => {}),
    };
}

/** Un botón de la ruleta. `dueno`: quien ejecutó el comando que creó el mensaje (sin él, nadie lo es). */
function boton(userId, customId, { dueno = userId, sinDueno = false, guildId = null } = {}) {
    return {
        customId,
        user: { id: userId, username: userId, tag: `${userId}#0` },
        guildId,
        message: sinDueno ? {} : { interaction: { user: { id: dueno } } },
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
    };
}

/** Ejecuta el comando con los relojes simulados (la animación tarda varios segundos reales). */
async function jugar(i) {
    const partida = ruleta.run(null, i);
    await jest.runAllTimersAsync();
    await partida;
    return i;
}
async function pulsar(i) {
    const partida = ruleta.handleButton(null, i);
    await jest.runAllTimersAsync();
    await partida;
    return i;
}
const embedFinal = (i) => i.editReply.mock.calls.at(-1)[0].embeds[0].data;
const titulo = (i) => embedFinal(i).title;
const GANA = "🏆  ¡¡ G A N A S T E !!  🏆";
const PIERDE = "💀  P E R D I S T E  💀";

beforeEach(() => {
    jest.useFakeTimers();
});
afterEach(() => {
    azar?.mockRestore();
    azar = null;
    jest.useRealTimers();
});

describe("qué paga cada apuesta", () => {
    test("sin tipo ni número, pide elegir una apuesta y no cobra", async () => {
        const u = jugador(1000);
        const i = await jugar(comando(u));
        expect(i.reply.mock.calls[0][0].content).toMatch(/Elige un \*\*tipo\*\*/);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(1000);
    });

    test("número exacto: acierta y cobra 35 veces la apuesta (de 900 a 4500)", async () => {
        const u = jugador(1000);
        salidaEn(17);
        const i = await jugar(comando(u, { numero: 17 }));
        expect(saldo(u)).toBe(4500);
        expect(ultimaRuleta(u)).toMatchObject({ resultado: 3500 });
        expect(titulo(i)).toBe(GANA);
    });

    test("número exacto 0: también es un número que se puede acertar", async () => {
        const u = jugador(1000);
        salidaEn(0);
        const i = await jugar(comando(u, { numero: 0 }));
        expect(titulo(i)).toBe(GANA);
        expect(saldo(u)).toBe(4500);
    });

    test("color: acertar el rojo cobra la apuesta doble (900 → 1100)", async () => {
        const u = jugador(1000);
        salidaEn(1); // 1 es rojo
        const i = await jugar(comando(u, { tipo: "color:rojo" }));
        expect(saldo(u)).toBe(1100);
        expect(titulo(i)).toBe(GANA);
    });

    test("color: el negro pierde si sale rojo", async () => {
        const u = jugador(1000);
        salidaEn(1);
        const i = await jugar(comando(u, { tipo: "color:negro" }));
        expect(saldo(u)).toBe(900);
        expect(ultimaRuleta(u).resultado).toBe(-100);
        expect(titulo(i)).toBe(PIERDE);
    });

    test("paridad: par gana con un par y pierde con un impar", async () => {
        const par = jugador(1000);
        salidaEn(4);
        await jugar(comando(par, { tipo: "paridad:par" }));
        expect(saldo(par)).toBe(1100);

        const impar = jugador(1000);
        salidaEn(4);
        await jugar(comando(impar, { tipo: "paridad:impar" }));
        expect(saldo(impar)).toBe(900);
    });

    test("mitad: bajo cubre 1-18 y alto cubre 19-36", async () => {
        const bajo = jugador(1000);
        salidaEn(18);
        await jugar(comando(bajo, { tipo: "mitad:bajo" }));
        expect(saldo(bajo)).toBe(1100);

        const alto = jugador(1000);
        salidaEn(19);
        await jugar(comando(alto, { tipo: "mitad:alto" }));
        expect(saldo(alto)).toBe(1100);

        const aciertaNo = jugador(1000);
        salidaEn(18);
        await jugar(comando(aciertaNo, { tipo: "mitad:alto" }));
        expect(saldo(aciertaNo)).toBe(900);
    });

    test("docena: la 2ª (13-24) paga 2 veces la apuesta de ganancia; la 3ª no", async () => {
        const acierta = jugador(1000);
        salidaEn(13);
        await jugar(comando(acierta, { tipo: "docena:2" }));
        expect(saldo(acierta)).toBe(1200);
        expect(ultimaRuleta(acierta).resultado).toBe(200);

        const falla = jugador(1000);
        salidaEn(13);
        await jugar(comando(falla, { tipo: "docena:3" }));
        expect(saldo(falla)).toBe(900);
    });

    test.each(["color:rojo", "paridad:par", "mitad:bajo", "docena:1"])(
        "el 0 no gana %s: la banca gana y el resultado lo dice",
        async (tipo) => {
            const u = jugador(1000);
            salidaEn(0);
            const i = await jugar(comando(u, { tipo }));
            expect(saldo(u)).toBe(900);
            expect(titulo(i)).toBe(PIERDE);
            expect(embedFinal(i).description).toMatch(/verde \(banca gana\)/);
        },
    );

    test("un tipo que no existe se cobra como pérdida", async () => {
        const u = jugador(1000);
        salidaEn(5);
        await jugar(comando(u, { tipo: "foo:bar" }));
        expect(saldo(u)).toBe(900);
    });
});

describe("apuestas no válidas", () => {
    test("sin saldo para la apuesta, avisa en privado y no gira", async () => {
        const u = jugador(50);
        const i = await jugar(comando(u, { tipo: "color:rojo" }));
        expect(i.reply.mock.calls[0][0].content).toMatch(/Saldo insuficiente/);
        expect(i.reply.mock.calls[0][0].flags).toBeDefined();
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(50);
    });

    test("por debajo del mínimo (10) la rechaza la validación de apuestas, sin girar", async () => {
        const u = jugador(1000);
        const i = await jugar(comando(u, { apuesta: 5, tipo: "color:rojo" }));
        expect(i.reply.mock.calls[0][0].content).toMatch(/La apuesta mínima es de 10 monedas/);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(1000);
    });

    test("por encima del máximo (100.000) también la rechaza", async () => {
        const u = jugador(200000);
        const i = await jugar(comando(u, { apuesta: 100001, tipo: "color:rojo" }));
        expect(i.reply.mock.calls[0][0].content).toMatch(/La apuesta máxima es de 100\D?000 monedas/);
        expect(saldo(u)).toBe(200000);
    });

    test("apostar justo el mínimo sí gira", async () => {
        const u = jugador(1000);
        salidaEn(1);
        const i = await jugar(comando(u, { apuesta: 10, tipo: "color:rojo" }));
        expect(i.deferReply).toHaveBeenCalled();
        expect(saldo(u)).toBe(1010);
    });
});

describe("RTP de la ruleta", () => {
    test("con rtp al 50 %, la ganancia neta se reduce a la mitad", async () => {
        const u = jugador(1000);
        salidaEn(1);
        await jugar(comando(u, { tipo: "color:rojo", guildId: GUILD_RTP }));
        expect(ultimaRuleta(u).resultado).toBe(50);
    });
});

describe("animación", () => {
    test("13 fotogramas, la última vuelta para en el número que sale, luego revela y muestra el resultado", async () => {
        const u = jugador(1000);
        salidaEn(17, 5);
        const i = await jugar(comando(u, { tipo: "color:negro" }));
        expect(i.editReply).toHaveBeenCalledTimes(15);
        const fotogramas = i.editReply.mock.calls.slice(0, 13).map((c) => c[0].embeds[0].data.title);
        expect(fotogramas.at(-1)).toMatch(/⚫ 17$/);
        expect(i.editReply.mock.calls[13][0].embeds[0].data.title).toBe("🛑 ¡Paró en ⚫ 17!");
        expect(titulo(i)).toBe(GANA);
    });

    test("el resultado final conserva el botón Repetir con la misma apuesta y tipo", async () => {
        const u = jugador(1000);
        salidaEn(2);
        const i = await jugar(comando(u, { tipo: "color:negro" }));
        const fila = i.editReply.mock.calls.at(-1)[0].components[0];
        expect(fila.components[0].data.custom_id).toBe("casino_play_ruleta_100_color_negro");
    });

    test("si Discord no deja editar el mensaje, la partida se liquida igual", async () => {
        const u = jugador(1000);
        salidaEn(1);
        const editReply = jest.fn().mockRejectedValue(new Error("Unknown Message"));
        await jugar(comando(u, { tipo: "color:rojo", editReply }));
        expect(saldo(u)).toBe(1100);
        expect(ultimaRuleta(u).resultado).toBe(100);
    });

    test("si no se puede diferir la respuesta, sigue girando y paga", async () => {
        const u = jugador(1000);
        salidaEn(1);
        const deferReply = jest.fn().mockRejectedValue(new Error("Interaction expired"));
        await jugar(comando(u, { tipo: "color:rojo", deferReply }));
        expect(saldo(u)).toBe(1100);
    });
});

describe("botón Repetir", () => {
    test("quien jugó puede repetir: vuelve a girar con la misma apuesta y tipo", async () => {
        const u = jugador(1000);
        salidaEn(1);
        const i = await pulsar(boton(u, "ruleta_rept_100_color_rojo"));
        expect(i.deferUpdate).toHaveBeenCalled();
        expect(saldo(u)).toBe(1100);
        expect(titulo(i)).toBe(GANA);
    });

    test("repetir un número exacto (con el número dentro del identificador)", async () => {
        const u = jugador(1000);
        salidaEn(17);
        await pulsar(boton(u, "ruleta_rept_100_numero_17"));
        expect(saldo(u)).toBe(4500);
    });

    test("otra persona no puede usar el botón", async () => {
        const u = jugador(1000);
        const i = await pulsar(boton(u, "ruleta_rept_100_color_rojo", { dueno: "otro-usuario" }));
        expect(i.reply.mock.calls[0][0].content).toMatch(/Solo quien usó el comando/);
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(1000);
    });

    test("si el mensaje no guarda quién lo creó, cualquiera puede pulsar", async () => {
        const u = jugador(1000);
        salidaEn(1);
        const i = await pulsar(boton(u, "ruleta_rept_100_color_rojo", { sinDueno: true }));
        expect(i.deferUpdate).toHaveBeenCalled();
    });

    test("repetir sin saldo para la apuesta avisa y no gira", async () => {
        const u = jugador(50);
        const i = await pulsar(boton(u, "ruleta_rept_100_color_rojo"));
        expect(i.reply.mock.calls[0][0].content).toMatch(/No tienes \*\*100\*\* 🪙 para repetir/);
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(50);
    });

    test("un botón de la ruleta que no es Repetir no hace nada", async () => {
        const u = jugador(1000);
        const i = await pulsar(boton(u, "ruleta_otra_cosa"));
        expect(i.reply).not.toHaveBeenCalled();
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(saldo(u)).toBe(1000);
    });
});
