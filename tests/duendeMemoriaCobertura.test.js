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

describe("guardado diferido (#486)", () => {
    const ESPERA = 5000;
    // El reloj se simula, pero la escritura en segundo plano usa el disco de verdad: se espera a que el fichero aparezca.
    const fakeTimers = () => jest.useFakeTimers({ now: AHORA, doNotFake: ["setImmediate", "nextTick"] });
    async function esperarFichero() {
        for (let i = 0; i < 200 && !fs.existsSync(ruta()); i++) await new Promise((r) => setImmediate(r));
        // El rename termina justo después de existir el .tmp: se espera a que desaparezca.
        for (let i = 0; i < 200 && fs.existsSync(ruta() + ".tmp"); i++) await new Promise((r) => setImmediate(r));
    }

    test("pedir el guardado no escribe nada en ese momento: la escritura sale pasados 5 s, en segundo plano y compacta", async () => {
        fakeTimers();
        const memoria = cargarMemoria();
        const sincrona = jest.spyOn(fs, "writeFileSync");
        memoria.conversationHistory["canal-d"] = [{ role: "user", text: "hola", timestamp: AHORA }];

        memoria.guardarDiferido();
        expect(sincrona).not.toHaveBeenCalled();
        expect(fs.existsSync(ruta())).toBe(false);

        jest.advanceTimersByTime(ESPERA - 1);
        expect(fs.existsSync(ruta())).toBe(false);
        jest.advanceTimersByTime(1);
        await esperarFichero();

        expect(sincrona).not.toHaveBeenCalled(); // la escritura fue asíncrona
        expect(leerFichero()).toEqual({ "canal-d": [{ role: "user", text: "hola", timestamp: AHORA }] });
        expect(fs.readFileSync(ruta(), "utf8")).not.toContain("\n"); // JSON compacto
        expect(fs.existsSync(ruta() + ".tmp")).toBe(false);
    });

    test("muchas respuestas seguidas se juntan en una sola escritura", async () => {
        fakeTimers();
        const memoria = cargarMemoria();
        const escribir = jest.spyOn(fs.promises, "writeFile");
        for (let i = 0; i < 50; i++) {
            memoria.conversationHistory[`c${i}`] = [{ role: "user", text: `m${i}`, timestamp: AHORA }];
            memoria.guardarDiferido();
        }
        jest.advanceTimersByTime(ESPERA);
        await esperarFichero();
        expect(escribir).toHaveBeenCalledTimes(1);
        expect(Object.keys(leerFichero())).toHaveLength(50);
    });

    test("al apagar se escribe lo pendiente, y tras reiniciar el historial sigue ahí", () => {
        fakeTimers();
        const memoria = cargarMemoria();
        memoria.conversationHistory["canal-r"] = [{ role: "duende", text: "buenas", timestamp: AHORA - HORA }];
        memoria.guardarDiferido();
        expect(fs.existsSync(ruta())).toBe(false);

        memoria.vaciarPendiente();
        expect(leerFichero()["canal-r"]).toHaveLength(1);

        // Un reinicio: el módulo se carga de cero y lee el fichero.
        const reiniciado = cargarMemoria();
        expect(reiniciado.conversationHistory["canal-r"]).toEqual([{ role: "duende", text: "buenas", timestamp: AHORA - HORA }]);
    });

    test("sin nada pendiente, vaciar no escribe; y un fallo de disco no lanza y se reintenta", async () => {
        fakeTimers();
        const memoria = cargarMemoria();
        const sincrona = jest.spyOn(fs, "writeFileSync");
        memoria.vaciarPendiente();
        expect(sincrona).not.toHaveBeenCalled();

        const fallo = jest.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(new Error("disco lleno"));
        memoria.conversationHistory["canal-f"] = [];
        memoria.guardarDiferido();
        jest.advanceTimersByTime(ESPERA);
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(fallo).toHaveBeenCalledTimes(1);
        // Quedó pendiente: la siguiente ronda (otros 5 s) lo vuelve a intentar y esta vez escribe.
        jest.advanceTimersByTime(ESPERA);
        await esperarFichero();
        expect(leerFichero()).toHaveProperty("canal-f");
    });

    test("el camino de una respuesta del Duende usa el guardado diferido, no el síncrono", () => {
        const fuente = fs.readFileSync(path.join(__dirname, "../src/services/duende/chat/hablar.js"), "utf8");
        expect(fuente).toContain("guardarDiferido()");
        expect(fuente).not.toMatch(/\bsaveHistory\(/);
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
