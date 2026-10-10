// Roles de recompensa por nivel (systems/xp/roles.js): darlos al subir de nivel, el anuncio de subida, la
// configuración (listar, guardar, quitar, descripción) y el relleno de roles pendientes al arrancar (backfill).
// Usa la BD en memoria real; los servidores, miembros y canales son objetos simulados.
const db = require("../src/core/db");
const xp = require("../src/systems/xpSystem");
const rolesXp = require("../src/systems/xp/roles");

let n = 0;
const nuevoServidor = () => `g-roles-${++n}`;

function rol(id, name = `rol ${id}`) {
    return { id, name };
}

function miembro(id) {
    return {
        id,
        toString: () => `<@${id}>`,
        roles: { cache: new Map(), add: jest.fn(async () => {}) },
    };
}

function canalDeTexto(id, { texto = true, envia = async () => ({}) } = {}) {
    return { id, name: "anuncios", isTextBased: () => texto, send: jest.fn(envia) };
}

function servidor(id, { roles: lista = [], canales = [], miembros = [] } = {}) {
    return {
        id,
        name: `Servidor ${id}`,
        roles: { cache: new Map(lista.map((r) => [r.id, r])) },
        channels: { cache: new Map(canales.map((c) => [c.id, c])), fetch: jest.fn(async () => null) },
        members: {
            cache: new Map(miembros.map((m) => [m.id, m])),
            fetch: jest.fn(async () => new Map()),
        },
    };
}

function ponerUsuario(guildId, userId, nivel) {
    db.prepare("INSERT INTO xp_users (guildId, userId, nivel) VALUES (?, ?, ?)").run(guildId, userId, nivel);
}

describe("tryAssignRewards: dar los roles al subir de nivel", () => {
    test("sin servidor o sin miembro no hace nada", async () => {
        const m = miembro("u1");
        await rolesXp.tryAssignRewards(null, m, 0, 5);
        await rolesXp.tryAssignRewards(servidor(nuevoServidor()), null, 0, 5);
        expect(m.roles.add).not.toHaveBeenCalled();
    });

    test("da los roles de los niveles nuevos en orden, sin el nivel anterior y con el nuevo", async () => {
        const id = nuevoServidor();
        const r3 = rol("300");
        const r5 = rol("500");
        const r10 = rol("1000");
        const g = servidor(id, { roles: [r3, r5, r10] });
        rolesXp.setReward(id, 10, r10.id, "Diez");
        rolesXp.setReward(id, 3, r3.id, "Tres");
        rolesXp.setReward(id, 5, r5.id, "Cinco");
        const m = miembro("u1");

        await rolesXp.tryAssignRewards(g, m, 2, 10);

        expect(m.roles.add.mock.calls.map(([r]) => r.id)).toEqual(["300", "500", "1000"]);
    });

    test("el nivel de partida no se vuelve a dar: con 5 como anterior, el de nivel 5 queda fuera", async () => {
        const id = nuevoServidor();
        const r5 = rol("500");
        const r10 = rol("1000");
        const g = servidor(id, { roles: [r5, r10] });
        rolesXp.setReward(id, 5, r5.id, "Cinco");
        rolesXp.setReward(id, 10, r10.id, "Diez");
        const m = miembro("u1");

        await rolesXp.tryAssignRewards(g, m, 5, 10);

        expect(m.roles.add.mock.calls.map(([r]) => r.id)).toEqual(["1000"]);
    });

    test("si no se pasa ningún nivel con recompensa no da nada", async () => {
        const id = nuevoServidor();
        const r5 = rol("500");
        const g = servidor(id, { roles: [r5] });
        rolesXp.setReward(id, 5, r5.id, "Cinco");
        const m = miembro("u1");

        await rolesXp.tryAssignRewards(g, m, 5, 5);
        await rolesXp.tryAssignRewards(g, m, 0, 4);

        expect(m.roles.add).not.toHaveBeenCalled();
    });

    test("un rol que ya no existe en el servidor se salta sin cortar a los demás", async () => {
        const id = nuevoServidor();
        const r5 = rol("500");
        const g = servidor(id, { roles: [r5] });
        rolesXp.setReward(id, 4, "444", "Borrado");
        rolesXp.setReward(id, 5, r5.id, "Cinco");
        const m = miembro("u1");

        await rolesXp.tryAssignRewards(g, m, 0, 5);

        expect(m.roles.add.mock.calls.map(([r]) => r.id)).toEqual(["500"]);
    });

    test("si Discord rechaza un rol (p. ej. le falta permiso), sigue con los siguientes", async () => {
        const id = nuevoServidor();
        const r3 = rol("300");
        const r5 = rol("500");
        const g = servidor(id, { roles: [r3, r5] });
        rolesXp.setReward(id, 3, r3.id, "Tres");
        rolesXp.setReward(id, 5, r5.id, "Cinco");
        const m = miembro("u1");
        m.roles.add.mockRejectedValueOnce(new Error("Missing Permissions"));

        await expect(rolesXp.tryAssignRewards(g, m, 0, 5)).resolves.toBeUndefined();

        expect(m.roles.add).toHaveBeenCalledTimes(2);
        expect(m.roles.add.mock.calls[1][0].id).toBe("500");
    });
});

describe("maybeAnnounceLevelUp: el anuncio de subida de nivel", () => {
    test("sin canal de anuncios configurado no envía ni busca nada", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c-sin-config");
        const g = servidor(id, { canales: [canal] });

        await rolesXp.maybeAnnounceLevelUp(g, miembro("u1"), 5);

        expect(canal.send).not.toHaveBeenCalled();
        expect(g.channels.fetch).not.toHaveBeenCalled();
    });

    test("sin servidor o sin miembro no hace nada", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c1");
        xp.setConfig(id, "xp_announce_channel_id", "c1");
        const g = servidor(id, { canales: [canal] });

        await expect(rolesXp.maybeAnnounceLevelUp(null, miembro("u1"), 5)).resolves.toBeUndefined();
        await rolesXp.maybeAnnounceLevelUp(g, null, 5);
        expect(canal.send).not.toHaveBeenCalled();
    });

    test("el embed trae el rango actual, el siguiente, la XP que falta y el rol de recompensa", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c1");
        xp.setConfig(id, "xp_announce_channel_id", "c1");
        rolesXp.setReward(id, 10, "1000", "Diez");
        rolesXp.setRewardDescription(id, 10, "1000", "Mover usuarios", "🚶");
        const g = servidor(id, { canales: [canal] });

        await rolesXp.maybeAnnounceLevelUp(g, miembro("u1"), 10);

        expect(canal.send).toHaveBeenCalledTimes(1);
        const embed = canal.send.mock.calls[0][0].embeds[0].data;
        const campo = (nombre) => embed.fields.find((f) => f.name === nombre).value;
        expect(embed.description).toBe("<@u1> alcanzó el **Nivel 10**");
        expect(campo("Rango actual")).toContain("**PLATA**");
        expect(campo("Siguiente rango")).toContain("ORO (LV 15)");
        expect(campo("XP próximo nivel")).toBe(String(xp.xpForNextLevel(10, id, "u1")));
        expect(campo("Recompensa de nivel")).toBe("<@&1000>");
        expect(embed.footer.text).toBe(`Servidor: Servidor ${id}`);
    });

    test("en el último rango no hay siguiente, y sin recompensa en el nivel lo dice", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c1");
        xp.setConfig(id, "xp_announce_channel_id", "c1");
        const g = servidor(id, { canales: [canal] });

        await rolesXp.maybeAnnounceLevelUp(g, miembro("u1"), 75);

        const embed = canal.send.mock.calls[0][0].embeds[0].data;
        const campo = (nombre) => embed.fields.find((f) => f.name === nombre).value;
        expect(campo("Rango actual")).toContain("**MAMUT**");
        expect(campo("Siguiente rango")).toBe("🏁 Máximo rango");
        expect(campo("Recompensa de nivel")).toBe("Sin recompensa de rol en este nivel");
    });

    test("antes del primer rango el rango es SIN RANGO y el siguiente es BRONCE", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c1");
        xp.setConfig(id, "xp_announce_channel_id", "c1");
        const g = servidor(id, { canales: [canal] });

        await rolesXp.maybeAnnounceLevelUp(g, miembro("u1"), 1);

        const embed = canal.send.mock.calls[0][0].embeds[0].data;
        const campo = (nombre) => embed.fields.find((f) => f.name === nombre).value;
        expect(campo("Rango actual")).toContain("**SIN RANGO**");
        expect(campo("Siguiente rango")).toContain("BRONCE (LV 2)");
    });

    test("si el canal no está en caché se busca con fetch", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c-fetch");
        xp.setConfig(id, "xp_announce_channel_id", "c-fetch");
        const g = servidor(id);
        g.channels.fetch = jest.fn(async () => canal);

        await rolesXp.maybeAnnounceLevelUp(g, miembro("u1"), 3);

        expect(g.channels.fetch).toHaveBeenCalledWith("c-fetch");
        expect(canal.send).toHaveBeenCalledTimes(1);
    });

    test("si el canal no existe o no es de texto, no envía nada", async () => {
        const id = nuevoServidor();
        xp.setConfig(id, "xp_announce_channel_id", "c-raro");

        const sinCanal = servidor(id);
        sinCanal.channels.fetch = jest.fn(async () => null);
        await rolesXp.maybeAnnounceLevelUp(sinCanal, miembro("u1"), 3);

        const canalDeVoz = canalDeTexto("c-raro", { texto: false });
        const conVoz = servidor(id, { canales: [canalDeVoz] });
        await rolesXp.maybeAnnounceLevelUp(conVoz, miembro("u1"), 3);

        expect(canalDeVoz.send).not.toHaveBeenCalled();
    });

    test("si Discord no deja enviar el anuncio, el fallo no se propaga", async () => {
        const id = nuevoServidor();
        xp.setConfig(id, "xp_announce_channel_id", "c1");
        const canal = canalDeTexto("c1", {
            envia: async () => {
                throw new Error("Missing Access");
            },
        });
        const g = servidor(id, { canales: [canal] });

        await expect(rolesXp.maybeAnnounceLevelUp(g, miembro("u1"), 3)).resolves.toBeUndefined();
        expect(canal.send).toHaveBeenCalledTimes(1);
    });

    // El objeto plano llega desde xp.adjustUserXp (progreso.js) cuando el miembro no está en caché. Antes
    // `member?.toString?.()` devolvía "[object Object]"; ahora se usa `<@id>` (src/systems/xp/roles.js).
    test("menciona a la persona aunque el miembro sea un objeto plano {id} (ajuste manual de XP)", async () => {
        const id = nuevoServidor();
        const canal = canalDeTexto("c1");
        xp.setConfig(id, "xp_announce_channel_id", "c1");
        const g = servidor(id, { canales: [canal] });

        await rolesXp.maybeAnnounceLevelUp(g, { id: "u-plano" }, 10);

        expect(canal.send.mock.calls[0][0].embeds[0].data.description).toBe("<@u-plano> alcanzó el **Nivel 10**");
    });
});

describe("configuración de recompensas", () => {
    test("getRewards devuelve solo las de ese servidor, ordenadas por nivel", () => {
        const id = nuevoServidor();
        rolesXp.setReward(id, 20, "2000", "Veinte");
        rolesXp.setReward(id, 2, "200", "Dos");
        rolesXp.setReward(nuevoServidor(), 7, "700", "Otro servidor");

        expect(rolesXp.getRewards(id).map((r) => r.nivel)).toEqual([2, 20]);
    });

    test("setReward guarda o actualiza el nombre del rol; sin nombre queda en null", () => {
        const id = nuevoServidor();
        rolesXp.setReward(id, 4, "77", "viejo");
        rolesXp.setReward(id, 4, "77", "nuevo");
        rolesXp.setReward(id, 4, "78");

        const filas = rolesXp.getRewards(id);
        expect(filas).toHaveLength(2);
        expect(filas.find((r) => r.roleId === "77").roleName).toBe("nuevo");
        expect(filas.find((r) => r.roleId === "78").roleName).toBeNull();
    });

    test("setRewardDescription solo cambia recompensas que existen y con ese rol", () => {
        const id = nuevoServidor();
        rolesXp.setReward(id, 9, "900", "Nueve");

        expect(rolesXp.setRewardDescription(id, 8, "900", "x", "x")).toBe(false);
        expect(rolesXp.setRewardDescription(id, 9, "999", "x", "x")).toBe(false);
        expect(rolesXp.setRewardDescription(id, 9, "900", "Acceso a la sala", "🎧")).toBe(true);
        expect(rolesXp.getRewards(id)[0]).toMatchObject({ descripcion: "Acceso a la sala", emoji: "🎧" });
    });

    test("una descripción y un emoji vacíos se guardan como null", () => {
        const id = nuevoServidor();
        rolesXp.setReward(id, 9, "900", "Nueve");
        rolesXp.setRewardDescription(id, 9, "900", "Algo", "🎧");

        expect(rolesXp.setRewardDescription(id, 9, "900", "", "")).toBe(true);
        expect(rolesXp.getRewards(id)[0]).toMatchObject({ descripcion: null, emoji: null });
    });

    test("removeReward sin rol quita todo el nivel y con rol solo ese rol", () => {
        const id = nuevoServidor();
        rolesXp.setReward(id, 5, "500", "A");
        rolesXp.setReward(id, 5, "501", "B");
        rolesXp.setReward(id, 6, "600", "C");

        rolesXp.removeReward(id, 5, "501");
        expect(rolesXp.getRewards(id).map((r) => r.roleId)).toEqual(["500", "600"]);

        rolesXp.removeReward(id, 5);
        expect(rolesXp.getRewards(id).map((r) => r.roleId)).toEqual(["600"]);
    });
});

describe("backfillRoles: dar los roles pendientes al arrancar", () => {
    test("sin servidor no hace nada", async () => {
        await expect(rolesXp.backfillRoles(null)).resolves.toBeUndefined();
    });

    test("da lo que falta a quien tiene nivel, sin repetir lo que ya tiene y sin tocar a los que no son de nivel", async () => {
        const id = nuevoServidor();
        const r3 = rol("300");
        const r5 = rol("500");
        const r9 = rol("900");
        const ua = miembro("ua");
        ua.roles.cache.set("300", r3); // ya tiene el de nivel 3
        const ub = miembro("ub");
        const uc = miembro("uc"); // nivel 0: no cuenta
        const g = servidor(id, { roles: [r3, r5, r9], miembros: [ua, ub, uc] });
        rolesXp.setReward(id, 3, "300", "Tres");
        rolesXp.setReward(id, 5, "500", "Cinco");
        rolesXp.setReward(id, 9, "900", "Nueve");
        ponerUsuario(id, "ua", 5);
        ponerUsuario(id, "ub", 3);
        ponerUsuario(id, "uc", 0);
        ponerUsuario(id, "ud", 9); // no está en caché: se salta

        const asignados = await rolesXp.backfillRoles(g);

        expect(asignados).toBe(2);
        expect(ua.roles.add.mock.calls.map(([r]) => r.id)).toEqual(["500"]);
        expect(ub.roles.add.mock.calls.map(([r]) => r.id)).toEqual(["300"]);
        expect(uc.roles.add).not.toHaveBeenCalled();
    });

    test("un rol que ya no existe se ignora y no cuenta", async () => {
        const id = nuevoServidor();
        const m = miembro("u1");
        const g = servidor(id, { miembros: [m] });
        rolesXp.setReward(id, 2, "gone", "Borrado");
        ponerUsuario(id, "u1", 2);

        expect(await rolesXp.backfillRoles(g)).toBe(0);
        expect(m.roles.add).not.toHaveBeenCalled();
    });

    test("si Discord rechaza un rol, no cuenta como asignado y sigue con el resto", async () => {
        const id = nuevoServidor();
        const r3 = rol("300");
        const r5 = rol("500");
        const m = miembro("u1");
        m.roles.add.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error("Missing Permissions"));
        const g = servidor(id, { roles: [r3, r5], miembros: [m] });
        rolesXp.setReward(id, 3, "300", "Tres");
        rolesXp.setReward(id, 5, "500", "Cinco");
        ponerUsuario(id, "u1", 5);

        expect(await rolesXp.backfillRoles(g)).toBe(1);
        expect(m.roles.add).toHaveBeenCalledTimes(2);
    });

    test("si no se puede cargar la lista de miembros, usa lo que haya en caché", async () => {
        const id = nuevoServidor();
        const r3 = rol("300");
        const m = miembro("u1");
        const g = servidor(id, { roles: [r3], miembros: [m] });
        g.members.fetch = jest.fn(async () => {
            throw new Error("rate limited");
        });
        rolesXp.setReward(id, 3, "300", "Tres");
        ponerUsuario(id, "u1", 4);

        await expect(rolesXp.backfillRoles(g)).resolves.toBe(1);
        expect(g.members.fetch).toHaveBeenCalled();
    });
});
