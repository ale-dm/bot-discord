// Carga de componentes al arrancar (#166): todos los módulos de juegos, perfil y paneles se registran sin error, y los
// botones de «Mis jugadas» llegan a su panel (paneles/misJugadas), no a un envoltorio.
const { createComponentRouter } = require("../src/core/componentRouter");
const { getAllJsFiles } = require("../src/core/cargarModulos");
const { JUEGOS_DIR, PERFIL_DIR, PANELES_DIR } = require("../src/core/paths");

const fake = (type, customId) => ({
    customId,
    isButton: () => type === "button",
    isStringSelectMenu: () => type === "stringSelect",
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
});

test("todos los módulos de juegos, perfil y paneles se registran sin error", () => {
    const r = createComponentRouter();
    for (const file of [...getAllJsFiles(JUEGOS_DIR), ...getAllJsFiles(PERFIL_DIR), ...getAllJsFiles(PANELES_DIR)]) {
        expect(() => r.register(require(file), file)).not.toThrow();
    }
    expect(r.size).toBeGreaterThan(0);
});

test("los botones de Mis jugadas llegan a paneles/misJugadas", () => {
    const r = createComponentRouter();
    for (const file of [...getAllJsFiles(JUEGOS_DIR), ...getAllJsFiles(PERFIL_DIR), ...getAllJsFiles(PANELES_DIR)]) {
        r.register(require(file), file);
    }
    const misJugadas = require("../src/paneles/misJugadas");
    expect(r.match(fake("button", "misapuestas_activas_ana")).mod).toBe(misJugadas);
    expect(r.match(fake("stringSelect", "misapuestas_cancelarsel_ana")).mod).toBe(misJugadas);
});
