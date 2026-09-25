// Parte 5 del plan de paneles: 💵 efectivo (lo que se gasta) y 🏦 banco (el sitio seguro).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const tx = require("../src/systems/casinoTransactions");
const banco = require("../src/commands/economia/banco");
const casino = require("../src/paneles/casino");

let n = 0;
function persona({ efectivo = 0, enBanco = 0 } = {}) {
    const id = `p5-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, ?, ?)").run(id, enBanco, efectivo);
    return id;
}

describe("systems/dinero", () => {
    test("una cuenta nueva empieza con el dinero inicial en efectivo y el banco vacío", () => {
        expect(dinero.cuenta("nuevo-p5")).toEqual({ efectivo: dinero.INICIAL, banco: 0, total: dinero.INICIAL });
    });

    test("ingresar y sacar mueven entre efectivo y banco, sin pasarse de lo que hay", () => {
        const u = persona({ efectivo: 500 });
        expect(dinero.ingresar(u, 300)).toMatchObject({ ok: true, cuenta: { efectivo: 200, banco: 300 } });
        expect(dinero.ingresar(u, 300).ok).toBe(false);
        expect(dinero.sacar(u, 100)).toMatchObject({ ok: true, cuenta: { efectivo: 300, banco: 200 } });
        expect(dinero.sacar(u, 1000).ok).toBe(false);
        expect(dinero.sacar(u, -5).ok).toBe(false);
        const mov = dinero.movimientos(u, { tipo: "banco" });
        expect(mov.filas.map((m) => [m.descripcion, m.cantidad])).toEqual([
            ["Retirada del banco", 100],
            ["Ingreso en el banco", -300],
        ]);
    });

    test("cobrar no deja el efectivo en negativo y no toca el banco", () => {
        const u = persona({ efectivo: 50, enBanco: 10000 });
        expect(dinero.cobrar(u, 100)).toBe(false);
        expect(dinero.cobrar(u, 50)).toBe(true);
        expect(dinero.cuenta(u)).toMatchObject({ efectivo: 0, banco: 10000 });
    });

    test("transferir va de efectivo a efectivo, todo o nada", () => {
        const a = persona({ efectivo: 300, enBanco: 5000 });
        const b = persona();
        expect(dinero.transferir(a, b, 500).ok).toBe(false); // el banco no cuenta
        expect(dinero.transferir(a, a, 10).ok).toBe(false);
        expect(dinero.transferir(a, b, 200, { de: "A", a: "B" }).ok).toBe(true);
        expect(dinero.cuenta(a)).toMatchObject({ efectivo: 100, banco: 5000 });
        expect(dinero.cuenta(b).efectivo).toBe(200);
        expect(dinero.movimientos(b, { tipo: "transferencia" }).filas[0].descripcion).toBe("Transferencia recibida de A");
    });

    test("los más ricos cuentan efectivo y banco", () => {
        const rico = persona({ efectivo: 1, enBanco: 9_000_000 });
        expect(dinero.masRicos(1)[0]).toMatchObject({ userId: rico, total: 9_000_001 });
    });
});

test("el casino juega con el efectivo: con dinero solo en el banco no se puede apostar", () => {
    const u = persona({ enBanco: 5000 });
    expect(tx.descontarApuesta(u, 100, "g-p5").mensaje).toMatch(/No te llega el efectivo/);
    dinero.sacar(u, 100);
    expect(tx.descontarApuesta(u, 100, "g-p5").exito).toBe(true);
    expect(dinero.cuenta(u)).toMatchObject({ efectivo: 0, banco: 4900 });
});

describe("/banco (panel de Economía)", () => {
    const interaccion = (userId, extra = {}) => ({
        user: { id: userId, username: userId, tag: userId },
        guildId: "g-p5",
        message: { interaction: { user: { id: userId } } },
        client: { users: { fetch: async (id) => ({ id, username: `nombre-${id}` }) } },
        isFromMessage: () => true,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        ...extra,
    });
    const modal = (userId, customId, cantidad) => interaccion(userId, { customId, fields: { getTextInputValue: () => String(cantidad) } });
    const campos = (payload) => Object.fromEntries(payload.embeds[0].data.fields.map((f) => [f.name, f.value]));
    const num = (texto) => Number(texto.replace(/[^\d]/g, ""));

    test("enseña efectivo, banco y total, e ingresar actualiza el panel", async () => {
        const u = persona({ efectivo: 1000, enBanco: 200 });
        const i = interaccion(u);
        await banco.run(null, i);
        const c = campos(i.reply.mock.calls[0][0]);
        expect([num(c["💵 Efectivo"]), num(c["🏦 Banco"]), num(c["💰 Total"])]).toEqual([1000, 200, 1200]);

        const ingreso = modal(u, "dinero_modal_ingresar", 600);
        await banco.handleModal(null, ingreso);
        expect(num(campos(ingreso.update.mock.calls[0][0])["🏦 Banco"])).toBe(800);
    });

    test("💵 Sacar del banco desde el casino vuelve a pintar el selector de importes", async () => {
        const u = persona({ efectivo: 0, enBanco: 1000 });
        const pick = casino.buildPickApuesta(u, "blackjack");
        const ids = pick.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
        expect(ids).toContain("dinero_sacar_casino_pick_blackjack");

        const boton = interaccion(u, { customId: "dinero_sacar_casino_pick_blackjack" });
        await banco.handleButton(null, boton);
        expect(boton.showModal.mock.calls[0][0].data.custom_id).toBe("dinero_modal_sacar_casino_pick_blackjack");

        const envio = modal(u, "dinero_modal_sacar_casino_pick_blackjack", 500);
        await banco.handleModal(null, envio);
        const repintado = envio.update.mock.calls[0][0];
        expect(repintado.embeds[0].data.title).toMatch(/Elige tu apuesta/);
        // Con 500 de efectivo, los botones de 50, 100 y 500 ya se pueden pulsar.
        expect(repintado.components[0].components.map((b) => b.data.disabled)).toEqual([false, false, false, true, true]);
        expect(envio.followUp.mock.calls[0][0].content).toMatch(/Has sacado/);
    });

    test("transferir: se elige a quién y la cantidad", async () => {
        const u = persona({ efectivo: 400 });
        const destino = persona();
        const elegir = interaccion(u, { customId: "dinero_transferir_a", users: { first: () => ({ id: destino, bot: false }) } });
        await banco.handleSelect(null, elegir);
        expect(elegir.showModal.mock.calls[0][0].data.custom_id).toBe(`dinero_modal_transferir_${destino}`);

        await banco.handleModal(null, modal(u, `dinero_modal_transferir_${destino}`, 150));
        expect(dinero.efectivo(destino)).toBe(150);
        const mov = dinero.movimientos(u, { tipo: "transferencia" }).filas[0];
        expect(mov).toMatchObject({ descripcion: `Transferencia a nombre-${destino}`, cantidad: -150 });
    });

    test("Movimientos se filtran por tipo, y solo quien abrió el panel usa sus botones", async () => {
        const u = persona({ efectivo: 1000 });
        dinero.ingresar(u, 100);
        tx.procesarPerdida(u, "ruleta", 50, "Ruleta: perdiste 50", {});
        const filtro = interaccion(u, { customId: "dinero_filtro", values: ["casino"] });
        await banco.handleSelect(null, filtro);
        const texto = filtro.update.mock.calls[0][0].embeds[0].data.description;
        expect(texto).toMatch(/Ruleta: perdiste 50/);
        expect(texto).not.toMatch(/Ingreso/);

        const intruso = interaccion("otro", { customId: "dinero_ricos", message: { interaction: { user: { id: u } } } });
        await banco.handleButton(null, intruso);
        expect(intruso.update).not.toHaveBeenCalled();
    });
});
