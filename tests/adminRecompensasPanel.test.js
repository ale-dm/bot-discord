// Panel admin → Niveles → Recompensas (#238): listado, formularios, búsqueda paginada por nombre y guardado de
// recompensas por selector, búsqueda o ID. Usa la base de datos en memoria real (xpSystem), no mocks de la lógica.
const xp = require("../src/systems/xpSystem");
const { boton, modal, selectRol, selectTexto } = require("../src/adminPanel/niveles/recompensas");

const G = "g-admin-recompensas";
const ROL_A = "10000000000000001";
const ROL_B = "10000000000000002";

function roles(...lista) {
    return new Map(lista.map(([id, name, position]) => [id, { id, name, position }]));
}

function interaccion(extra = {}) {
    const cache = roles([ROL_A, "Moderador", 5], [ROL_B, "@everyone", 0]);
    return {
        customId: "",
        guildId: G,
        guild: { id: G, roles: { cache, fetch: jest.fn(async () => null) } },
        user: { id: "admin-1", username: "admin", tag: "admin#0001" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        values: [],
        ...extra,
    };
}

function campos(valores) {
    return { getTextInputValue: (id) => valores[id] ?? "" };
}

const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const idsDeModal = (m) => m.components.map((fila) => fila.components[0].data.custom_id);

describe("listado de recompensas", () => {
    beforeEach(() => {
        xp.removeReward(G, 5);
        xp.removeReward(G, 30);
    });

    test("sin recompensas lo dice", async () => {
        const i = interaccion({ customId: "paneladmin_levels_rewards" });
        expect(await boton(i)).toBe(true);
        expect(ultimo(i.update).embeds[0].data.description).toBe("No hay recompensas configuradas.");
    });

    test("lista cada recompensa con su nivel, rol y descripción", async () => {
        xp.setReward(G, 5, ROL_A, "Moderador");
        xp.setRewardDescription(G, 5, ROL_A, "Mover usuarios", "🚶");
        xp.setReward(G, 30, ROL_B, "");
        const i = interaccion({ customId: "paneladmin_levels_rewards" });
        await boton(i);
        const texto = ultimo(i.update).embeds[0].data.description;
        expect(texto).toContain(`**LVL 5** → <@&${ROL_A}> — 🚶 Mover usuarios`);
        expect(texto).toContain(`**LVL 30** → <@&${ROL_B}>`);
        expect(texto).not.toContain(`**LVL 30** → <@&${ROL_B}> —`);
    });

    test("los botones de añadir, buscar, por ID, quitar y descripción aparecen", async () => {
        const i = interaccion({ customId: "paneladmin_levels_rewards" });
        await boton(i);
        const filas = ultimo(i.update).components;
        const ids = filas.flatMap((f) => f.components.map((c) => c.data.custom_id));
        expect(ids).toEqual(
            expect.arrayContaining([
                "paneladmin_levels_reward_add",
                "paneladmin_levels_reward_search",
                "paneladmin_levels_reward_add_manual",
                "paneladmin_levels_reward_remove",
                "paneladmin_levels_reward_desc",
                "paneladmin_levels_home",
            ]),
        );
    });
});

describe("formularios de recompensas", () => {
    test.each([
        ["paneladmin_levels_reward_add", "paneladmin_levels_reward_add_modal", ["nivel"]],
        ["paneladmin_levels_reward_search", "paneladmin_levels_reward_search_modal", ["nivel", "query"]],
        ["paneladmin_levels_reward_add_manual", "paneladmin_levels_reward_add_manual_modal", ["nivel", "role_id"]],
        ["paneladmin_levels_reward_remove", "paneladmin_levels_reward_remove_modal", ["nivel", "role_id"]],
        ["paneladmin_levels_reward_desc", "paneladmin_levels_reward_desc_modal", ["nivel", "role_id", "emoji", "descripcion"]],
    ])("%s abre el modal %s", async (boton_, modalId, campos_) => {
        const i = interaccion({ customId: boton_ });
        expect(await boton(i)).toBe(true);
        const m = ultimo(i.showModal);
        expect(m.data.custom_id).toBe(modalId);
        expect(idsDeModal(m)).toEqual(campos_);
    });

    test("un botón desconocido no lo gestiona este módulo", async () => {
        expect(await boton(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
        expect(await modal(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
    });
});

describe("añadir recompensa con selector de rol", () => {
    test("un nivel inválido se rechaza", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_add_modal", fields: campos({ nivel: "0" }) });
        await modal(i);
        expect(ultimo(i.reply).content).toBe("Nivel inválido.");
    });

    test("un nivel válido muestra el selector de rol para ese nivel", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_add_modal", fields: campos({ nivel: "12" }) });
        await modal(i);
        expect(ultimo(i.reply).components[0].components[0].data.custom_id).toBe("paneladmin_levels_reward_role_12");
    });

    test("elegir el rol en el selector lo guarda para el nivel", async () => {
        xp.removeReward(G, 12, ROL_A);
        const i = interaccion({ customId: "paneladmin_levels_reward_role_12", values: [ROL_A] });
        expect(await selectRol(i)).toBe(true);
        expect(xp.getRewards(G).some((r) => r.nivel === 12 && r.roleId === ROL_A && r.roleName === "Moderador")).toBe(true);
        expect(ultimo(i.reply).content).toContain("LVL 12");
    });

    test("selectRol ignora otros componentes", async () => {
        expect(await selectRol(interaccion({ customId: "otra_cosa", values: [ROL_A] }))).toBe(false);
    });
});

describe("descripción de recompensas", () => {
    test("si la recompensa no existe, lo dice sin tocar nada", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_reward_desc_modal",
            fields: campos({ nivel: "77", role_id: ROL_B, emoji: "", descripcion: "Algo" }),
        });
        await modal(i);
        expect(ultimo(i.reply).content).toContain("No hay ninguna recompensa");
    });

    test("guarda emoji y descripción, quitando menciones del ID de rol", async () => {
        xp.setReward(G, 9, ROL_A, "Moderador");
        const i = interaccion({
            customId: "paneladmin_levels_reward_desc_modal",
            fields: campos({ nivel: "9", role_id: `<@&${ROL_A}>`, emoji: "🎧", descripcion: "Acceso a la sala" }),
        });
        await modal(i);
        const fila = xp.getRewards(G).find((r) => r.nivel === 9);
        expect(fila.descripcion).toBe("Acceso a la sala");
        expect(fila.emoji).toBe("🎧");
        expect(ultimo(i.reply).content).toContain("Acceso a la sala");
    });

    test("una descripción vacía la quita y la recompensa pasa a mostrarse como rango", async () => {
        xp.setReward(G, 10, ROL_A, "Moderador");
        xp.setRewardDescription(G, 10, ROL_A, "Antes tenía texto", "🔓");
        const i = interaccion({
            customId: "paneladmin_levels_reward_desc_modal",
            fields: campos({ nivel: "10", role_id: ROL_A, emoji: "", descripcion: "   " }),
        });
        await modal(i);
        expect(xp.getRewards(G).find((r) => r.nivel === 10).descripcion).toBeNull();
        expect(ultimo(i.reply).content).toContain("Descripción quitada");
    });
});

describe("quitar recompensas", () => {
    test("un nivel inválido se rechaza", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_remove_modal", fields: campos({ nivel: "abc", role_id: "" }) });
        await modal(i);
        expect(ultimo(i.reply).content).toBe("Nivel inválido.");
    });

    test("un rol con formato inválido se rechaza", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_remove_modal", fields: campos({ nivel: "4", role_id: "nope" }) });
        await modal(i);
        expect(ultimo(i.reply).content).toContain("Rol inválido");
    });

    test("con un rol concreto quita solo esa recompensa del nivel", async () => {
        xp.setReward(G, 20, ROL_A, "Moderador");
        xp.setReward(G, 20, ROL_B, "Otro");
        const i = interaccion({
            customId: "paneladmin_levels_reward_remove_modal",
            fields: campos({ nivel: "20", role_id: `<@&${ROL_A}>` }),
        });
        await modal(i);
        const quedan = xp
            .getRewards(G)
            .filter((r) => r.nivel === 20)
            .map((r) => r.roleId);
        expect(quedan).toEqual([ROL_B]);
        expect(ultimo(i.reply).content).toContain("quitada");
    });

    test("sin rol quita todas las recompensas del nivel", async () => {
        xp.setReward(G, 21, ROL_A, "Moderador");
        xp.setReward(G, 21, ROL_B, "Otro");
        const i = interaccion({ customId: "paneladmin_levels_reward_remove_modal", fields: campos({ nivel: "21", role_id: "" }) });
        await modal(i);
        expect(xp.getRewards(G).filter((r) => r.nivel === 21)).toHaveLength(0);
        expect(ultimo(i.reply).content).toContain("Todas las recompensas de LVL 21");
    });
});

describe("añadir recompensa por ID", () => {
    test("un nivel inválido o un ID mal formado se rechazan", async () => {
        const a = interaccion({ customId: "paneladmin_levels_reward_add_manual_modal", fields: campos({ nivel: "-1", role_id: ROL_A }) });
        await modal(a);
        expect(ultimo(a.reply).content).toBe("Nivel inválido.");

        const b = interaccion({ customId: "paneladmin_levels_reward_add_manual_modal", fields: campos({ nivel: "3", role_id: "12" }) });
        await modal(b);
        expect(ultimo(b.reply).content).toContain("Rol inválido");
    });

    test("un rol que no existe en el servidor se avisa", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_reward_add_manual_modal",
            fields: campos({ nivel: "3", role_id: "19999999999999999" }),
        });
        await modal(i);
        expect(i.guild.roles.fetch).toHaveBeenCalledWith("19999999999999999");
        expect(ultimo(i.reply).content).toContain("No encontré ese rol");
    });

    test("un rol que no está en caché pero sí en el servidor se guarda", async () => {
        const id = "19999999999999998";
        const i = interaccion({
            customId: "paneladmin_levels_reward_add_manual_modal",
            fields: campos({ nivel: "3", role_id: `<@&${id}>` }),
        });
        i.guild.roles.fetch = jest.fn(async () => ({ id, name: "Rescatado" }));
        await modal(i);
        expect(xp.getRewards(G).some((r) => r.nivel === 3 && r.roleId === id)).toBe(true);
        expect(ultimo(i.reply).content).toContain(`<@&${id}>`);
    });
});

describe("buscar rol por nombre", () => {
    test("datos inválidos (sin texto o nivel) se rechazan", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_search_modal", fields: campos({ nivel: "5", query: "  " }) });
        await modal(i);
        expect(ultimo(i.reply).content).toBe("Datos inválidos.");
    });

    test("encuentra roles por nombre, sin los que empiezan por @", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_reward_search_modal",
            fields: campos({ nivel: "5", query: "MODER" }),
        });
        await modal(i);
        const payload = ultimo(i.reply);
        expect(payload.content).toContain('Resultados para "moder"');
        const select = payload.components[0].components[0];
        expect(select.data.custom_id).toBe("paneladmin_levels_reward_search_pick_5");
        expect(select.options.map((o) => o.data.value)).toEqual([ROL_A]);
    });

    test("sin coincidencias dice que no encontró roles", async () => {
        const i = interaccion({
            customId: "paneladmin_levels_reward_search_modal",
            fields: campos({ nivel: "5", query: "inexistente" }),
        });
        await modal(i);
        expect(ultimo(i.reply).content).toContain("No encontré roles");
    });

    test("con más de 25 resultados se pagina y los botones de página funcionan", async () => {
        const muchos = [];
        // Ids como texto: un número de 17 cifras pierde precisión en un Number.
        for (let k = 0; k < 30; k++) muchos.push([`3000000000000${String(k).padStart(4, "0")}`, `Equipo ${k}`, k]);
        const i = interaccion({
            customId: "paneladmin_levels_reward_search_modal",
            fields: campos({ nivel: "8", query: "equipo" }),
            guild: { id: G, roles: { cache: roles(...muchos), fetch: jest.fn(async () => null) } },
        });
        await modal(i);
        const primera = ultimo(i.reply);
        expect(primera.components[0].components[0].options).toHaveLength(25);
        expect(primera.components[1].components[1].data.disabled).toBe(false);

        const segunda = interaccion({
            customId: "paneladmin_levels_reward_search_page_8_1",
            guild: i.guild,
        });
        expect(await boton(segunda)).toBe(true);
        const payload = ultimo(segunda.update);
        expect(payload.components[0].components[0].options).toHaveLength(5);
        expect(payload.components[0].components[0].data.placeholder).toContain("(2/2)");
        expect(payload.flags).toBeUndefined();
    });

    test("pedir una página sin sesión de búsqueda avisa de que caducó", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_search_page_99_0" });
        await boton(i);
        expect(ultimo(i.update).content).toContain("Sesión caducada");
    });

    test("elegir un resultado del selector guarda la recompensa", async () => {
        const i = interaccion({ customId: "paneladmin_levels_reward_search_pick_15", values: [ROL_A] });
        expect(await selectTexto(i)).toBe(true);
        expect(xp.getRewards(G).some((r) => r.nivel === 15 && r.roleId === ROL_A)).toBe(true);
        expect(await selectTexto(interaccion({ customId: "otra_cosa", values: [ROL_A] }))).toBe(false);
    });
});
