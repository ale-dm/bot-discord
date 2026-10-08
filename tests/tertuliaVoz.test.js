// Tertulia de /conversación (#16): la opción nueva del comando, que no se combina con «con», y que las instrucciones
// dicen que hablan varias personas a la vez (y no que se identifica a cada una por turnos). El audio real no se prueba
// aquí: lo cubren los tests del mezclador y hay que probarlo en Discord.
const liveVoz = require("../src/services/duende/liveVoz");
const conversacion = require("../src/commands/voz/conversacion");

test("el comando tiene la opción tertulia, booleana y sin obligatoriedad", () => {
    const opcion = conversacion.data.options.find((o) => o.name === "tertulia");
    expect(opcion).toBeDefined();
    expect(opcion.toJSON().type).toBe(5); // BOOLEAN
    expect(opcion.toJSON().required).toBeFalsy();
});

test("la tertulia no se combina con «con»: se rechaza antes de conectar nada", async () => {
    const r = await liveVoz.empezarConversacion({ guildId: "g-tertulia" }, { tertulia: true, soloEscuchaA: "u1" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no se puede combinar/);
});

test("con tertulia las instrucciones dicen que hablan varias personas a la vez, sin identificarlas por turno", () => {
    const normal = liveVoz.construirInstruccionesSistema("canal-x");
    const tertulia = liveVoz.construirInstruccionesSistema("canal-x", { tertulia: true });
    expect(normal).toMatch(/antes de cada turno te diré quién es quien/);
    expect(tertulia).toMatch(/varias personas a la vez/);
    expect(tertulia).not.toMatch(/antes de cada turno te diré quién es quien/);
    expect(tertulia).toMatch(/consultar_perfil_persona/);
});
