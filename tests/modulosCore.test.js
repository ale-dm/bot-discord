// 🧩 Módulos que salieron de src/index.js (DT-21): cargan, exportan lo que se espera y los filtros de mensajes siguen igual.
// No se arranca el bot ni se conecta a Discord.
const mensajes = require("../src/core/mensajes");
const tareas = require("../src/core/tareas");
const cargar = require("../src/core/cargarModulos");

test("los módulos nuevos exportan lo que usa index.js", () => {
    expect(typeof mensajes.registrarMensajes).toBe("function");
    expect(typeof tareas.programarTareas).toBe("function");
    expect(typeof cargar.getAllJsFiles).toBe("function");
});

test("un mismo id de mensaje no se procesa dos veces seguidas", () => {
    expect(mensajes.isDuplicateMessage("msg-1")).toBe(false);
    expect(mensajes.isDuplicateMessage("msg-1")).toBe(true);
});

test("los mensajes de bajo esfuerzo son risas, emojis o signos; el resto no", () => {
    expect(mensajes.isLowEffortMessage("jajaja")).toBe(true);
    expect(mensajes.isLowEffortMessage("xD")).toBe(true);
    expect(mensajes.isLowEffortMessage("😂🔥")).toBe(true);
    expect(mensajes.isLowEffortMessage("¿qué opinas del partido de ayer?")).toBe(false);
    expect(mensajes.isLowEffortMessage("   ")).toBe(false);
});

test("getAllJsFiles recorre subcarpetas y solo devuelve .js", () => {
    const ficheros = cargar.getAllJsFiles(require("path").join(__dirname, "../src/core"));
    expect(ficheros.length).toBeGreaterThan(5);
    expect(ficheros.every((f) => f.endsWith(".js"))).toBe(true);
    expect(ficheros.some((f) => f.endsWith("mensajes.js"))).toBe(true);
});
