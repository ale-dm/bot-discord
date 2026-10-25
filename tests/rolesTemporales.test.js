// ⏳ Roles temporales (#543): duración válida, asignar, renovar desde el vencimiento con el tope de 365 días, quitar antes de
// tiempo, vencer (también lo que venció con el bot apagado), jerarquía y permisos, rol borrado, auditoría, DM opcional y el
// panel admin. BD en memoria y un servidor de Discord falso; los DM se simulan.
const db = require("../src/core/db");
const adminAudit = require("../src/systems/adminAudit");
const avisosDm = require("../src/systems/avisosDm");
const rolesTemporales = require("../src/systems/rolesTemporales");
const envios = require("../src/discord/envios/rolesTemporales");
const paneladmin = require("../src/commands/admin/paneladmin");
const { buildConfigHome } = require("../src/adminPanel/settings/vistas");

const G = "g-roles-temp";
const DIA = rolesTemporales.DIA_MS;
const AHORA = 1_800_000_000_000;

/** Un servidor con un bot en la posición 10, los roles dados y miembros que guardan sus roles en un Set. */
function servidor({ roles = [], miembros = ["ana", "luis"], permisos = true } = {}) {
    const cacheRoles = new Map(roles.map((r) => [r.id, { position: 5, managed: false, name: r.id, ...r }]));
    const ms = new Map();
    for (const id of miembros) {
        const cache = new Set();
        ms.set(id, {
            id,
            displayName: id,
            roles: {
                cache: { has: (r) => cache.has(r) },
                add: jest.fn(async (role) => cache.add(role.id)),
                remove: jest.fn(async (role) => cache.delete(role.id)),
            },
        });
    }
    return {
        id: G,
        name: "Servidor",
        roles: { cache: cacheRoles },
        members: {
            me: { roles: { highest: { position: 10 } }, permissions: { has: () => permisos } },
            cache: ms,
            fetch: jest.fn(async (id) => ms.get(id) || Promise.reject(new Error("Unknown Member"))),
        },
    };
}
const cliente = (guild) => ({ user: { id: "bot" }, guilds: { cache: new Map(guild ? [[G, guild]] : []) } });
const filaDe = (id) => db.prepare("SELECT * FROM roles_temporales WHERE id = ?").get(id);
const acciones = () => adminAudit.listRecent(G, 100).map((r) => r.action);

beforeEach(() => {
    db.prepare("DELETE FROM roles_temporales").run();
    db.prepare("DELETE FROM admin_audit WHERE guildId = ?").run(G);
    jest.spyOn(avisosDm, "sendDm").mockResolvedValue(true);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("la duración (#543)", () => {
    test.each([
        ["7", 7],
        ["1", 1],
        ["365", 365],
        [" 30 ", 30],
    ])("«%s» vale %d días", (texto, dias) => {
        expect(rolesTemporales.diasValidos(texto)).toBe(dias);
    });

    test.each(["0", "366", "-1", "1.5", "abc", "", "1000"])("«%s» no vale", (texto) => {
        expect(rolesTemporales.diasValidos(texto)).toBeNull();
    });
});

describe("las reglas (#543)", () => {
    const base = { guildId: G, userId: "ana", roleId: "vip", porId: "admin", dias: 7 };

    test("asignar apunta quién, qué, desde cuándo y hasta cuándo", () => {
        const r = rolesTemporales.registrar(base, AHORA);
        expect(r).toEqual({ ok: true, id: expect.any(Number), vence: AHORA + 7 * DIA });
        expect(filaDe(r.id)).toMatchObject({
            userId: "ana",
            roleId: "vip",
            asignadoPor: "admin",
            inicio: AHORA,
            estado: "activo",
            avisar: 1,
        });
    });

    test("el mismo rol activo no se duplica; otro rol de la misma persona va aparte", () => {
        rolesTemporales.registrar(base, AHORA);
        expect(rolesTemporales.registrar(base, AHORA)).toEqual({ ok: false, motivo: expect.stringContaining("renuévalo") });
        expect(rolesTemporales.registrar({ ...base, roleId: "otro" }, AHORA).ok).toBe(true);
        expect(rolesTemporales.activos(G)).toHaveLength(2);
    });

    test("renovar suma desde el vencimiento actual", () => {
        const { id } = rolesTemporales.registrar(base, AHORA);
        expect(rolesTemporales.renovar(id, 3, AHORA + DIA)).toEqual({ ok: true, antes: AHORA + 7 * DIA, vence: AHORA + 10 * DIA });
    });

    test("si ya venció, renovar cuenta desde ahora", () => {
        const { id } = rolesTemporales.registrar(base, AHORA);
        const luego = AHORA + 9 * DIA;
        expect(rolesTemporales.renovar(id, 2, luego).vence).toBe(luego + 2 * DIA);
    });

    test("renovar nunca pasa de 365 días desde ahora", () => {
        const { id } = rolesTemporales.registrar({ ...base, dias: 300 }, AHORA);
        expect(rolesTemporales.renovar(id, 300, AHORA).vence).toBe(AHORA + 365 * DIA);
    });

    test("no se renueva lo que ya no está activo ni con días fuera de rango", () => {
        const { id } = rolesTemporales.registrar(base, AHORA);
        expect(rolesTemporales.renovar(id, 0, AHORA).ok).toBe(false);
        rolesTemporales.terminar(id, "quitado", "admin", AHORA);
        expect(rolesTemporales.renovar(id, 3, AHORA)).toEqual({ ok: false, motivo: "Ese rol temporal ya no está activo." });
    });

    test("terminar solo cambia una vez", () => {
        const { id } = rolesTemporales.registrar(base, AHORA);
        expect(rolesTemporales.terminar(id, "vencido", null, AHORA)).not.toBeNull();
        expect(rolesTemporales.terminar(id, "quitado", "admin", AHORA)).toBeNull();
        expect(filaDe(id).estado).toBe("vencido");
        expect(() => rolesTemporales.terminar(id, "inventado")).toThrow();
    });
});

describe("dar el rol en Discord (#543)", () => {
    const datos = { userId: "ana", roleId: "vip", dias: 7, porId: "admin" };

    test("lo da al momento, lo apunta, lo audita y avisa por DM", async () => {
        const guild = servidor({ roles: [{ id: "vip" }] });
        const r = await envios.dar(guild, datos, { client: cliente(guild), ahora: AHORA });
        expect(r.ok).toBe(true);
        expect(guild.members.cache.get("ana").roles.cache.has("vip")).toBe(true);
        expect(filaDe(r.id).estado).toBe("activo");
        expect(acciones()).toContain("roles.temporal_dar");
        expect(avisosDm.sendDm).toHaveBeenCalledWith(
            expect.anything(),
            "ana",
            expect.objectContaining({ content: expect.stringContaining("vip") }),
        );
    });

    test("sin aviso no manda DM", async () => {
        const guild = servidor({ roles: [{ id: "vip" }] });
        await envios.dar(guild, { ...datos, avisar: false }, { client: cliente(guild), ahora: AHORA });
        expect(avisosDm.sendDm).not.toHaveBeenCalled();
    });

    test.each([
        ["un rol de integración", { roles: [{ id: "vip", managed: true }] }, "integración"],
        ["un rol por encima del bot", { roles: [{ id: "vip", position: 12 }] }, "encima del bot"],
        ["un rol que no existe", { roles: [] }, "ya no existe"],
        ["sin permiso de gestionar roles", { roles: [{ id: "vip" }], permisos: false }, "Gestionar roles"],
        ["alguien que no está en el servidor", { roles: [{ id: "vip" }], miembros: [] }, "no está en el servidor"],
    ])("no da %s y no apunta nada", async (_caso, opciones, motivo) => {
        const guild = servidor(opciones);
        const r = await envios.dar(guild, datos, { client: cliente(guild), ahora: AHORA });
        expect(r).toEqual({ ok: false, motivo: expect.stringContaining(motivo) });
        expect(rolesTemporales.activos(G)).toEqual([]);
        expect(acciones()).not.toContain("roles.temporal_dar");
    });

    test("@everyone no se puede dar", async () => {
        const guild = servidor({ roles: [{ id: G }] });
        const r = await envios.dar(guild, { ...datos, roleId: G }, { ahora: AHORA });
        expect(r.ok).toBe(false);
    });

    test("con una duración fuera de rango no toca Discord", async () => {
        const guild = servidor({ roles: [{ id: "vip" }] });
        expect((await envios.dar(guild, { ...datos, dias: 400 }, { ahora: AHORA })).ok).toBe(false);
        expect(guild.members.fetch).not.toHaveBeenCalled();
    });
});

describe("quitar, renovar y vencer (#543)", () => {
    async function conRol(opciones = {}, dias = 7) {
        const guild = servidor({ roles: [{ id: "vip" }], ...opciones });
        const r = await envios.dar(guild, { userId: "ana", roleId: "vip", dias, porId: "admin" }, { client: cliente(guild), ahora: AHORA });
        avisosDm.sendDm.mockClear();
        return { guild, id: r.id };
    }

    test("quitar antes de tiempo lo retira, lo cierra, lo audita y avisa", async () => {
        const { guild, id } = await conRol();
        const r = await envios.quitar(guild, id, "admin", { client: cliente(guild), ahora: AHORA + DIA });
        expect(r.ok).toBe(true);
        expect(guild.members.cache.get("ana").roles.cache.has("vip")).toBe(false);
        expect(filaDe(id)).toMatchObject({ estado: "quitado", terminadoPor: "admin" });
        expect(acciones()).toContain("roles.temporal_quitar");
        expect(avisosDm.sendDm).toHaveBeenCalledTimes(1);
        expect((await envios.quitar(guild, id, "admin")).ok).toBe(false);
    });

    test("renovar se audita con el antes y el después", async () => {
        const { id } = await conRol();
        const r = envios.renovar(G, id, 5, "admin", AHORA);
        expect(r.vence).toBe(AHORA + 12 * DIA);
        const fila = adminAudit.listRecent(G, 10).find((a) => a.action === "roles.temporal_renovar");
        expect(fila.details).toMatchObject({ id, dias: 5, antes: AHORA + 7 * DIA, vence: AHORA + 12 * DIA });
        expect(envios.renovar("otro-servidor", id, 5, "admin").ok).toBe(false);
    });

    test("al vencer se quita solo, una vez, con auditoría y DM; lo que no ha vencido sigue", async () => {
        const { guild, id } = await conRol({ miembros: ["ana", "luis"] }, 1);
        const otro = await envios.dar(guild, { userId: "luis", roleId: "vip", dias: 30, porId: "admin" }, { ahora: AHORA });
        avisosDm.sendDm.mockClear();
        const client = cliente(guild);

        expect(await envios.vencer(client, AHORA + 2 * DIA)).toBe(1);
        expect(await envios.vencer(client, AHORA + 2 * DIA)).toBe(0);
        expect(guild.members.cache.get("ana").roles.cache.has("vip")).toBe(false);
        expect(filaDe(id).estado).toBe("vencido");
        expect(filaDe(otro.id).estado).toBe("activo");
        expect(acciones().filter((a) => a === "roles.temporal_vencer")).toHaveLength(1);
        expect(avisosDm.sendDm).toHaveBeenCalledTimes(1);
    });

    test("tras un reinicio quita lo que venció con el bot apagado", async () => {
        const { guild, id } = await conRol({}, 1);
        // El bot «arranca» diez días después: la primera pasada lo encuentra vencido.
        expect(await envios.vencer(cliente(guild), AHORA + 10 * DIA)).toBe(1);
        expect(filaDe(id).estado).toBe("vencido");
    });

    test("si la persona se fue, se cierra sin tocar Discord", async () => {
        const { guild, id } = await conRol({}, 1);
        guild.members.cache.delete("ana");
        expect(await envios.vencer(cliente(guild), AHORA + 2 * DIA)).toBe(1);
        expect(filaDe(id).estado).toBe("vencido");
    });

    test("si el rol se borró, se cancela", async () => {
        const { guild, id } = await conRol({}, 1);
        guild.roles.cache.delete("vip");
        await envios.vencer(cliente(guild), AHORA + 2 * DIA);
        expect(filaDe(id).estado).toBe("cancelado");
        expect(acciones()).toContain("roles.temporal_cancelar");
    });

    test("si el rol ya está por encima del bot, no lo quita y lo reintenta", async () => {
        const { guild, id } = await conRol({}, 1);
        guild.roles.cache.get("vip").position = 20;
        expect(await envios.vencer(cliente(guild), AHORA + 2 * DIA)).toBe(0);
        expect(filaDe(id).estado).toBe("activo");
        guild.roles.cache.get("vip").position = 5;
        expect(await envios.vencer(cliente(guild), AHORA + 2 * DIA)).toBe(1);
    });

    test("si el servidor no está disponible, se espera", async () => {
        const { id } = await conRol({}, 1);
        expect(await envios.vencer(cliente(null), AHORA + 2 * DIA)).toBe(0);
        expect(filaDe(id).estado).toBe("activo");
    });

    test("borrar el rol cancela sus asignaciones activas", async () => {
        const { id } = await conRol();
        expect(envios.alBorrarRol(G, "vip")).toBe(1);
        expect(filaDe(id).estado).toBe("cancelado");
        expect(envios.alBorrarRol(G, "vip")).toBe(0);
    });
});

describe("el panel admin (#543)", () => {
    function interaccion(customId, extra = {}, { admin = true, guild = servidor({ roles: [{ id: "vip" }] }) } = {}) {
        return {
            customId,
            guildId: G,
            guild,
            user: { id: "admin", tag: "admin" },
            client: cliente(guild),
            memberPermissions: { has: () => admin },
            member: { permissions: { has: () => admin } },
            reply: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
            ...extra,
        };
    }
    const texto = (payload) => `${payload.content ?? ""} ${payload.embeds?.[0]?.data?.description ?? ""}`;
    const ids = (payload) => payload.components.flatMap((f) => f.toJSON().components.map((c) => c.custom_id));

    test("⚙️ Config Global tiene la entrada y no pasa de 5 filas", () => {
        const p = buildConfigHome(G);
        expect(p.components.length).toBeLessThanOrEqual(5);
        expect(ids(p)).toContain("paneladmin_rtemp_home");
    });

    test("sin permisos de admin no se abre", async () => {
        const i = interaccion("paneladmin_rtemp_home", {}, { admin: false });
        await paneladmin.handleButton(i.client, i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "No tienes permisos." }));
    });

    test("dar desde el formulario: persona, rol, días y aviso", async () => {
        const guild = servidor({ roles: [{ id: "vip" }] });
        const abrir = interaccion("paneladmin_rtemp_dar", {}, { guild });
        await paneladmin.handleButton(abrir.client, abrir);
        expect(abrir.showModal.mock.calls[0][0].toJSON().custom_id).toBe("paneladmin_rtemp_dar_modal");

        const i = interaccion(
            "paneladmin_rtemp_dar_modal",
            {
                isFromMessage: () => true,
                fields: {
                    getSelectedUsers: () => new Map([["ana", {}]]),
                    getSelectedRoles: () => new Map([["vip", {}]]),
                    getTextInputValue: () => "3",
                    getRadioGroup: () => "no",
                },
            },
            { guild },
        );
        await paneladmin.handleModal(i.client, i);
        expect(texto(i.update.mock.calls[0][0])).toContain("durante 3 días");
        const [r] = rolesTemporales.activos(G);
        expect(r).toMatchObject({ userId: "ana", roleId: "vip", avisar: false });
        expect(avisosDm.sendDm).not.toHaveBeenCalled();
    });

    test("el formulario con días fuera de rango no da nada", async () => {
        const i = interaccion("paneladmin_rtemp_dar_modal", {
            isFromMessage: () => true,
            fields: {
                getSelectedUsers: () => new Map([["ana", {}]]),
                getSelectedRoles: () => new Map([["vip", {}]]),
                getTextInputValue: () => "500",
                getRadioGroup: () => "si",
            },
        });
        await paneladmin.handleModal(i.client, i);
        expect(texto(i.update.mock.calls[0][0])).toContain("❌ Los días van de 1 a 365");
        expect(rolesTemporales.activos(G)).toEqual([]);
    });

    test("la lista muestra persona, rol, quién y cuándo vence; elegir uno, renovarlo y quitarlo con confirmación", async () => {
        const guild = servidor({ roles: [{ id: "vip" }] });
        const { id } = await envios.dar(guild, { userId: "ana", roleId: "vip", dias: 7, porId: "admin" }, { ahora: Date.now() });

        const home = interaccion("paneladmin_rtemp_home", {}, { guild });
        await paneladmin.handleButton(home.client, home);
        const pantalla = home.update.mock.calls[0][0];
        expect(texto(pantalla)).toContain(`**#${id}** · <@ana> · <@&vip> · lo dio <@admin> · vence <t:`);
        expect(ids(pantalla)).toEqual(expect.arrayContaining(["paneladmin_rtemp_sel", "paneladmin_rtemp_dar"]));

        const sel = interaccion("paneladmin_rtemp_sel", { values: [String(id)] }, { guild });
        await paneladmin.handleStringSelect(sel.client, sel);
        expect(ids(sel.update.mock.calls[0][0])).toEqual(
            expect.arrayContaining([`paneladmin_rtemp_renovar_${id}`, `paneladmin_rtemp_quitar_${id}`]),
        );

        const renovar = interaccion(
            `paneladmin_rtemp_renovar_modal_${id}`,
            {
                isFromMessage: () => true,
                fields: { getTextInputValue: () => "10" },
            },
            { guild },
        );
        const antes = rolesTemporales.get(id).vence;
        await paneladmin.handleModal(renovar.client, renovar);
        expect(rolesTemporales.get(id).vence).toBe(antes + 10 * DIA);

        const quitar = interaccion(`paneladmin_rtemp_quitar_${id}`, {}, { guild });
        await paneladmin.handleButton(quitar.client, quitar);
        expect(ids(quitar.update.mock.calls[0][0])).toContain(`paneladmin_rtemp_quitarsi_${id}`);
        expect(rolesTemporales.get(id).estado).toBe("activo");

        const si = interaccion(`paneladmin_rtemp_quitarsi_${id}`, {}, { guild });
        await paneladmin.handleButton(si.client, si);
        expect(rolesTemporales.get(id).estado).toBe("quitado");
        expect(texto(si.update.mock.calls[0][0])).toContain("➖ Quitado");
    });

    test("un id de otro servidor o ya cerrado no se puede tocar", async () => {
        const { id } = rolesTemporales.registrar({ guildId: "otro", userId: "ana", roleId: "vip", porId: "x", dias: 7 });
        const i = interaccion(`paneladmin_rtemp_quitarsi_${id}`);
        await paneladmin.handleButton(i.client, i);
        expect(texto(i.update.mock.calls[0][0])).toContain("ya no está activo");
        expect(rolesTemporales.get(id).estado).toBe("activo");
    });
});
