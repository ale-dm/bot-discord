// Panel admin → Config Global → Duende → Apodos (adminPanel/apodos.js): ver quién tiene qué apodo, añadir (con selector
// de persona y formulario) y quitar, con su auditoría. Los permisos se comprueban por el router del panel
// (commands/admin/paneladmin), que es el que decide quién entra. Usa la BD en memoria real.
const db = require("../src/core/db");
const apodos = require("../src/systems/apodos");
const paneladmin = require("../src/commands/admin/paneladmin");
const { handleApodosButton, handleApodosUserSelect, handleApodosModal } = require("../src/adminPanel/apodos");

let n = 0;
const nuevoServidor = () => `g-apodos-panel-${++n}`;
const ADMIN = { has: (permiso) => permiso === "Administrator" };
const NO_ADMIN = { has: () => false };

function interaccion(extra = {}, { admin = true } = {}) {
    return {
        customId: "",
        guildId: "g-base",
        user: { id: "admin-1", username: "admin", tag: "admin#0001" },
        memberPermissions: admin ? ADMIN : NO_ADMIN,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        values: [],
        ...extra,
    };
}

function campos(valores) {
    return { getTextInputValue: (id) => valores[id] ?? "" };
}

const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const auditoria = (guildId, accion) =>
    db.prepare("SELECT details FROM admin_audit WHERE guildId = ? AND action = ? ORDER BY id DESC LIMIT 1").get(guildId, accion);

describe("permisos: solo un admin usa el panel de apodos", () => {
    test("un no admin no ve ni cambia nada en el botón de añadir", async () => {
        const i = interaccion({ customId: "paneladmin_apodos_add" }, { admin: false });

        await paneladmin.handleButton({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(i.reply.mock.calls[0][0].components).toBeUndefined();
    });

    test("un no admin no puede quitar un apodo desde el formulario", async () => {
        const g = nuevoServidor();
        apodos.anadir(g, "111111111111111111", "guardado");
        const i = interaccion(
            { guildId: g, customId: "paneladmin_apodos_remove_modal", fields: campos({ apodo: "guardado" }) },
            { admin: false },
        );

        await paneladmin.handleModal({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(apodos.resolver(g, "guardado")).toBe("111111111111111111");
    });

    test("un admin sí llega al formulario de quitar", async () => {
        const i = interaccion({ customId: "paneladmin_apodos_remove" });

        await paneladmin.handleButton({}, i);

        expect(i.showModal).toHaveBeenCalledTimes(1);
    });
});

describe("pantalla de apodos", () => {
    test("sin apodos lo dice", async () => {
        const i = interaccion({ guildId: nuevoServidor(), customId: "paneladmin_apodos_home" });

        await handleApodosButton(i);

        expect(ultimo(i.update).embeds[0].data.description).toContain("No hay apodos todavía.");
    });

    test("lista cada persona con su nombre y sus otros apodos; sin nombre lo indica", async () => {
        const g = nuevoServidor();
        apodos.anadir(g, "111111111111111111", "Raúl", true);
        apodos.anadir(g, "111111111111111111", "el marcos");
        apodos.anadir(g, "222222222222222222", "perro");
        const i = interaccion({ guildId: g, customId: "paneladmin_apodos_home" });

        await handleApodosButton(i);

        const texto = ultimo(i.update).embeds[0].data.description;
        expect(texto).toContain("• <@111111111111111111> — **Raúl** · el marcos");
        expect(texto).toContain("• <@222222222222222222> — **(sin nombre)** · perro");
    });

    test("una lista muy larga se corta y termina con …", async () => {
        const g = nuevoServidor();
        for (let k = 0; k < 200; k++) {
            const id = String(100000000000000000 + k);
            apodos.anadir(g, id, `Persona con un nombre bastante largo ${k}`, true);
            apodos.anadir(g, id, `apodo muy largo número ${k} para llenar la pantalla`);
        }
        const i = interaccion({ guildId: g, customId: "paneladmin_apodos_home" });

        await handleApodosButton(i);

        const texto = ultimo(i.update).embeds[0].data.description;
        expect(texto.endsWith("\n…")).toBe(true);
        expect(texto.length).toBeLessThanOrEqual(4096);
    });

    test("el botón de refrescar vuelve a pintar la pantalla con sus botones", async () => {
        const i = interaccion({ customId: "paneladmin_apodos_home" });

        await handleApodosButton(i);

        const ids = ultimo(i.update).components[0].components.map((b) => b.data.custom_id);
        expect(ids).toEqual(["paneladmin_apodos_add", "paneladmin_apodos_remove", "paneladmin_apodos_home", "paneladmin_cfg_duende"]);
    });
});

describe("botones de añadir y quitar", () => {
    test("añadir pide primero a la persona con un selector, en privado", async () => {
        const i = interaccion({ customId: "paneladmin_apodos_add" });

        await handleApodosButton(i);

        const respuesta = ultimo(i.reply);
        expect(respuesta.components[0].components[0].data.custom_id).toBe("paneladmin_apodos_add_select");
        expect(respuesta.flags).toBe(64);
    });

    test("quitar abre el formulario con el campo del apodo", async () => {
        const i = interaccion({ customId: "paneladmin_apodos_remove" });

        await handleApodosButton(i);

        const modal = ultimo(i.showModal);
        expect(modal.data.custom_id).toBe("paneladmin_apodos_remove_modal");
        expect(modal.components[0].components[0].data.custom_id).toBe("apodo");
    });

    test("un botón que no es de apodos no lo gestiona este módulo", async () => {
        expect(await handleApodosButton(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
    });
});

describe("selector de persona", () => {
    test("al elegir a alguien abre el formulario del apodo con el ID de esa persona", async () => {
        const i = interaccion({ customId: "paneladmin_apodos_add_select", values: ["333333333333333333"] });

        expect(await handleApodosUserSelect(i)).toBe(true);

        const modal = ultimo(i.showModal);
        expect(modal.data.custom_id).toBe("paneladmin_apodos_add_modal_333333333333333333");
        const campos_ = modal.components.map((f) => f.components[0].data.custom_id);
        expect(campos_).toEqual(["apodo", "principal"]);
    });

    test("ignora otros selectores", async () => {
        expect(await handleApodosUserSelect(interaccion({ customId: "otro", values: ["1"] }))).toBe(false);
    });
});

describe("formulario de quitar apodo", () => {
    test("quita el apodo, avisa de quién era y lo audita", async () => {
        const g = nuevoServidor();
        apodos.anadir(g, "444444444444444444", "coneyo");
        const i = interaccion({ guildId: g, customId: "paneladmin_apodos_remove_modal", fields: campos({ apodo: "  Coneyo " }) });

        expect(await handleApodosModal(i)).toBe(true);

        expect(apodos.resolver(g, "coneyo")).toBeNull();
        expect(ultimo(i.reply).content).toBe('✅ Quitado "Coneyo" de <@444444444444444444>.');
        expect(JSON.parse(auditoria(g, "duende.apodo.remove").details)).toEqual({
            apodo: "Coneyo",
            discordId: "444444444444444444",
        });
    });

    test("un apodo que no existe no toca nada", async () => {
        const g = nuevoServidor();
        const i = interaccion({ guildId: g, customId: "paneladmin_apodos_remove_modal", fields: campos({ apodo: "fantasma" }) });

        await handleApodosModal(i);

        expect(ultimo(i.reply).content).toBe('❌ No hay ningún apodo "fantasma".');
        expect(auditoria(g, "duende.apodo.remove")).toBeUndefined();
    });
});

describe("formulario de añadir apodo", () => {
    function formulario(id, { apodo = "", principal = "" } = {}) {
        return interaccion({ customId: id, fields: campos({ apodo, principal }) });
    }

    test("sin nombre de apodo (o solo espacios) avisa y no guarda", async () => {
        const g = nuevoServidor();
        const i = formulario("paneladmin_apodos_add_modal_555555555555555555", { apodo: "   " });
        i.guildId = g;

        await handleApodosModal(i);

        expect(ultimo(i.reply).content).toBe("❌ Apodo vacío.");
        expect(apodos.resolver(g, "algo")).toBeNull();
    });

    test("un apodo nuevo se guarda sin ser principal por defecto", async () => {
        const g = nuevoServidor();
        const i = formulario("paneladmin_apodos_add_modal_555555555555555555", { apodo: "coneyo" });
        i.guildId = g;

        await handleApodosModal(i);

        expect(apodos.resolver(g, "coneyo")).toBe("555555555555555555");
        expect(apodos.nombreDe(g, "555555555555555555")).toBeNull();
        expect(ultimo(i.reply).content).toBe('✅ "coneyo" → <@555555555555555555>.');
    });

    test.each(["sí", "Si", "y", "YES", "1"])(
        "con «%s» en principal el apodo es el nombre con el que llama el Duende",
        async (respuesta) => {
            const g = nuevoServidor();
            const i = formulario("paneladmin_apodos_add_modal_555555555555555555", { apodo: "Raúl", principal: respuesta });
            i.guildId = g;

            await handleApodosModal(i);

            expect(apodos.nombreDe(g, "555555555555555555")).toBe("Raúl");
            expect(ultimo(i.reply).content).toContain("(su nombre)");
            expect(JSON.parse(auditoria(g, "duende.apodo.add").details)).toMatchObject({ principal: true });
        },
    );

    test.each(["no", "quizá", "si, claro"])("con «%s» en principal no es el nombre", async (respuesta) => {
        const g = nuevoServidor();
        const i = formulario("paneladmin_apodos_add_modal_555555555555555555", { apodo: "perro", principal: respuesta });
        i.guildId = g;

        await handleApodosModal(i);

        expect(apodos.nombreDe(g, "555555555555555555")).toBeNull();
        expect(ultimo(i.reply).content).not.toContain("(su nombre)");
    });

    test("si el apodo ya era de otra persona, lo cambia y lo dice", async () => {
        const g = nuevoServidor();
        apodos.anadir(g, "666666666666666666", "perro");
        const i = formulario("paneladmin_apodos_add_modal_777777777777777777", { apodo: "perro" });
        i.guildId = g;

        await handleApodosModal(i);

        expect(apodos.resolver(g, "perro")).toBe("777777777777777777");
        expect(ultimo(i.reply).content).toContain("Antes era de <@666666666666666666>.");
        expect(JSON.parse(auditoria(g, "duende.apodo.add").details)).toMatchObject({ antesDe: "666666666666666666" });
    });

    test("un apodo de más de 60 caracteres se recorta antes de guardarlo", async () => {
        const g = nuevoServidor();
        const largo = "a".repeat(80);
        const i = formulario("paneladmin_apodos_add_modal_555555555555555555", { apodo: largo });
        i.guildId = g;

        await handleApodosModal(i);

        const guardado = apodos.listar(g)[0].apodo;
        expect(guardado).toHaveLength(60);
    });

    test("un formulario que no es de apodos no lo gestiona este módulo", async () => {
        expect(await handleApodosModal(interaccion({ customId: "paneladmin_otro_modal" }))).toBe(false);
    });
});
