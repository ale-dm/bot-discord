// Panel admin → Banco (#238): cambiar saldos (solo los destinos válidos), resetear o borrar el historial con
// confirmación, buscar usuario y el historial global. Cada acción que cambia dinero deja rastro en la auditoría.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const { handleBankButton, handleBankModal, handleBankUserSelect } = require("../src/adminPanel/bank");

const G = "g-admin-banco";
let n = 0;
const uid = () => `ban-${++n}`;

function alguien(saldo = 500, enMano = 300, negro = 40) {
    const id = uid();
    db.prepare("INSERT INTO banco (userId, saldo, enMano, negro) VALUES (?, ?, ?, ?)").run(id, saldo, enMano, negro);
    return id;
}
const fila = (id) => db.prepare("SELECT saldo, enMano, negro FROM banco WHERE userId = ?").get(id);
const auditoria = (accion) => db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE guildId = ? AND action = ?").get(G, accion).n;

function interaccion(extra = {}) {
    return {
        customId: "",
        guildId: G,
        guild: { id: G, members: { fetch: jest.fn(async () => null), cache: { find: () => undefined } } },
        user: { id: "admin-1", username: "admin", tag: "admin#0001" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        values: [],
        ...extra,
    };
}
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

describe("botones del panel de banco", () => {
    test("modificar, resetear y borrar historial piden primero el usuario con un selector", async () => {
        for (const id of ["paneladmin_bank_modificar", "paneladmin_bank_resetear", "paneladmin_bank_borrarhistorial"]) {
            const i = interaccion({ customId: id });
            expect(await handleBankButton(i)).toBe(true);
            expect(i.reply).toHaveBeenCalledTimes(1);
            expect(ultimo(i.reply).components[0].components[0].data.custom_id).toMatch(/^paneladmin_bank_\w+_select$/);
        }
    });

    test("cancelar cierra la acción sin tocar nada", async () => {
        const i = interaccion({ customId: "paneladmin_cancel" });
        await handleBankButton(i);
        expect(ultimo(i.update).embeds[0].data.title).toContain("cancelada");
    });

    test("buscar usuario abre el formulario", async () => {
        const i = interaccion({ customId: "paneladmin_bank_buscarusuario" });
        await handleBankButton(i);
        expect(i.showModal).toHaveBeenCalledTimes(1);
    });

    test("el historial global pagina con los botones de anterior y siguiente", async () => {
        const u = alguien();
        for (let k = 0; k < 12; k++) {
            db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, ?, ?, 'otro')").run(
                u,
                new Date(Date.now() - k * 1000).toISOString(),
                `movimiento ${k}`,
                k % 2 ? 10 : -10,
            );
        }
        const primera = interaccion({ customId: "paneladmin_bank_historialglobal" });
        await handleBankButton(primera);
        expect(ultimo(primera.reply).embeds[0].data.footer.text).toMatch(/Página 1\/\d+/);
        const segunda = interaccion({ customId: "paneladmin_bank_historialglobal_page_1" });
        await handleBankButton(segunda);
        expect(ultimo(segunda.update).embeds[0].data.footer.text).toMatch(/Página 2\//);
    });

    test("confirmar el reseteo deja la cuenta como nueva y lo audita", async () => {
        const u = alguien(9000, 9000, 9000);
        const i = interaccion({ customId: `paneladmin_bank_confirm_reset_${u}` });
        await handleBankButton(i);
        expect(fila(u)).toEqual({ saldo: 0, enMano: dinero.INICIAL, negro: 0 });
        expect(auditoria("bank.user.reset")).toBeGreaterThan(0);
    });

    test("confirmar el borrado de historial lo borra y lo audita", async () => {
        const u = alguien();
        db.prepare("INSERT INTO historial (userId, fecha, descripcion, cantidad, tipo) VALUES (?, ?, 'x', 1, 'otro')").run(
            u,
            new Date().toISOString(),
        );
        const i = interaccion({ customId: `paneladmin_bank_confirm_borrar_${u}` });
        await handleBankButton(i);
        expect(db.prepare("SELECT COUNT(*) AS n FROM historial WHERE userId = ?").get(u).n).toBe(0);
        expect(auditoria("bank.history.clear")).toBeGreaterThan(0);
    });
});

describe("selectores de usuario", () => {
    test("elegir a quien modificar abre el formulario de saldo", async () => {
        const i = interaccion({ customId: "paneladmin_bank_modificar_select", values: ["123"] });
        await handleBankUserSelect(i);
        expect(i.showModal).toHaveBeenCalledTimes(1);
    });

    test("elegir a quien resetear o borrar pide confirmación con sí y cancelar", async () => {
        for (const id of ["paneladmin_bank_resetear_select", "paneladmin_bank_borrarhistorial_select"]) {
            const i = interaccion({ customId: id, values: ["123"] });
            await handleBankUserSelect(i);
            const filas = ultimo(i.reply).components;
            expect(filas[0].components).toHaveLength(2);
        }
    });
});

describe("formulario de saldo", () => {
    function formulario(u, cantidad, tipo) {
        return interaccion({
            customId: `paneladmin_bank_modificar_modal_${u}`,
            fields: { getTextInputValue: (c) => (c === "cantidad" ? String(cantidad) : tipo) },
        });
    }

    test("suma al destino elegido: efectivo, banco o dinero negro", async () => {
        const u = alguien(500, 300, 40);
        await handleBankModal(formulario(u, 100, "efectivo"));
        expect(fila(u).enMano).toBe(400);
        await handleBankModal(formulario(u, 50, "banco"));
        expect(fila(u).saldo).toBe(550);
        await handleBankModal(formulario(u, -10, "negro"));
        expect(fila(u).negro).toBe(30);
        expect(auditoria("bank.balance.modify")).toBeGreaterThanOrEqual(3);
    });

    test("un destino que no existe no cambia nada y lo dice", async () => {
        const u = alguien(500, 300, 40);
        const i = formulario(u, 100, "tarjeta");
        await handleBankModal(i);
        expect(ultimo(i.reply).content).toContain("Tipo inválido");
        expect(fila(u)).toEqual({ saldo: 500, enMano: 300, negro: 40 });
    });

    test("buscar por ID encuentra a la persona y muestra su saldo", async () => {
        const id = "12345678901234567";
        db.prepare("INSERT INTO banco (userId, saldo, enMano, negro) VALUES (?, 777, 111, 22)").run(id);
        const i = interaccion({
            customId: "paneladmin_bank_buscarusuario_modal",
            fields: { getTextInputValue: () => id },
        });
        i.guild.members.fetch = jest.fn(async () => ({ id, user: { tag: "x#1", username: "x" } }));
        await handleBankModal(i);
        expect(ultimo(i.reply).embeds[0].data.description).toContain("Efectivo: **111**");
    });

    test("buscar por tag encuentra a la persona en la caché del servidor", async () => {
        const id = "22345678901234567";
        db.prepare("INSERT INTO banco (userId, saldo, enMano, negro) VALUES (?, 5, 6, 7)").run(id);
        const i = interaccion({
            customId: "paneladmin_bank_buscarusuario_modal",
            fields: { getTextInputValue: () => "Alex#1234" },
        });
        i.guild.members.cache.find = () => ({ id, user: { tag: "Alex#1234", username: "Alex" } });
        await handleBankModal(i);
        expect(ultimo(i.reply).embeds[0].data.description).toContain("Efectivo: **6**");
    });

    test("un usuario que no existe avisa", async () => {
        const i = interaccion({
            customId: "paneladmin_bank_buscarusuario_modal",
            fields: { getTextInputValue: () => "nadie#0000" },
        });
        await handleBankModal(i);
        expect(ultimo(i.reply).content).toContain("Usuario no encontrado");
    });
});
