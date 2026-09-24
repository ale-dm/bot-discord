// BD en memoria (tests/setupEnv.js), con el esquema aplicado por las migraciones.
const fs = require("fs");
const os = require("os");
const path = require("path");

// Carpeta de datos propia para el fichero de apodos a importar.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "el-duende-apodos-"));
process.env.DATA_DIR = dataDir;

const apodos = require("../src/systems/apodos");
const xp = require("../src/systems/xpSystem");

const G = "guild-apodos";

describe("apodos", () => {
    beforeAll(() => {
        apodos.anadir(G, "111111111111111111", "Raúl", true);
        apodos.anadir(G, "111111111111111111", "el marcos");
        apodos.anadir(G, "222222222222222222", "perro");
    });

    test("resuelve sin importar tildes, mayúsculas ni artículo", () => {
        expect(apodos.resolver(G, "raul")).toBe("111111111111111111");
        expect(apodos.resolver(G, "RAÚL")).toBe("111111111111111111");
        expect(apodos.resolver(G, "El Marcos")).toBe("111111111111111111");
        expect(apodos.resolver(G, "el perro")).toBe("222222222222222222");
        expect(apodos.resolver(G, "nadie")).toBeNull();
        expect(apodos.resolver("otro-servidor", "raul")).toBeNull();
    });

    test("solo hay un nombre principal por persona", () => {
        apodos.anadir(G, "111111111111111111", "Coneyo", true);
        expect(apodos.nombreDe(G, "111111111111111111")).toBe("Coneyo");
        const p = apodos.porPersona(G).find((x) => x.discordId === "111111111111111111");
        expect(p.nombre).toBe("Coneyo");
        expect(p.apodos).toEqual(expect.arrayContaining(["Raúl", "el marcos"]));
    });

    test("un apodo ya usado cambia de dueño y se puede quitar", () => {
        const r = apodos.anadir(G, "333333333333333333", "perro");
        expect(r.anterior).toBe("222222222222222222");
        expect(apodos.quitar(G, "perro")).toBe("333333333333333333");
        expect(apodos.resolver(G, "perro")).toBeNull();
        expect(apodos.quitar(G, "perro")).toBeNull();
    });
});

describe("importación de data/duende-apodos.seed.json", () => {
    test("importa una vez, respeta lo existente y renombra el fichero", () => {
        apodos.anadir("g-seed", "444444444444444444", "Martina", true);
        const seed = path.join(dataDir, "duende-apodos.seed.json");
        fs.writeFileSync(
            seed,
            JSON.stringify({
                guildId: "g-seed",
                personas: [
                    { discordId: "444444444444444444", nombre: "Martín", apodos: ["martineta"] },
                    { discordId: "555555555555555555", nombre: "Raúl", apodos: ["coneyo"] },
                    { discordId: "no-es-un-id", nombre: "X" },
                ],
            }),
        );
        expect(apodos.importarFicheroSiExiste()).toBe(4);
        expect(apodos.nombreDe("g-seed", "444444444444444444")).toBe("Martina"); // no se pisa su nombre
        expect(apodos.resolver("g-seed", "martin")).toBe("444444444444444444");
        expect(apodos.nombreDe("g-seed", "555555555555555555")).toBe("Raúl");
        expect(fs.existsSync(seed)).toBe(false);
        expect(fs.existsSync(seed + ".importado")).toBe(true);
        expect(apodos.importarFicheroSiExiste()).toBe(0);
    });
});

describe("XP: los valores por defecto no pisan el panel", () => {
    const XG = "guild-xp";

    test("una recompensa quitada no vuelve a aparecer", () => {
        xp.ensureGuildDefaults(XG);
        xp.setReward(XG, 5, "555", "Rol de prueba");
        xp.removeReward(XG, 5, "555");
        xp.getConfig(XG, "xp_multiplier"); // antes esto volvía a sembrar
        expect(xp.getRewards(XG).find((r) => r.roleId === "555")).toBeUndefined();
    });

    test("un servidor nuevo no recibe roles de otro servidor", () => {
        xp.ensureGuildDefaults("guild-nuevo");
        expect(xp.getRewards("guild-nuevo")).toEqual([]);
        expect(xp.getTitles("guild-nuevo").length).toBeGreaterThan(0);
    });

    test("un cooldown de 60 s configurado se respeta", () => {
        xp.setConfig(XG, "xp_message_cooldown_sec", "60");
        expect(xp.getConfig(XG, "xp_message_cooldown_sec")).toBe("60");
    });

    test("la descripción de una recompensa se guarda y se lee", () => {
        xp.setReward(XG, 12, "777", "Mover");
        expect(xp.setRewardDescription(XG, 12, "777", "Mover usuarios", "🚶")).toBe(true);
        expect(xp.getRewards(XG).find((r) => r.roleId === "777")).toMatchObject({ descripcion: "Mover usuarios", emoji: "🚶" });
        expect(xp.setRewardDescription(XG, 12, "no-existe", "x")).toBe(false);
    });
});
