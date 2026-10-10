// Handlers de 🧩 Combinada (juegos/apuestas/combinada): el boleto efímero, sumar una pata desde un partido, vaciar,
// quitar, el formulario de importe y el aviso de cada respuesta. Usa la BD en memoria y el dinero real; las
// interacciones de Discord son objetos con jest.fn().
const { MessageFlags } = require("discord.js");
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const combinadas = require("../src/systems/apuestas/combinadas");
const combinada = require("../src/juegos/apuestas/combinada");

const FUTURO = "2099-01-01T20:00:00.000Z";
const PASADO = "2000-01-01T20:00:00.000Z";
const G = "g-combinada-cob";
let n = 0;

/** Un partido abierto con cuotas 2 (local), 3 (empate) y 4 (visitante). */
function partido({ start = FUTURO } = {}) {
    const id = `cc-${++n}`;
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away)
         VALUES (?, 'laliga', ?, ?, ?, 'abierto', 2.0, 3.0, 4.0)`,
    ).run(id, `Local ${id}`, `Visitante ${id}`, start);
    return id;
}
/** Un usuario con exactamente `efectivo` en mano (las cuentas nuevas arrancan con un saldo inicial). */
function usuario(efectivo = 1000) {
    const id = `cc-user-${++n}`;
    dinero.asegurarCuenta(id);
    db.prepare("UPDATE banco SET enMano = ? WHERE userId = ?").run(efectivo, id);
    return id;
}
const saldo = (id) => dinero.efectivo(id);
const boletos = (id) => db.prepare("SELECT cantidad, cuota, estado FROM combinadas WHERE user_id = ?").all(String(id));

/** Una interacción de botón, select o modal con sus respuestas. */
function interaccion(userId, extra = {}) {
    return {
        user: { id: userId },
        guildId: G,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    };
}
const descripcion = (payload) => payload.embeds[0].data.description;

describe("abrir el boleto", () => {
    test("sin partidas, abre el boleto en privado y explica cómo sumar", async () => {
        const u = usuario();
        const i = interaccion(u);
        await combinada.handleAbrir(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(descripcion(payload)).toMatch(/Todavía no has sumado ningún partido/);
    });
});

describe("sumar una pata desde un partido", () => {
    test("suma la elección y responde en privado con el boleto y el aviso", async () => {
        const u = usuario();
        const a = partido();
        const i = interaccion(u, { customId: `combinada_sumar_${a}`, values: ["home"] });
        await combinada.handleSumar(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(descripcion(payload)).toMatch(/✅/);
        expect(descripcion(payload)).toMatch(/cuota 2/);
        expect(combinadas.borrador(u)).toHaveLength(1);
    });

    test("con dos patas enseña la cuota total y el premio de 100", async () => {
        const u = usuario();
        const a = partido();
        const b = partido();
        await combinada.handleSumar(null, interaccion(u, { customId: `combinada_sumar_${a}`, values: ["home"] }));
        const i = interaccion(u, { customId: `combinada_sumar_${b}`, values: ["draw"] });
        await combinada.handleSumar(null, i);
        expect(descripcion(i.reply.mock.calls[0][0])).toMatch(/Cuota total:\*\* `6`/);
    });

    test("un partido que ya ha empezado no se puede sumar: el aviso lo dice", async () => {
        const u = usuario();
        const empezado = partido({ start: PASADO });
        const i = interaccion(u, { customId: `combinada_sumar_${empezado}`, values: ["home"] });
        await combinada.handleSumar(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(descripcion(payload)).toMatch(/❌ Ese partido ya ha empezado/);
        expect(combinadas.borrador(u)).toHaveLength(0);
    });
});

describe("botones del boleto", () => {
    test("Actualizar repinta el boleto con el estado actual", async () => {
        const u = usuario();
        combinadas.sumar(u, partido(), "home");
        const i = interaccion(u, { customId: "combinada_ver" });
        await combinada.handleButton(null, i);
        expect(i.update).toHaveBeenCalledTimes(1);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toBe("🧩 Tu combinada");
    });

    test("Vaciar borra todas las patas y avisa", async () => {
        const u = usuario();
        combinadas.sumar(u, partido(), "home");
        combinadas.sumar(u, partido(), "away");
        const i = interaccion(u, { customId: "combinada_vaciar" });
        await combinada.handleButton(null, i);
        expect(combinadas.borrador(u)).toHaveLength(0);
        expect(descripcion(i.update.mock.calls[0][0])).toMatch(/🗑️ Boleto vaciado/);
    });

    test("Quitar un partido que está en el boleto lo quita y avisa", async () => {
        const u = usuario();
        const a = partido();
        const b = partido();
        combinadas.sumar(u, a, "home");
        combinadas.sumar(u, b, "draw");
        const i = interaccion(u, { customId: `combinada_quitar_${a}` });
        await combinada.handleButton(null, i);
        expect(descripcion(i.update.mock.calls[0][0])).toMatch(/✖ Partido quitado/);
        expect(combinadas.borrador(u).map((p) => p.matchId)).toEqual([b]);
    });

    test("Quitar un partido que ya no está avisa en lugar de fallar", async () => {
        const u = usuario();
        const i = interaccion(u, { customId: `combinada_quitar_${partido()}` });
        await combinada.handleButton(null, i);
        expect(descripcion(i.update.mock.calls[0][0])).toMatch(/Ese partido ya no está en tu combinada/);
    });

    test("Apostar abre el formulario de importe con el rango permitido", async () => {
        const u = usuario();
        const i = interaccion(u, { customId: "combinada_apostar" });
        await combinada.handleButton(null, i);
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("combinada_modal_apostar");
        expect(modal.title).toBe("🧩 Apostar combinada");
        expect(modal.components[0].component.custom_id).toBe("importe");
        const campo = modal.components[1].components[0];
        expect(campo.custom_id).toBe("cantidad");
        expect(campo.label).toBe(`Otra cantidad (${combinadas.MIN_APUESTA}-${combinadas.MAX_APUESTA})`);
        expect(campo.min_length).toBe(1);
        expect(campo.max_length).toBe(7);
    });

    test("un botón que no es del boleto no responde nada", async () => {
        const u = usuario();
        const i = interaccion(u, { customId: "combinada_desconocido" });
        const resultado = await combinada.handleButton(null, i);
        expect(resultado).toBeUndefined();
        expect(i.reply).not.toHaveBeenCalled();
        expect(i.update).not.toHaveBeenCalled();
        expect(i.showModal).not.toHaveBeenCalled();
    });
});

describe("el formulario de importe", () => {
    const formulario = (userId, valor) =>
        interaccion(userId, {
            customId: "combinada_modal_apostar",
            guildId: G,
            fields: { getStringSelectValues: () => null, getTextInputValue: () => valor },
        });

    test("un formulario con otro id no hace nada", async () => {
        const u = usuario();
        const i = interaccion(u, {
            customId: "otro_formulario",
            fields: { getStringSelectValues: () => null, getTextInputValue: () => "100" },
        });
        await combinada.handleModal(null, i);
        expect(i.reply).not.toHaveBeenCalled();
    });

    test("con un boleto válido registra la combinada, cobra el importe y confirma en privado", async () => {
        const u = usuario(1000);
        combinadas.sumar(u, partido(), "home"); // 2
        combinadas.sumar(u, partido(), "draw"); // 3
        const i = formulario(u, "100");
        await combinada.handleModal(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].data.title).toBe("✅ ¡Combinada registrada!");
        expect(payload.embeds[0].data.description).toMatch(/Cuota total:\*\* `6`/);
        expect(payload.embeds[0].data.description).toMatch(/Si aciertas todos:\*\* `600`/);
        expect(saldo(u)).toBe(900);
        expect(boletos(u)).toEqual([{ cantidad: 100, cuota: 6, estado: "abierta" }]);
        expect(combinadas.borrador(u)).toHaveLength(0);
    });

    test("sin patas suficientes, avisa en privado con el motivo", async () => {
        const u = usuario();
        combinadas.sumar(u, partido(), "home");
        const i = formulario(u, "100");
        await combinada.handleModal(null, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(descripcion(payload)).toMatch(/al menos \*\*2\*\* partidos/);
        expect(boletos(u)).toHaveLength(0);
    });

    test.each([
        ["5", "por debajo del mínimo"],
        ["1001", "por encima del máximo"],
        ["abc", "no es un número"],
    ])("importe no válido (%s, %s): avisa con el rango y no cobra", async (valor) => {
        const u = usuario(1000);
        combinadas.sumar(u, partido(), "home");
        combinadas.sumar(u, partido(), "draw");
        const i = formulario(u, valor);
        await combinada.handleModal(null, i);
        expect(descripcion(i.reply.mock.calls[0][0])).toMatch(
            new RegExp(`La cantidad debe estar entre ${combinadas.MIN_APUESTA} y ${combinadas.MAX_APUESTA} monedas`),
        );
        expect(saldo(u)).toBe(1000);
        expect(boletos(u)).toHaveLength(0);
    });

    test("en el límite exacto del mínimo sí se registra", async () => {
        const u = usuario(1000);
        combinadas.sumar(u, partido(), "home");
        combinadas.sumar(u, partido(), "draw");
        const i = formulario(u, String(combinadas.MIN_APUESTA));
        await combinada.handleModal(null, i);
        expect(i.reply.mock.calls[0][0].embeds[0].data.title).toBe("✅ ¡Combinada registrada!");
        expect(saldo(u)).toBe(1000 - combinadas.MIN_APUESTA);
    });

    test("sin efectivo suficiente, avisa de que hay que sacar del banco y no registra nada", async () => {
        const u = usuario(50);
        combinadas.sumar(u, partido(), "home");
        combinadas.sumar(u, partido(), "draw");
        const i = formulario(u, "100");
        await combinada.handleModal(null, i);
        expect(descripcion(i.reply.mock.calls[0][0])).toMatch(/No te llega el efectivo/);
        expect(saldo(u)).toBe(50);
        expect(boletos(u)).toHaveLength(0);
        expect(combinadas.borrador(u)).toHaveLength(2);
    });
});

test("los manejadores declaran sus rutas y cada método existe", () => {
    const metodos = combinada.componentHandlers.map((h) => h.method);
    expect(metodos).toEqual(["handleAbrir", "handleButton", "handleSumar", "handleModal"]);
    for (const m of metodos) expect(typeof combinada[m]).toBe("function");
    expect(combinada.componentHandlers[0]).toMatchObject({ ids: ["combinada_abrir"], acl: "juegos" });
});
