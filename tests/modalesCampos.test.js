// Campos de los modales del panel admin (adminPanel/common.js): texto como antes, y selectores de Discord (Sí/No,
// opciones cerradas, canal, rol y usuario) en su etiqueta, para no tener que escribir IDs a mano.
const { ComponentType } = require("discord.js");
const { modalConCampos, campoSelector, simpleModal } = require("../src/adminPanel/common");

const json = (modal) => modal.toJSON();

describe("texto libre (como simpleModal)", () => {
    test("un campo sin tipo sigue siendo una fila de texto", () => {
        const m = modalConCampos("m", "Prueba", [{ id: "nombre", label: "Nombre", maxLength: 20 }]);
        const fila = json(m).components[0];
        expect(fila.type).toBe(ComponentType.ActionRow);
        expect(fila.components[0]).toMatchObject({ custom_id: "nombre", max_length: 20 });
    });

    test("el modal con solo texto sale igual que con simpleModal", () => {
        const campos = [
            { id: "a", label: "Uno" },
            { id: "b", label: "Dos", paragraph: true },
        ];
        expect(json(modalConCampos("m", "T", campos))).toEqual(json(simpleModal("m", "T", campos)));
    });
});

describe("selectores", () => {
    test("Sí/No se pone como grupo de radio, con la opción actual marcada", () => {
        const m = modalConCampos("m", "T", [
            {
                id: "activo",
                label: "¿Activa?",
                tipo: "radio",
                opciones: [
                    { label: "Sí", value: "1" },
                    { label: "No", value: "0" },
                ],
                valor: "0",
            },
        ]);
        const etiqueta = json(m).components[0];
        expect(etiqueta.type).toBe(ComponentType.Label);
        expect(etiqueta.label).toBe("¿Activa?");
        expect(etiqueta.component).toMatchObject({ type: ComponentType.RadioGroup, custom_id: "activo", required: true });
        expect(etiqueta.component.options).toEqual([
            { label: "Sí", value: "1", default: false },
            { label: "No", value: "0", default: true },
        ]);
    });

    test("un canal solo deja elegir canales de texto", () => {
        const etiqueta = json(modalConCampos("m", "T", [{ id: "canal", label: "Canal", tipo: "canal", required: false }])).components[0];
        expect(etiqueta.component).toMatchObject({ type: ComponentType.ChannelSelect, custom_id: "canal", required: false });
        expect(etiqueta.component.channel_types).toEqual([0]);
    });

    test("un rol y un usuario salen como selectores de Discord", () => {
        const m = json(
            modalConCampos("m", "T", [
                { id: "rol", label: "Rol", tipo: "rol" },
                { id: "quien", label: "Persona", tipo: "usuario" },
            ]),
        );
        expect(m.components[0].component.type).toBe(ComponentType.RoleSelect);
        expect(m.components[1].component.type).toBe(ComponentType.UserSelect);
    });

    test("las opciones cerradas van en un desplegable", () => {
        const etiqueta = json(
            modalConCampos("m", "T", [
                {
                    id: "base",
                    label: "Base",
                    tipo: "opciones",
                    opciones: [
                        { label: "Ingreso", value: "ingreso" },
                        { label: "Compra", value: "compra" },
                    ],
                    valor: "compra",
                },
            ]),
        ).components[0];
        expect(etiqueta.component.type).toBe(ComponentType.StringSelect);
        expect(etiqueta.component.options.find((o) => o.default).value).toBe("compra");
    });

    test("una etiqueta de más de 45 caracteres se corta, que es el límite de Discord", () => {
        const etiqueta = campoSelector({ id: "x", label: "a".repeat(60), tipo: "usuario" }).toJSON();
        expect(etiqueta.label).toHaveLength(45);
    });

    test("un tipo que no existe da error en vez de un modal roto", () => {
        expect(() => campoSelector({ id: "x", label: "X", tipo: "inventado" })).toThrow(/sin selector/);
    });
});
