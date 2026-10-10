// /pase: el panel del pase de batalla (solo lo ves tú). Usa la BD en memoria de verdad: el XP y las recompensas se
// guardan igual que en producción, y la temporada se calcula con la fecha actual (así que los textos se comparan
// con pase.temporadaDe(), no con un número fijo).
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const pase = require("../src/systems/pase/pase");
const paseCmd = require("../src/commands/progresion/pase");

const G = "g-pase";
const EFIMERO = 64; // MessageFlags.Ephemeral

beforeEach(() => {
    db.prepare("DELETE FROM pase_progreso").run();
    db.prepare("DELETE FROM pase_caps").run();
    db.prepare("DELETE FROM pase_misiones").run();
    db.prepare("DELETE FROM pase_recompensas").run();
});

function fijarXp(userId, xp, guildId = G) {
    const { numero } = pase.temporadaDe();
    db.prepare("INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, ?, ?, ?)").run(guildId, numero, userId, xp);
}

function interaccion(customId, userId = "ana") {
    return {
        customId,
        guildId: G,
        user: { id: userId, username: userId },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    };
}

const numeroTemporada = () => pase.temporadaDe().numero + 1;

describe("definición y /pase", () => {
    test("el comando es pase y sus botones cuelgan del prefijo pase_", () => {
        expect(paseCmd.data.name).toBe("pase");
        expect(paseCmd.componentHandlers).toEqual([expect.objectContaining({ prefixes: ["pase_"], method: "handleButton", acl: "pase" })]);
    });

    test("/pase responde en privado con el resumen de la temporada actual", async () => {
        fijarXp("ana", 300);
        const i = interaccion(null);
        await paseCmd.run({}, i);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags).toBe(EFIMERO);
        expect(payload.embeds[0].data.title).toBe(`🛡️ Pase de batalla · temporada ${numeroTemporada()}`);
        expect(payload.embeds[0].data.description).toMatch(/\*\*Nivel 2\*\* de 20/);
        const porReclamar = payload.embeds[0].data.fields.find((f) => f.name === "Por reclamar");
        expect(porReclamar.value).toBe(`2 niveles · ${pase.RECOMPENSA[0] + pase.RECOMPENSA[1]} 🪙`);
    });

    test("un usuario sin XP ve el nivel 1, y el nivel de inicio ya está disponible para reclamar", async () => {
        const i = interaccion(null, "nuevo");
        await paseCmd.run({}, i);
        const embed = i.reply.mock.calls[0][0].embeds[0].data;
        expect(embed.description).toMatch(/\*\*Nivel 1\*\* de 20/);
        expect(embed.fields.find((f) => f.name === "Por reclamar").value).toBe("1 nivel · 80 🪙");
    });
});

describe("🎁 Reclamar", () => {
    test("cobra al efectivo la recompensa del nivel de inicio (80 🪙) la primera vez", async () => {
        const antes = dinero.efectivo("ana");
        const i = interaccion("pase_reclamar");
        await paseCmd.handleButton({}, i);
        expect(dinero.efectivo("ana")).toBe(antes + pase.RECOMPENSA[0]);
        const payload = i.update.mock.calls[0][0];
        expect(payload.embeds[0].data.description).toContain("🎁 Cobrado **80** 🪙 (niveles 1).");
    });

    test("reclamar varios niveles suma sus recompensas al efectivo", async () => {
        fijarXp("ana", 1000); // nivel 4: niveles 1 a 4 alcanzados
        const antes = dinero.efectivo("ana");
        const i = interaccion("pase_reclamar");
        await paseCmd.handleButton({}, i);
        const esperado = pase.RECOMPENSA.slice(0, 4).reduce((t, m) => t + m, 0);
        expect(esperado).toBe(560);
        expect(dinero.efectivo("ana")).toBe(antes + esperado);
        expect(i.update.mock.calls[0][0].embeds[0].data.description).toContain("niveles 1, 2, 3, 4");
        const movimiento = db.prepare("SELECT cantidad FROM historial WHERE userId = 'ana' ORDER BY id DESC LIMIT 1").get();
        expect(movimiento.cantidad).toBe(esperado);
    });

    // Antes "pase" no estaba en TIPOS (systems/dinero.js) y el cobro quedaba como "otro" (📦 Otros).
    test("el cobro del pase se apunta en el historial con tipo «pase», no «otro»", async () => {
        await paseCmd.handleButton({}, interaccion("pase_reclamar"));
        const movimiento = db.prepare("SELECT tipo FROM historial WHERE userId = 'ana' ORDER BY id DESC LIMIT 1").get();
        expect(movimiento.tipo).toBe("pase");
    });

    test("una segunda pulsación no cobra nada y lo dice", async () => {
        await paseCmd.handleButton({}, interaccion("pase_reclamar"));
        const antes = dinero.efectivo("ana");
        const i = interaccion("pase_reclamar");
        await paseCmd.handleButton({}, i);
        expect(dinero.efectivo("ana")).toBe(antes);
        expect(i.update.mock.calls[0][0].embeds[0].data.description).toContain("Nada que reclamar todavía.");
    });

    test("tras reclamar, el botón de reclamar queda apagado", async () => {
        const i = interaccion("pase_reclamar");
        await paseCmd.handleButton({}, i);
        const filaReclamar = i.update.mock.calls[0][0].components[0];
        expect(filaReclamar.components[0].data.disabled).toBe(true);
    });

    test("con recompensas pendientes el botón de reclamar está activo", async () => {
        const i = interaccion("pase_vista_resumen");
        await paseCmd.handleButton({}, i);
        const filaReclamar = i.update.mock.calls[0][0].components[0];
        expect(filaReclamar.components[0].data.disabled).toBe(false);
    });
});

describe("vistas del pase", () => {
    test("pase_vista_niveles muestra los 20 niveles en dos columnas", async () => {
        const i = interaccion("pase_vista_niveles");
        await paseCmd.handleButton({}, i);
        const embed = i.update.mock.calls[0][0].embeds[0].data;
        expect(embed.title).toBe(`📜 Niveles · temporada ${numeroTemporada()}`);
        expect(embed.fields[0].name).toBe("Niveles 1–10");
        expect(embed.fields[1].name).toBe("Niveles 11–20");
        expect(embed.fields[1].value).toContain("Nivel 20");
        expect(embed.fields[0].value).toContain("🎁 **Nivel 1** · 80 🪙");
    });

    test("en la vista de niveles, un nivel cobrado se marca con ✅ y uno sin alcanzar con 🔒", async () => {
        await paseCmd.handleButton({}, interaccion("pase_reclamar"));
        const i = interaccion("pase_vista_niveles");
        await paseCmd.handleButton({}, i);
        const valor = i.update.mock.calls[0][0].embeds[0].data.fields[0].value;
        expect(valor).toContain("✅ **Nivel 1**");
        const valorAltos = i.update.mock.calls[0][0].embeds[0].data.fields[1].value;
        expect(valorAltos).toContain("🔒 **Nivel 11**");
    });

    test("pase_vista_misiones muestra las misiones de hoy con su progreso", async () => {
        const i = interaccion("pase_vista_misiones");
        await paseCmd.handleButton({}, i);
        const embed = i.update.mock.calls[0][0].embeds[0].data;
        expect(embed.title).toBe("🧩 Misiones de hoy");
        expect(embed.description).toContain("Son 3 al día");
        expect(embed.fields[0].value.split("\n\n")).toHaveLength(3);
        expect(embed.fields[0].value).toMatch(/0\/\d+/);
    });

    test("pase_vista_top ordena por XP y, sin nadie con XP, lo dice", async () => {
        const vacio = interaccion("pase_vista_top");
        await paseCmd.handleButton({}, vacio);
        expect(vacio.update.mock.calls[0][0].embeds[0].data.description).toContain("Todavía nadie tiene XP de pase.");

        fijarXp("bajo", 100);
        fijarXp("alto", 900);
        const i = interaccion("pase_vista_top");
        await paseCmd.handleButton({}, i);
        const desc = i.update.mock.calls[0][0].embeds[0].data.description;
        expect(desc.indexOf("<@alto>")).toBeLessThan(desc.indexOf("<@bajo>"));
        expect(desc).toMatch(/1\. <@alto> · nivel \*\*3\*\*/);
    });

    test("pase_vista_resumen vuelve al resumen", async () => {
        const i = interaccion("pase_vista_resumen");
        await paseCmd.handleButton({}, i);
        expect(i.update.mock.calls[0][0].embeds[0].data.title).toBe(`🛡️ Pase de batalla · temporada ${numeroTemporada()}`);
    });

    test("un id de botón que no existe no hace nada", async () => {
        const i = interaccion("pase_vista_raro");
        const r = await paseCmd.handleButton({}, i);
        expect(r).toBeUndefined();
        expect(i.update).not.toHaveBeenCalled();
        expect(i.reply).not.toHaveBeenCalled();
    });
});
