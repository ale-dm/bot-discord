// Panel admin → Impuestos (#238): añadir, activar/desactivar y quitar reglas (con validación de cada campo) y el
// impuesto de patrimonio. Cada cambio queda en la auditoría.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const impuestos = require("../src/systems/impuestos");
const patrimonio = require("../src/systems/patrimonio");
const { handleImpuestosButton, handleImpuestosModal } = require("../src/adminPanel/impuestos");

const G = "g-admin-impuestos";
const auditoria = (accion) => db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE guildId = ? AND action = ?").get(G, accion).n;
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

function interaccion(extra = {}) {
    return {
        customId: "",
        guildId: G,
        user: { id: "admin-imp", username: "admin", tag: "admin#0002" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        ...extra,
    };
}
// Un formulario con los valores dados (los que no se indican, vacíos).
function formulario(customId, valores) {
    return interaccion({
        customId,
        fields: { getTextInputValue: (campo) => valores[campo] ?? "", getRadioGroup: (campo) => valores[campo] ?? "" },
    });
}

describe("botones", () => {
    test("la pantalla principal muestra el bote y las acciones", async () => {
        const i = interaccion({ customId: "paneladmin_impuestos_home" });
        expect(await handleImpuestosButton(i)).toBe(true);
        expect(ultimo(i.update).embeds[0].data.title).toContain("Motor de impuestos");
    });

    test("el patrimonio muestra su configuración", async () => {
        const i = interaccion({ customId: "paneladmin_impuestos_patrimonio" });
        await handleImpuestosButton(i);
        expect(ultimo(i.update).embeds[0].data.title).toContain("patrimonio");
    });

    test("añadir, quitar, activar y editar el patrimonio abren su formulario", async () => {
        for (const id of [
            "paneladmin_impuestos_add",
            "paneladmin_impuestos_remove",
            "paneladmin_impuestos_toggle",
            "paneladmin_impuestos_patrimonio_edit",
        ]) {
            const i = interaccion({ customId: id });
            expect(await handleImpuestosButton(i)).toBe(true);
            expect(i.showModal).toHaveBeenCalledTimes(1);
        }
    });

    test("un botón que no es de impuestos no lo atiende", async () => {
        expect(await handleImpuestosButton(interaccion({ customId: "otra_cosa" }))).toBe(false);
    });
});

describe("añadir una regla", () => {
    test("la base tiene que ser ingreso o compra", async () => {
        const i = formulario("paneladmin_impuestos_add_modal", { base: "tienda", porcentaje: "5" });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toContain("ingreso");
    });

    test("un tipo de movimiento que no existe se rechaza", async () => {
        const i = formulario("paneladmin_impuestos_add_modal", { base: "ingreso", tipo: "inventado", porcentaje: "5" });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toContain("no es un tipo de movimiento válido");
    });

    test("el porcentaje tiene que estar entre 0 y 100, excluido el 0", async () => {
        for (const porcentaje of ["0", "101", "abc", ""]) {
            const i = formulario("paneladmin_impuestos_add_modal", { base: "ingreso", porcentaje });
            await handleImpuestosModal(i);
            expect(ultimo(i.reply).content).toContain("entre 0 y 100");
        }
    });

    test("una regla válida se crea (al bote por defecto) y se audita", async () => {
        const tipo = Object.keys(dinero.TIPOS)[0];
        const i = formulario("paneladmin_impuestos_add_modal", { base: "ingreso", tipo, porcentaje: "5", destino: "" });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toMatch(/Regla #\d+ añadida/);
        const regla = impuestos.listarReglas(G).find((r) => r.tipoMovimiento === tipo && r.porcentaje === 5);
        expect(regla.destino).toBe("bote");
        expect(auditoria("impuestos.add")).toBeGreaterThan(0);
    });
});

describe("quitar y activar reglas", () => {
    function reglaNueva() {
        const r = impuestos.anadirRegla(G, { base: "compra", tipoMovimiento: null, porcentaje: 3, destino: "sumidero" });
        return r.id;
    }

    test("quitar una regla que no existe avisa", async () => {
        const i = formulario("paneladmin_impuestos_remove_modal", { id: "999999" });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toContain("No hay ninguna regla");
    });

    test("quitar una regla que existe la borra y lo audita", async () => {
        const id = reglaNueva();
        const i = formulario("paneladmin_impuestos_remove_modal", { id: String(id) });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toContain("borrada");
        expect(impuestos.listarReglas(G).some((r) => r.id === id)).toBe(false);
        expect(auditoria("impuestos.remove")).toBeGreaterThan(0);
    });

    test("activar y desactivar una regla, con «sí» o «no»", async () => {
        const id = reglaNueva();
        const apagar = formulario("paneladmin_impuestos_toggle_modal", { id: String(id), activo: "no" });
        await handleImpuestosModal(apagar);
        expect(ultimo(apagar.reply).content).toContain("desactivada");
        const encender = formulario("paneladmin_impuestos_toggle_modal", { id: String(id), activo: "sí" });
        await handleImpuestosModal(encender);
        expect(ultimo(encender.reply).content).toContain("activada");
        expect(auditoria("impuestos.toggle")).toBeGreaterThanOrEqual(2);
    });

    test("activar una regla que no existe avisa", async () => {
        const i = formulario("paneladmin_impuestos_toggle_modal", { id: "999998", activo: "si" });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toContain("No hay ninguna regla");
    });
});

describe("impuesto de patrimonio", () => {
    const valido = { umbral: "5000", porcentaje: "10", interes: "1", dias: "7", destino: "bote" };

    test("con un valor no válido no guarda nada y lo dice", async () => {
        const antes = patrimonio.configuracion();
        const i = formulario("paneladmin_impuestos_patrimonio_modal", { ...valido, umbral: "-1" });
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content.startsWith("❌")).toBe(true);
        expect(patrimonio.configuracion()).toEqual(antes);
    });

    test("con valores válidos se guarda y se audita", async () => {
        const i = formulario("paneladmin_impuestos_patrimonio_modal", valido);
        await handleImpuestosModal(i);
        expect(ultimo(i.reply).content).toContain("guardado");
        expect(patrimonio.configuracion().umbral).toBe(5000);
        expect(auditoria("impuestos.patrimonio")).toBeGreaterThan(0);
    });
});
