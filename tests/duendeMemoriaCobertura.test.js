// Historial reciente por canal del Duende (systems/duende/memoria.js): carga al arrancar (ausente, válido o corrupto),
// guardado atómico y limpieza horaria de los canales sin actividad en 24 h. Todo ocurre en una carpeta temporal
// (DATA_DIR): nunca se toca data/ del proyecto. El reloj y el intervalo horario se simulan con fake timers.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR_ORIGINAL = process.env.DATA_DIR;
const HORA = 60 * 60 * 1000;
const AHORA = new Date("2026-10-10T12:00:00Z").getTime();
let carpeta;

// Carga el módulo desde cero con la carpeta temporal como DATA_DIR. Así cada test ve su propio fichero de historial.
function cargarMemoria() {
    let modulo;
    jest.isolateModules(() => {
        modulo = require("../src/systems/duende/memoria");
    });
    return modulo;
}
const ruta = () => path.join(carpeta, "duende-history.json");
const leerFichero = () => JSON.parse(fs.readFileSync(ruta(), "utf8"));

beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-memoria-"));
    process.env.DATA_DIR = carpeta;
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (DATA_DIR_ORIGINAL === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = DATA_DIR_ORIGINAL;
    fs.rmSync(carpeta, { recursive: true, force: true });
});

describe("carga al arrancar", () => {
    test("sin fichero empieza sin historial y crea la carpeta de datos si no existe", () => {
        const sub = path.join(carpeta, "nueva");
        process.env.DATA_DIR = sub;
        const { conversationHistory } = cargarMemoria();
        expect(conversationHistory).toEqual({});
        expect(fs.existsSync(sub)).toBe(true);
    });

    test("con un fichero válido recupera las conversaciones guardadas", () => {
        fs.writeFileSync(ruta(), JSON.stringify({ "canal-1": [{ role: "user", content: "hola", timestamp: Date.now() }] }));
        const { conversationHistory } = cargarMemoria();
        expect(conversationHistory["canal-1"]).toEqual([{ role: "user", content: "hola", timestamp: expect.any(Number) }]);
    });

    test("con un fichero corrupto arranca vacío en vez de caerse", () => {
        fs.writeFileSync(ruta(), "{esto no es json");
        const { conversationHistory } = cargarMemoria();
        expect(conversationHistory).toEqual({});
    });
});

describe("guardado", () => {
    test("guarda el historial como JSON legible y sin dejar el temporal", () => {
        const memoria = cargarMemoria();
        memoria.conversationHistory["canal-2"] = [{ role: "model", content: "buenas", timestamp: 5 }];
        memoria.saveHistory();

        expect(fs.existsSync(ruta() + ".tmp")).toBe(false);
        expect(leerFichero()).toEqual({ "canal-2": [{ role: "model", content: "buenas", timestamp: 5 }] });
        // Sangría de dos espacios: el fichero se puede abrir y revisar a mano.
        expect(fs.readFileSync(ruta(), "utf8")).toContain('\n  "canal-2"');
    });

    test("si no se puede escribir, lo registra y no lanza", () => {
        const memoria = cargarMemoria();
        memoria.conversationHistory["canal-3"] = [];
        jest.spyOn(fs, "writeFileSync").mockImplementation(() => {
            throw new Error("disco lleno");
        });
        expect(() => memoria.saveHistory()).not.toThrow();
        expect(fs.existsSync(ruta())).toBe(false);
    });

    test("el objeto exportado es siempre el mismo: quien lo importa ve los cambios", () => {
        const primera = cargarMemoria();
        const copia = primera.conversationHistory;
        primera.conversationHistory["canal-4"] = [{ role: "user", content: "x", timestamp: 1 }];
        expect(copia["canal-4"]).toHaveLength(1);
    });
});

describe("limpieza horaria de canales sin actividad", () => {
    // Un canal se borra cuando su ÚLTIMO mensaje tiene más de 24 h. Se usan fake timers para que el intervalo
    // horario y la fecha sean controlables.
    function historialDePrueba() {
        const hace = (horas) => AHORA - horas * HORA;
        return {
            vieja: [{ role: "user", content: "de hace días", timestamp: hace(25) }],
            reciente: [{ role: "user", content: "hoy", timestamp: hace(1) }],
            mixta: [
                { role: "user", content: "antiguo", timestamp: hace(30) },
                { role: "model", content: "hoy respondo", timestamp: hace(2) },
            ],
            sinMarca: [{ role: "user", content: "sin fecha" }],
            vacia: [],
        };
    }

    test("cada hora borra los canales cuyo último mensaje tiene más de 24 h y reescribe el fichero", () => {
        jest.useFakeTimers({ now: AHORA });
        fs.writeFileSync(ruta(), JSON.stringify(historialDePrueba()));
        const { conversationHistory } = cargarMemoria();

        jest.advanceTimersByTime(HORA);

        expect(Object.keys(conversationHistory).sort()).toEqual(["mixta", "reciente", "sinMarca", "vacia"]);
        expect(Object.keys(leerFichero()).sort()).toEqual(["mixta", "reciente", "sinMarca", "vacia"]);
    });

    test("si nada ha caducado no reescribe el fichero", () => {
        jest.useFakeTimers({ now: AHORA });
        const { reciente } = historialDePrueba();
        fs.writeFileSync(ruta(), JSON.stringify({ reciente }));
        cargarMemoria();
        const escribir = jest.spyOn(fs, "writeFileSync");

        jest.advanceTimersByTime(HORA);

        expect(escribir).not.toHaveBeenCalled();
    });

    test("el intervalo no vuelve a borrar hasta pasar otra hora", () => {
        jest.useFakeTimers({ now: AHORA });
        fs.writeFileSync(ruta(), JSON.stringify(historialDePrueba()));
        const { conversationHistory } = cargarMemoria();

        jest.advanceTimersByTime(HORA - 1);
        expect(conversationHistory).toHaveProperty("vieja");
        jest.advanceTimersByTime(1);
        expect(conversationHistory).not.toHaveProperty("vieja");
    });
});
