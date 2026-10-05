// 🎰 Roles por Gordos del Plex (F-PX-13): un rol al llegar a 1, 5 y 10 logros de Plex de dificultad 🎰, elegidos en
// Panel admin → Plex → 🏆 Trofeos → 🎰 Roles de Gordos y dados después de cada cálculo de los logros de Plex.
const { db, nuevoGuild, ver, vincular } = require("./ayudaPlex");
const guildSettings = require("../src/systems/guildSettings");
const achievements = require("../src/systems/achievementsSystem");
const plexHistorial = require("../src/systems/plexHistorial");
const plexTrofeos = require("../src/systems/plexTrofeos");
const plexGordos = require("../src/systems/plexGordos");
const { buildPlexTrofeos, handlePlexButton } = require("../src/adminPanel/plex");
const paneladmin = require("../src/commands/admin/paneladmin");
const perfilPanel = require("../src/paneles/perfil");
const { createComponentRouter } = require("../src/core/componentRouter");

const GORDOS = achievements.CATALOG.filter((a) => a.category === "plex" && a.dificultad === "gordo").map((a) => a.id);
const completar = (g, userId, ids) => {
    const st = db.prepare(
        `INSERT INTO achievements_progress (guildId, userId, achievementId, progress, completedAt) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(guildId, userId, achievementId) DO UPDATE SET completedAt = excluded.completedAt`,
    );
    for (const id of ids) st.run(g, userId, id, Date.now());
};

/** Un servidor de Discord de mentira con roles y miembros (los roles de cada miembro, en un Map). */
function servidor(g, miembros, { fallaAdd = [] } = {}) {
    const roles = new Map(["rol1", "rol5", "rol10"].map((id) => [id, { id, name: `Gordo ${id}` }]));
    const members = new Map(
        miembros.map((id) => {
            const cache = new Map();
            return [
                id,
                {
                    id,
                    roles: {
                        cache,
                        add: jest.fn(async (role) => {
                            if (fallaAdd.includes(id)) throw new Error("Missing Permissions");
                            cache.set(role.id, role);
                        }),
                    },
                },
            ];
        }),
    );
    return { id: g, name: g, roles: { cache: roles }, members: { cache: members, fetch: jest.fn(async () => null) } };
}
const rolesDe = (guild, id) => [...guild.members.cache.get(id).roles.cache.keys()].sort();

test("hay 🎰 de todo tipo para llegar a 10: los fijos de Plex son ya más de 10", () => {
    expect(plexGordos.UMBRALES).toEqual([1, 5, 10]);
    expect(GORDOS.length).toBeGreaterThanOrEqual(10);
});

describe("contar y repartir", () => {
    const g = nuevoGuild("guild-gordos");
    let guild;
    beforeAll(() => {
        vincular(g, 1, 2, 3, 4);
        completar(g, "disc-1", GORDOS.slice(0, 1));
        completar(g, "disc-2", GORDOS.slice(0, 5));
        completar(g, "disc-3", GORDOS.slice(0, 10));
        completar(g, "disc-4", GORDOS.slice(0, 5));
        completar(g, "disc-1", ["plex_pelis_1"]); // uno fácil: no cuenta
        plexTrofeos.setOculto(g, "disc-4", true);
        guild = servidor(g, ["disc-1", "disc-2", "disc-3", "disc-4"]);
    });

    test("cuenta solo los de Plex de dificultad 🎰 (también los trofeos de admin que lo sean)", () => {
        expect(Object.fromEntries(plexGordos.contar(g))).toEqual({ "disc-1": 1, "disc-2": 5, "disc-3": 10, "disc-4": 5 });
        const t = plexTrofeos.crearAdmin(g, { nombre: "Maratón", condicion: "horas 1", recompensa: "0", dificultad: "gordo" }, "admin");
        completar(g, "disc-1", [`plext:${t.trofeo.id}`]);
        expect(plexGordos.contar(g, ["disc-1"]).get("disc-1")).toBe(2);
        plexTrofeos.borrar(g, t.trofeo.id);
    });

    test("sin roles elegidos no se da nada", async () => {
        expect(await plexGordos.repartir(guild)).toBe(0);
    });

    test("da a cada uno los de los umbrales a los que llega; a quien oculta lo suyo, no", async () => {
        guildSettings.setSetting(g, "plex.rol_gordos_1", "rol1");
        guildSettings.setSetting(g, "plex.rol_gordos_5", "rol5");
        guildSettings.setSetting(g, "plex.rol_gordos_10", "rol10");
        expect(await plexGordos.repartir(guild)).toBe(6);
        expect(rolesDe(guild, "disc-1")).toEqual(["rol1"]);
        expect(rolesDe(guild, "disc-2")).toEqual(["rol1", "rol5"]);
        expect(rolesDe(guild, "disc-3")).toEqual(["rol1", "rol10", "rol5"]);
        expect(rolesDe(guild, "disc-4")).toEqual([]);
    });

    test("no se vuelven a dar los que ya tiene", async () => {
        const add = guild.members.cache.get("disc-3").roles.add;
        add.mockClear();
        expect(await plexGordos.repartir(guild)).toBe(0);
        expect(add).not.toHaveBeenCalled();
    });

    test("un rol borrado, un miembro que ya no está o sin permisos: sigue con los demás", async () => {
        const g2 = nuevoGuild("guild-gordos");
        vincular(g2, 1, 2, 3);
        for (const u of ["disc-1", "disc-2", "disc-3"]) completar(g2, u, GORDOS.slice(0, 5));
        guildSettings.setSetting(g2, "plex.rol_gordos_1", "borrado");
        guildSettings.setSetting(g2, "plex.rol_gordos_5", "rol5");
        const guild2 = servidor(g2, ["disc-1", "disc-3"], { fallaAdd: ["disc-3"] });
        expect(await plexGordos.repartir(guild2)).toBe(1);
        expect(rolesDe(guild2, "disc-1")).toEqual(["rol5"]);
        expect(guild2.members.fetch).toHaveBeenCalledWith("disc-2");
    });

    test("el siguiente rol que le falta (para su pantalla 🍿 Plex)", () => {
        expect(plexGordos.siguiente(g, 1)).toEqual({ umbral: 5, roleId: "rol5" });
        expect(plexGordos.siguiente(g, 10)).toBeNull();
        const r = perfilPanel.buildPlex(guild, "disc-2", "disc-2").embeds[0].data.fields.find((f) => f.name === "🎰 Gordos del Plex");
        expect(r.value).toBe("**5** · el rol <@&rol10> a los 10");
    });
});

test("después de cada cálculo de los logros de Plex: quien llega a su primer 🎰 tiene el rol", async () => {
    const g = nuevoGuild("guild-gordos");
    vincular(g, 1);
    guildSettings.setSetting(g, "plex.rol_gordos_1", "rol1");
    const guild = { ...servidor(g, ["disc-1"]), channels: { cache: new Map(), fetch: async () => null } };
    // 10 horas en un mismo día: "Sin pestañear" es un 🎰.
    for (let i = 0; i < 10; i++) ver(g, 1, { tipo: "movie", rating_key: `p${i}`, titulo: `P${i}`, inicio: 1_780_000_000 + i * 60 });
    const [r] = await plexHistorial.actualizarLogros(guild);
    expect(r.desbloqueados.map((a) => a.id)).toContain("plex_maraton_10");
    expect(rolesDe(guild, "disc-1")).toEqual(["rol1"]);
    // Con solo el id del servidor (sin Discord) se calcula igual, sin roles.
    await expect(plexHistorial.actualizarLogros(g)).resolves.toHaveLength(1);
});

describe("Panel admin → Plex → 🏆 Trofeos → 🎰 Roles de Gordos", () => {
    const g = nuevoGuild("guild-gordos");
    const router = createComponentRouter();
    router.register(paneladmin, "paneladmin");
    const interaccion = (extra) => ({
        guildId: g,
        guild: { ...servidor(g, ["disc-1"]), channels: { cache: new Map() } },
        user: { id: "admin" },
        member: { permissions: { has: () => true } },
        isButton: () => false,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => false,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        ...extra,
    });

    beforeAll(() => {
        vincular(g, 1);
        completar(g, "disc-1", GORDOS.slice(0, 5));
    });

    test("el panel dice qué rol hay en cada umbral y tiene el botón", () => {
        guildSettings.setSetting(g, "plex.rol_gordos_5", "rol5");
        const p = buildPlexTrofeos(g);
        expect(p.embeds[0].data.description).toMatch(/🎰 Roles de Gordos del Plex: 1 → sin rol · 5 → <@&rol5> · 10 → sin rol/);
        expect(p.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id))).toEqual(
            expect.arrayContaining(["paneladmin_plex_importacion", "paneladmin_plex_gordos", "paneladmin_plex_idiomas"]),
        );
        expect(p.embeds[0].data.description.length).toBeLessThanOrEqual(4096);
    });

    test("el botón abre un menú de roles por umbral, con el elegido marcado", async () => {
        const i = interaccion({ customId: "paneladmin_plex_gordos" });
        expect(await handlePlexButton(i)).toBe(true);
        const { components, flags } = i.reply.mock.calls[0][0];
        expect(flags).toBeDefined();
        const menus = components.map((f) => f.toJSON().components[0]);
        expect(menus.map((m) => [m.custom_id, m.type, m.min_values, m.max_values])).toEqual([
            ["paneladmin_plex_gordos_rol_1", 6, 0, 1],
            ["paneladmin_plex_gordos_rol_5", 6, 0, 1],
            ["paneladmin_plex_gordos_rol_10", 6, 0, 1],
        ]);
        expect(menus[1].default_values).toEqual([{ id: "rol5", type: "role" }]);
        expect(menus[0].default_values).toBeUndefined();
    });

    test("elegir un rol (por el enrutador, como en Discord): se guarda, se apunta y se da ya a quien llega", async () => {
        const i = interaccion({ customId: "paneladmin_plex_gordos_rol_1", values: ["rol1"], isRoleSelectMenu: () => true });
        const ruta = router.match(i);
        expect(ruta.method).toBe("handleRoleSelect");
        await paneladmin[ruta.method](null, i);
        expect(guildSettings.getSettings(g).plex.rol_gordos_1).toBe("rol1");
        expect(i.update.mock.calls[0][0].content).toMatch(/1 → <@&rol1> · 5 → <@&rol5>/);
        expect(i.update.mock.calls[0][0]).not.toHaveProperty("flags");
        for (let n = 0; n < 50 && !rolesDe(i.guild, "disc-1").length; n++) await new Promise((r) => setTimeout(r, 10));
        expect(rolesDe(i.guild, "disc-1")).toEqual(["rol1", "rol5"]);
        const auditoria = db.prepare("SELECT action, details FROM admin_audit WHERE guildId = ? ORDER BY rowid DESC LIMIT 1").get(g);
        expect(auditoria.action).toBe("plex.gordos.rol");
    });

    test("dejar el menú vacío quita el rol de ese umbral; los roles de niveles siguen yendo a su sitio", async () => {
        const i = interaccion({ customId: "paneladmin_plex_gordos_rol_5", values: [], isRoleSelectMenu: () => true });
        await paneladmin.handleRoleSelect(null, i);
        expect(guildSettings.getSettings(g).plex.rol_gordos_5).toBe("");
        expect(plexGordos.roles(g)).toEqual([{ umbral: 1, roleId: "rol1" }]);
        const niveles = interaccion({ customId: "paneladmin_levels_reward_role_5", values: ["x"], isRoleSelectMenu: () => true });
        expect(router.match(niveles).method).toBe("handleRoleSelect");
        const { handlePlexRoleSelect } = require("../src/adminPanel/plex");
        expect(await handlePlexRoleSelect(niveles)).toBe(false);
    });

    test("sin ser admin, no", async () => {
        const i = interaccion({
            customId: "paneladmin_plex_gordos_rol_1",
            values: ["rol10"],
            member: { permissions: { has: () => false } },
            memberPermissions: { has: () => false },
        });
        await paneladmin.handleRoleSelect(null, i);
        expect(guildSettings.getSettings(g).plex.rol_gordos_1).toBe("rol1");
    });
});
