// Ayudas de registro (core/interactionLog.js): quién y dónde (whoWhere), el comando con sus opciones tal como se
// escribió, el tipo de componente y lo que se eligió en él, el recorte de textos y la ejecución registrada de tareas
// periódicas. El logger se simula para poder comprobar qué se registra.
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock("../src/core/logger", () => ({ createLogger: () => mockLogger }));

const log = require("../src/core/interactionLog");

beforeEach(() => {
    for (const fn of Object.values(mockLogger)) fn.mockClear();
});

describe("whoWhere: quién y dónde", () => {
    test("usuario con etiqueta, canal con nombre y servidor", () => {
        const i = {
            user: { id: "42", tag: "alex#0001", username: "alex" },
            channel: { id: "7", name: "general" },
            guild: { name: "Servidor" },
        };
        expect(log.whoWhere(i)).toBe("alex#0001 (42) en #general @ Servidor");
    });

    test("sin etiqueta usa el nombre de usuario; en un mensaje, el autor", () => {
        const mensaje = { author: { id: "9", username: "bea" }, channel: { id: "c9" }, guild: null };
        expect(log.whoWhere(mensaje)).toBe("bea (9) en canal c9 (DM)");
    });

    test("sin datos de usuario, canal ni servidor lo dice", () => {
        expect(log.whoWhere({})).toBe("usuario desconocido en sin canal (DM)");
    });
});

describe("describeCommand: el comando como lo escribió quien lo usó", () => {
    const cmd = (options) => ({ commandName: "banco", options: { data: options } });

    test("sin opciones es solo el nombre", () => {
        expect(log.describeCommand({ commandName: "ayuda", options: {} })).toBe("/ayuda");
        expect(log.describeCommand({ commandName: "ayuda" })).toBe("/ayuda");
    });

    test("subcomando con sus opciones (usuario, número)", () => {
        const i = cmd([
            {
                name: "transferir",
                type: 1,
                options: [
                    { name: "usuario", type: 6, value: "123", user: { username: "ana" } },
                    { name: "cantidad", type: 4, value: 500 },
                ],
            },
        ]);
        expect(log.describeCommand(i)).toBe("/banco transferir usuario=@ana cantidad=500");
    });

    test("grupo de subcomandos se recorre por niveles", () => {
        const i = cmd([
            { name: "ajustes", type: 2, options: [{ name: "canal", type: 1, options: [{ name: "valor", type: 3, value: "x" }] }] },
        ]);
        expect(log.describeCommand(i)).toBe("/banco ajustes canal valor=x");
    });

    test("canal, rol y adjunto se escriben con su marca", () => {
        const i = cmd([
            { name: "canal", type: 7, channel: { id: "11", name: "general" } },
            { name: "canal2", type: 7, channel: { id: "12" } },
            { name: "rol", type: 8, role: { name: "Mods" } },
            { name: "foto", type: 11, attachment: { name: "a.png" } },
        ]);
        expect(log.describeCommand(i)).toBe("/banco canal=#general canal2=#12 rol=@&Mods foto=[adjunto a.png]");
    });

    test("un valor de texto largo se recorta a 80 caracteres con puntos suspensivos", () => {
        const i = cmd([{ name: "texto", type: 3, value: "x".repeat(100) }]);
        expect(log.describeCommand(i)).toBe(`/banco texto=${"x".repeat(80)}…`);
    });

    test("el cero y la falsedad se escriben como valores, no se pierden", () => {
        const i = cmd([
            { name: "cantidad", type: 4, value: 0 },
            { name: "activo", type: 5, value: false },
        ]);
        expect(log.describeCommand(i)).toBe("/banco cantidad=0 activo=false");
    });

    test("un subcomando sin opciones se queda en su nombre", () => {
        expect(log.describeCommand(cmd([{ name: "ver", type: 1 }]))).toBe("/banco ver");
    });
});

describe("componentKind y describeComponentInput", () => {
    test("reconoce el tipo de componente por su método", () => {
        expect(log.componentKind({ isButton: () => true })).toBe("botón");
        expect(log.componentKind({ isStringSelectMenu: () => true })).toBe("select");
        expect(log.componentKind({ isUserSelectMenu: () => true })).toBe("select de usuario");
        expect(log.componentKind({ isRoleSelectMenu: () => true })).toBe("select de rol");
        expect(log.componentKind({ isChannelSelectMenu: () => true })).toBe("select de canal");
        expect(log.componentKind({ isModalSubmit: () => true })).toBe("formulario");
        expect(log.componentKind({})).toBe("componente");
    });

    test("un select registra los valores elegidos, recortados a 40 caracteres", () => {
        const i = { values: ["uno", "x".repeat(60)] };
        expect(log.describeComponentInput(i)).toBe(` valores=[uno, ${"x".repeat(40)}…]`);
    });

    test("un formulario registra sus campos, recortados a 60 caracteres", () => {
        const campos = new Map([
            ["nombre", { customId: "nombre", value: "Ana" }],
            ["texto", { customId: "texto", value: "y".repeat(70) }],
        ]);
        const i = { isModalSubmit: () => true, fields: { fields: campos } };
        expect(log.describeComponentInput(i)).toBe(` campos={nombre=Ana, texto=${"y".repeat(60)}…}`);
    });

    test("un formulario sin campos no añade nada", () => {
        expect(log.describeComponentInput({ isModalSubmit: () => true, fields: { fields: new Map() } })).toBe("");
        expect(log.describeComponentInput({ isModalSubmit: () => true })).toBe("");
    });

    test("un select sin valores o un botón no añaden nada", () => {
        expect(log.describeComponentInput({ values: [] })).toBe("");
        expect(log.describeComponentInput({ isButton: () => true })).toBe("");
    });
});

describe("cut", () => {
    test("un texto corto sale igual y lo que no es texto se convierte", () => {
        expect(log.cut("hola")).toBe("hola");
        expect(log.cut(12)).toBe("12");
        expect(log.cut(null)).toBe("");
        expect(log.cut(undefined)).toBe("");
    });

    test("el límite exacto no se recorta; uno más sí", () => {
        expect(log.cut("a".repeat(80))).toBe("a".repeat(80));
        expect(log.cut("a".repeat(81))).toBe(`${"a".repeat(80)}…`);
    });

    test("admite otro límite", () => {
        expect(log.cut("abcdef", 3)).toBe("abc…");
    });
});

describe("runJob: tareas periódicas", () => {
    test("devuelve el resultado y registra inicio y fin correcto", async () => {
        await expect(log.runJob("limpieza", async () => 42)).resolves.toBe(42);
        expect(mockLogger.debug).toHaveBeenCalledWith("limpieza: inicio");
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringMatching(/^limpieza: ok \(\d+ ms\)$/));
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test("una función que no es asíncrona también vale", async () => {
        await expect(log.runJob("sincrona", () => "listo")).resolves.toBe("listo");
    });

    test("si falla, registra el error con su traza y devuelve undefined sin lanzar", async () => {
        const error = new Error("BD bloqueada");
        await expect(
            log.runJob("sincronizar", async () => {
                throw error;
            }),
        ).resolves.toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/^sincronizar: falló tras \d+ ms$/), error);
    });

    test("si tarda más del umbral, avisa con el tiempo que tardó", async () => {
        await log.runJob("lenta", () => new Promise((r) => setTimeout(r, 20)), { slowMs: 5 });
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/^lenta: terminó pero tardó \d+ ms$/));
        expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringMatching(/^lenta: ok/));
    });

    test("por defecto el umbral son 30 segundos: una tarea rápida no avisa", async () => {
        await log.runJob("rapida", async () => {});
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });
});
