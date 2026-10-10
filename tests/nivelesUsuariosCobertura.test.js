// Panel admin → Niveles → 👤 Usuarios (adminPanel/niveles/usuarios.js): ajustar la XP de alguien (sumar o restar),
// ver su perfil, resetearla con confirmación y cambiar su multiplicador de coste. Los permisos se comprueban por el
// router del panel. Usa la BD en memoria real (xp de systems/xpSystem); el servidor y los miembros son simulados.
const db = require("../src/core/db");
const xp = require("../src/systems/xpSystem");
const paneladmin = require("../src/commands/admin/paneladmin");
const usuarios = require("../src/adminPanel/niveles/usuarios");

// Servidor sin racha, para que las cuentas de XP sean exactas (la racha daría un +2% el primer día).
const G = "g-niveles-usuarios";
xp.setConfig(G, "streak_enabled", "0");
const ADMIN = { has: (permiso) => permiso === "Administrator" };
const NO_ADMIN = { has: () => false };

let n = 0;
const uid = () => `1000000000000000${++n}`;

function servidor({ id = G, canal = null, miembros = [] } = {}) {
    return {
        id,
        name: "Servidor de niveles",
        members: {
            cache: new Map(miembros.map((m) => [m.id, m])),
            fetch: jest.fn(async () => null),
        },
        channels: {
            cache: new Map(canal ? [[canal.id, canal]] : []),
            fetch: jest.fn(async () => null),
        },
        roles: { cache: new Map() },
    };
}

function interaccion(extra = {}, { admin = true } = {}) {
    return {
        customId: "",
        guildId: G,
        guild: servidor(),
        user: { id: "admin-1", username: "admin", tag: "admin#0001" },
        memberPermissions: admin ? ADMIN : NO_ADMIN,
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        fields: { getTextInputValue: () => "" },
        values: [],
        ...extra,
    };
}

function campos(valores) {
    return { getTextInputValue: (id) => valores[id] ?? "", getSelectedUsers: (id) => (valores[id] ? new Map([[valores[id], {}]]) : null) };
}

const ultimo = (mock) => mock.mock.calls.at(-1)[0];
const idsDeModal = (m) => m.toJSON().components.map((fila) => (fila.component ?? fila.components[0]).custom_id);
const campoDe = (embed, nombre) => embed.fields.find((f) => f.name === nombre).value;
const auditoria = (accion) =>
    db.prepare("SELECT details FROM admin_audit WHERE guildId = ? AND action = ? ORDER BY id DESC LIMIT 1").get(G, accion);
const fila = (userId) => db.prepare("SELECT xp_total, nivel, xp FROM xp_users WHERE guildId = ? AND userId = ?").get(G, userId);

describe("permisos: solo un admin toca la XP de usuarios", () => {
    test("un no admin no puede abrir el formulario de ajuste", async () => {
        const i = interaccion({ customId: "paneladmin_levels_user_adjust" }, { admin: false });

        await paneladmin.handleButton({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(i.showModal).not.toHaveBeenCalled();
    });

    test("un no admin no puede confirmar un reseteo de XP", async () => {
        const u = uid();
        await xp.adjustUserXp(servidor(), u, 300);
        const i = interaccion({ customId: `paneladmin_levels_confirm_reset_${u}` }, { admin: false });

        await paneladmin.handleButton({}, i);

        expect(ultimo(i.reply).content).toBe("No tienes permisos.");
        expect(fila(u)).toBeDefined();
    });

    test("un admin sí llega a la pantalla de usuarios", async () => {
        const i = interaccion({ customId: "paneladmin_levels_users" });

        await paneladmin.handleButton({}, i);

        expect(i.update).toHaveBeenCalledTimes(1);
    });
});

describe("pantalla de usuarios", () => {
    test("muestra los cinco botones de gestión", async () => {
        const i = interaccion({ customId: "paneladmin_levels_users" });

        expect(await usuarios.boton(i)).toBe(true);

        const embed = ultimo(i.update).embeds[0].data;
        expect(embed.title).toBe("👤 Gestión XP usuarios");
        const ids = ultimo(i.update).components[0].components.map((b) => b.data.custom_id);
        expect(ids).toEqual([
            "paneladmin_levels_user_adjust",
            "paneladmin_levels_user_reset",
            "paneladmin_levels_user_view",
            "paneladmin_levels_user_mult",
            "paneladmin_levels_home",
        ]);
    });

    test("cada botón abre su formulario con los campos que necesita", async () => {
        const casos = [
            ["paneladmin_levels_user_adjust", "paneladmin_levels_user_adjust_modal", ["user_id", "amount"]],
            ["paneladmin_levels_user_reset", "paneladmin_levels_user_reset_modal", ["user_id"]],
            ["paneladmin_levels_user_view", "paneladmin_levels_user_view_modal", ["user_id"]],
        ];
        for (const [boton, modalId, campos_] of casos) {
            const i = interaccion({ customId: boton });
            expect(await usuarios.boton(i)).toBe(true);
            expect(ultimo(i.showModal).data.custom_id).toBe(modalId);
            expect(idsDeModal(ultimo(i.showModal))).toEqual(campos_);
        }
    });

    // Antes la etiqueta del campo tenía 47 caracteres y Discord admite 45: el formulario no se construía. Ahora
    // la etiqueta cabe (src/adminPanel/niveles/usuarios.js, botón paneladmin_levels_user_mult).
    test("el botón de multiplicador abre su formulario", async () => {
        const i = interaccion({ customId: "paneladmin_levels_user_mult" });

        await usuarios.boton(i);

        expect(ultimo(i.showModal).data.custom_id).toBe("paneladmin_levels_user_mult_modal");
    });

    test("un botón que no es de usuarios no lo gestiona este módulo", async () => {
        expect(await usuarios.boton(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
        expect(await usuarios.modal(interaccion({ customId: "paneladmin_otra_cosa" }))).toBe(false);
    });
});

describe("ajustar XP (sumar o restar)", () => {
    function ajuste(userId, cantidad, { guild = servidor() } = {}) {
        return interaccion({
            customId: "paneladmin_levels_user_adjust_modal",
            guild,
            fields: campos({ user_id: userId, amount: cantidad }),
        });
    }

    test("un ID de usuario que no es un ID de Discord o una cantidad que no es número se rechazan", async () => {
        const u = uid();
        const malId = ajuste("nope", "150");
        await usuarios.modal(malId);
        expect(ultimo(malId.reply).content).toBe("ID o cantidad inválida.");

        const malCantidad = ajuste(u, "mucho");
        await usuarios.modal(malCantidad);
        expect(ultimo(malCantidad.reply).content).toBe("ID o cantidad inválida.");
        expect(fila(u)).toBeUndefined();
    });

    test("sumar XP la añade, responde con el nivel y el total, y lo audita", async () => {
        const u = uid();
        const i = ajuste(u, "150");

        await usuarios.modal(i);

        expect(fila(u)).toMatchObject({ xp_total: 150, nivel: 0 });
        expect(ultimo(i.reply).content).toBe("✅ XP ajustada. LVL 0, total 150.");
        expect(JSON.parse(auditoria("xp.user.adjust").details)).toEqual({ userId: u, amount: 150 });
    });

    test("restar XP quita el total y recalcula el nivel", async () => {
        const u = uid();
        db.prepare("INSERT INTO xp_users (guildId, userId, xp_total, nivel, xp) VALUES (?, ?, 6200, 1, 0)").run(G, u);
        const i = ajuste(u, "-1000");

        await usuarios.modal(i);

        // 5200 de total: 1600 para pasar del nivel 0 y 3600 que quedan en el nivel 1 (que pide 4525).
        expect(fila(u)).toEqual({ xp_total: 5200, nivel: 1, xp: 3600 });
        expect(ultimo(i.reply).content).toBe("✅ XP ajustada. LVL 1, total 5200.");
    });

    test("restar más de lo que tiene deja el total en 0", async () => {
        const u = uid();
        await xp.adjustUserXp(servidor(), u, 300);

        await usuarios.modal(ajuste(u, "-1000"));

        expect(fila(u)).toEqual({ xp_total: 0, nivel: 0, xp: 0 });
    });

    test("ajustar en 0 no cambia nada", async () => {
        const u = uid();
        await xp.adjustUserXp(servidor(), u, 300);

        await usuarios.modal(ajuste(u, "0"));

        expect(fila(u).xp_total).toBe(300);
    });

    test("si sube de nivel, lo anuncia en el canal con la persona mencionada", async () => {
        const u = uid();
        const canal = { id: "c-anuncios", name: "anuncios", isTextBased: () => true, send: jest.fn(async () => {}) };
        xp.setConfig(G, "xp_announce_channel_id", canal.id);
        const miembro = { id: u, toString: () => `<@${u}>`, roles: { cache: new Map(), add: jest.fn(async () => {}) } };
        const guild = servidor({ canal, miembros: [miembro] });

        await usuarios.modal(ajuste(u, "2000", { guild }));

        expect(fila(u)).toMatchObject({ nivel: 1 });
        expect(canal.send).toHaveBeenCalledTimes(1);
        expect(canal.send.mock.calls[0][0].embeds[0].data.description).toBe(`<@${u}> alcanzó el **Nivel 1**`);
    });

    // Antes, si el miembro no estaba en caché, progreso.js pasaba un objeto plano { id } y el anuncio mostraba
    // "[object Object]". Ahora se usa la mención por id (src/systems/xp/roles.js, maybeAnnounceLevelUp).
    test("al subir de nivel por ajuste manual, menciona a la persona aunque no esté en caché", async () => {
        const u = uid();
        const canal = { id: "c-anuncios-2", name: "anuncios", isTextBased: () => true, send: jest.fn(async () => {}) };
        xp.setConfig(G, "xp_announce_channel_id", canal.id);

        await usuarios.modal(ajuste(u, "2000", { guild: servidor({ canal }) }));

        expect(canal.send.mock.calls[0][0].embeds[0].data.description).toBe(`<@${u}> alcanzó el **Nivel 1**`);
    });
});

describe("resetear XP con confirmación", () => {
    test("pedir el reseteo muestra la advertencia y los botones de confirmar o cancelar, sin borrar nada", async () => {
        const u = uid();
        await xp.adjustUserXp(servidor(), u, 300);
        const i = interaccion({
            customId: "paneladmin_levels_user_reset_modal",
            fields: campos({ user_id: u }),
        });

        await usuarios.modal(i);

        const respuesta = ultimo(i.reply);
        expect(respuesta.embeds[0].data.title).toBe("¿Confirmar reseteo de XP?");
        expect(respuesta.embeds[0].data.description).toContain(`<@${u}>`);
        const ids = respuesta.components[0].components.map((b) => b.data.custom_id);
        expect(ids).toEqual([`paneladmin_levels_confirm_reset_${u}`, "paneladmin_cancel"]);
        expect(fila(u)).toBeDefined();
    });

    test("un ID inválido en el reseteo se rechaza", async () => {
        const i = interaccion({ customId: "paneladmin_levels_user_reset_modal", fields: campos({ user_id: "123" }) });

        await usuarios.modal(i);

        expect(ultimo(i.reply).content).toBe("ID inválido.");
    });

    test("confirmar borra la XP de esa persona, lo audita y lo dice", async () => {
        const u = uid();
        await xp.adjustUserXp(servidor(), u, 300);
        const i = interaccion({ customId: `paneladmin_levels_confirm_reset_${u}` });

        expect(await usuarios.boton(i)).toBe(true);

        expect(fila(u)).toBeUndefined();
        expect(JSON.parse(auditoria("xp.user.reset").details)).toEqual({ userId: u });
        const payload = ultimo(i.update);
        expect(payload.embeds[0].data.title).toBe("✅ XP reseteada");
        expect(payload.components).toEqual([]);
    });
});

describe("ver perfil", () => {
    test("un ID inválido se rechaza", async () => {
        const i = interaccion({ customId: "paneladmin_levels_user_view_modal", fields: campos({ user_id: "abc" }) });

        await usuarios.modal(i);

        expect(ultimo(i.reply).content).toBe("ID inválido.");
    });

    test("muestra nivel, XP, total, ranking y multiplicador", async () => {
        // Servidor propio: el ranking depende de quién más tiene XP en el servidor.
        const R = "g-niveles-ranking";
        xp.setConfig(R, "streak_enabled", "0");
        const u = uid();
        const otro = uid();
        await xp.adjustUserXp(servidor({ id: R }), otro, 900);
        await xp.adjustUserXp(servidor({ id: R }), u, 100);
        const i = interaccion({
            guildId: R,
            guild: servidor({ id: R }),
            customId: "paneladmin_levels_user_view_modal",
            fields: campos({ user_id: u }),
        });

        await usuarios.modal(i);

        const embed = ultimo(i.reply).embeds[0].data;
        expect(embed.description).toContain(`<@${u}>`);
        expect(embed.description).toContain("**LVL 0**");
        expect(campoDe(embed, "XP nivel")).toBe(`100/${xp.xpForNextLevel(0, R, u)}`);
        expect(campoDe(embed, "XP total")).toBe("100");
        expect(campoDe(embed, "Ranking")).toBe("#2");
        expect(campoDe(embed, "Multiplicador de coste")).toBe("x1");
    });

    test("con multiplicador de coste, lo muestra y sube lo que cuesta el nivel", async () => {
        const u = uid();
        xp.setUserCostMultiplier(G, u, 2);
        const i = interaccion({ customId: "paneladmin_levels_user_view_modal", fields: campos({ user_id: u }) });

        await usuarios.modal(i);

        const embed = ultimo(i.reply).embeds[0].data;
        expect(campoDe(embed, "Multiplicador de coste")).toBe("x2");
        expect(campoDe(embed, "XP nivel")).toBe("0/3200");
    });
});

describe("multiplicador de coste de XP", () => {
    function multiplicador(userId, valor) {
        return interaccion({
            customId: "paneladmin_levels_user_mult_modal",
            fields: campos({ user_id: userId, multiplier: valor }),
        });
    }

    test("un ID o un multiplicador que no es número o es negativo se rechaza", async () => {
        const u = uid();
        for (const [id, valor] of [
            ["mal", "2"],
            [u, "abc"],
            [u, "-2"],
        ]) {
            const i = multiplicador(id, valor);
            await usuarios.modal(i);
            expect(ultimo(i.reply).content).toBe("ID o multiplicador inválido.");
        }
        expect(xp.getUserCostMultiplier(G, u)).toBe(1);
    });

    test.each(["1", "0"])("con %s quita el multiplicador y lo deja en x1", async (valor) => {
        const u = uid();
        xp.setUserCostMultiplier(G, u, 3);
        const i = multiplicador(u, valor);

        await usuarios.modal(i);

        expect(xp.getUserCostMultiplier(G, u)).toBe(1);
        expect(ultimo(i.reply).content).toBe(`✅ Multiplicador de <@${u}> restablecido a x1.`);
        expect(auditoria("xp.user.multiplier.clear")).toBeDefined();
    });

    test("con otro valor lo fija, lo audita y sube el coste de subir de nivel", async () => {
        const u = uid();
        const i = multiplicador(u, "2.5");

        await usuarios.modal(i);

        expect(xp.getUserCostMultiplier(G, u)).toBe(2.5);
        expect(xp.xpForNextLevel(0, G, u)).toBe(4000);
        expect(ultimo(i.reply).content).toBe(`✅ Multiplicador de coste de <@${u}> ajustado a x2.5.`);
        expect(JSON.parse(auditoria("xp.user.multiplier.set").details)).toEqual({ userId: u, multiplier: 2.5 });
    });

    test("un valor menor que 0.01 se guarda como 0.01 (mínimo)", async () => {
        const u = uid();

        await usuarios.modal(multiplicador(u, "0.001"));

        expect(xp.getUserCostMultiplier(G, u)).toBe(0.01);
    });
});
