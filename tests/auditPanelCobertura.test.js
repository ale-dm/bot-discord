// Panel admin → Auditoría (adminPanel/audit.js): ver las últimas acciones de admin en páginas de 10, con anterior,
// siguiente y refrescar. Los permisos se comprueban por el router del panel. Usa la BD en memoria real.
const adminAudit = require("../src/systems/adminAudit");
const paneladmin = require("../src/commands/admin/paneladmin");
const { handleAuditButton } = require("../src/adminPanel/audit");

let n = 0;
const nuevoServidor = () => `g-audit-panel-${++n}`;
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

const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const pie = (payload) => payload.embeds[0].data.footer.text;
const lineas = (payload) => payload.embeds[0].data.description.split("\n");
const botones = (payload) => payload.components[0].components.map((b) => b.data);

function llenar(guildId, cantidad, { accion = (i) => `accion.${i}` } = {}) {
    for (let i = 0; i < cantidad; i++) {
        adminAudit.logAdminAction({ guildId, actorId: "admin-1", action: accion(i), details: { i } });
    }
}

describe("permisos: solo un admin ve la auditoría", () => {
    test("un no admin recibe 'No tienes permisos.' y no ve nada", async () => {
        const g = nuevoServidor();
        llenar(g, 3);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit" }, { admin: false });

        await paneladmin.handleButton({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(i.update).not.toHaveBeenCalled();
    });

    test("un admin ve la auditoría", async () => {
        const i = interaccion({ guildId: nuevoServidor(), customId: "paneladmin_audit" });

        await paneladmin.handleButton({}, i);

        expect(i.update).toHaveBeenCalledTimes(1);
    });
});

describe("primera página", () => {
    test("sin registros lo dice y deja la página 1 de 1", async () => {
        const i = interaccion({ guildId: nuevoServidor(), customId: "paneladmin_audit" });

        await handleAuditButton(i);

        const payload = ultimo(i.update);
        expect(payload.embeds[0].data.title).toBe("🧾 Auditoría Admin");
        expect(payload.embeds[0].data.description).toBe("Sin registros todavía.");
        expect(pie(payload)).toBe("Página 1/1");
        const [anterior, refrescar, siguiente] = botones(payload);
        expect(anterior.disabled).toBe(true);
        expect(refrescar.custom_id).toBe("paneladmin_audit_refresh");
        expect(siguiente.disabled).toBe(true);
    });

    test("muestra 10 acciones por página, la más reciente primero, con quién y cuándo", async () => {
        const g = nuevoServidor();
        llenar(g, 25);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit" });

        await handleAuditButton(i);

        const payload = ultimo(i.update);
        const filas = lineas(payload);
        expect(filas).toHaveLength(10);
        expect(filas[0]).toContain("• <@admin-1> · **accion.24** ·");
        expect(filas[0]).toContain('· {"i":24}');
        expect(pie(payload)).toBe("Página 1/3");
    });

    test("los detalles largos se recortan a 90 caracteres", async () => {
        const g = nuevoServidor();
        const largo = "x".repeat(300);
        adminAudit.logAdminAction({ guildId: g, actorId: "admin-1", action: "texto.largo", details: { texto: largo } });
        const i = interaccion({ guildId: g, customId: "paneladmin_audit_refresh" });

        await handleAuditButton(i);

        const json = JSON.stringify({ texto: largo }).slice(0, 90);
        expect(lineas(ultimo(i.update))[0].endsWith(`· ${json}`)).toBe(true);
    });

    test("una acción sin detalles no lleva el separador de detalles", async () => {
        const g = nuevoServidor();
        adminAudit.logAdminAction({ guildId: g, actorId: "admin-1", action: "sin.detalles" });
        const i = interaccion({ guildId: g, customId: "paneladmin_audit" });

        await handleAuditButton(i);

        const [fila] = lineas(ultimo(i.update));
        expect(fila).toMatch(/\*\*sin\.detalles\*\* · \d/);
        expect(fila.split(" · ")).toHaveLength(3);
    });

    // BUG (no corregido, src/adminPanel/audit.js línea 5): el panel pide `listRecent(guildId, 200)`, pero
    // src/systems/adminAudit.js limita `listRecent` a 100 (Math.min(100, ...)). Así el panel solo navega por las 100
    // más recientes (10 páginas, no 20). Se deja como test.failing: pasa mientras el fallo exista.
    test.failing("pagina hasta 200 acciones, que es lo que pide el panel", async () => {
        const g = nuevoServidor();
        llenar(g, 205);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit" });

        await handleAuditButton(i);

        expect(pie(ultimo(i.update))).toBe("Página 1/20");
    });

    test("con más de 100 acciones, la primera página muestra las más recientes", async () => {
        const g = nuevoServidor();
        llenar(g, 105);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit" });

        await handleAuditButton(i);

        expect(lineas(ultimo(i.update))[0]).toContain("**accion.104**");
    });
});

describe("navegación entre páginas", () => {
    test("la página siguiente muestra la siguiente tanda y tiene anterior activo", async () => {
        const g = nuevoServidor();
        llenar(g, 25);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit_page_1" });

        await handleAuditButton(i);

        const payload = ultimo(i.update);
        expect(pie(payload)).toBe("Página 2/3");
        expect(lineas(payload)[0]).toContain("**accion.14**");
        const [anterior, , siguiente] = botones(payload);
        expect(anterior.custom_id).toBe("paneladmin_audit_page_0");
        expect(anterior.disabled).toBe(false);
        expect(siguiente.disabled).toBe(false);
    });

    test("en la última página no hay siguiente", async () => {
        const g = nuevoServidor();
        llenar(g, 25);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit_page_2" });

        await handleAuditButton(i);

        const payload = ultimo(i.update);
        expect(pie(payload)).toBe("Página 3/3");
        expect(lineas(payload)).toHaveLength(5);
        expect(botones(payload)[2].disabled).toBe(true);
    });

    test("una página fuera de rango se ajusta a la última", async () => {
        const g = nuevoServidor();
        llenar(g, 25);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit_page_99" });

        await handleAuditButton(i);

        expect(pie(ultimo(i.update))).toBe("Página 3/3");
    });

    test("una página negativa o que no es número vuelve a la primera", async () => {
        const g = nuevoServidor();
        llenar(g, 25);

        const negativa = interaccion({ guildId: g, customId: "paneladmin_audit_page_-1" });
        await handleAuditButton(negativa);
        expect(pie(ultimo(negativa.update))).toBe("Página 1/3");
        expect(botones(ultimo(negativa.update))[0].disabled).toBe(true);

        const rota = interaccion({ guildId: g, customId: "paneladmin_audit_page_xx" });
        await handleAuditButton(rota);
        expect(pie(ultimo(rota.update))).toBe("Página 1/3");
    });

    test("refrescar vuelve a la primera página", async () => {
        const g = nuevoServidor();
        llenar(g, 25);
        const i = interaccion({ guildId: g, customId: "paneladmin_audit_refresh" });

        await handleAuditButton(i);

        expect(pie(ultimo(i.update))).toBe("Página 1/3");
    });

    test("el botón de volver lleva al panel principal", async () => {
        const i = interaccion({ guildId: nuevoServidor(), customId: "paneladmin_audit" });

        await handleAuditButton(i);

        expect(botones(ultimo(i.update))[3].custom_id).toBe("paneladmin_home");
    });
});

describe("otros botones", () => {
    test("un botón que no es de la auditoría no lo gestiona este módulo", async () => {
        expect(await handleAuditButton(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
    });
});
