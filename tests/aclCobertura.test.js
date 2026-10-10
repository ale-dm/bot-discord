// Permisos por comando de cada servidor (systems/guildSettings/acl.js): comandos apagados, canales permitidos y roles
// permitidos. Usa la tabla command_acl de la BD en memoria; las interacciones son objetos simulados.
const acl = require("../src/systems/guildSettings/acl");

let n = 0;
const nuevoServidor = () => `g-acl-${++n}`;

function interaccion({ guildId, canal = "c1", roles = null } = {}) {
    const i = { guildId, channelId: canal };
    if (roles !== null) {
        i.member = { roles: { cache: new Map(roles.map((r) => [r, { id: r }])) } };
    }
    return i;
}

describe("listas separadas por comas", () => {
    test("parseCsvIds ignora huecos y espacios, y sin valor da lista vacía", () => {
        expect(acl.parseCsvIds(" 1, 2 ,,3 ")).toEqual(["1", "2", "3"]);
        expect(acl.parseCsvIds(null)).toEqual([]);
        expect(acl.parseCsvIds("")).toEqual([]);
        expect(acl.parseCsvIds(123)).toEqual(["123"]);
    });

    test("toCsv une los IDs sin espacios ni vacíos", () => {
        expect(acl.toCsv([1, " 2 ", ""])).toBe("1,2");
        expect(acl.toCsv(undefined)).toBe("");
    });
});

describe("getCommandAcl y setCommandAcl", () => {
    test("sin servidor o sin comando devuelve lo permitido por defecto", () => {
        expect(acl.getCommandAcl(null, "ayuda")).toEqual({ enabled: true, allowedChannels: [], allowedRoles: [] });
        expect(acl.getCommandAcl(nuevoServidor(), "")).toEqual({ enabled: true, allowedChannels: [], allowedRoles: [] });
    });

    test("un comando sin configurar está permitido en todas partes", () => {
        expect(acl.getCommandAcl(nuevoServidor(), "ayuda")).toEqual({ enabled: true, allowedChannels: [], allowedRoles: [] });
    });

    test("sin servidor o sin comando no guarda nada", () => {
        expect(acl.setCommandAcl(null, "ayuda", { enabled: false })).toBe(false);
        expect(acl.setCommandAcl(nuevoServidor(), "", { enabled: false })).toBe(false);
    });

    test("guarda y lee los canales y roles permitidos", () => {
        const g = nuevoServidor();
        expect(acl.setCommandAcl(g, "plex", { allowedChannels: ["c1", " c2 "], allowedRoles: ["r1"] })).toBe(true);

        expect(acl.getCommandAcl(g, "plex")).toEqual({ enabled: true, allowedChannels: ["c1", "c2"], allowedRoles: ["r1"] });
    });

    test("un cambio parcial conserva lo que no se toca", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "plex", { enabled: false, allowedChannels: ["c1"], allowedRoles: ["r1"] });

        acl.setCommandAcl(g, "plex", { allowedRoles: ["r2"] });

        expect(acl.getCommandAcl(g, "plex")).toEqual({ enabled: false, allowedChannels: ["c1"], allowedRoles: ["r2"] });
    });

    test("un valor de enabled que no es booleano no cambia el estado", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "plex", { enabled: false });

        acl.setCommandAcl(g, "plex", { enabled: "no" });
        acl.setCommandAcl(g, "plex");

        expect(acl.getCommandAcl(g, "plex").enabled).toBe(false);
    });

    test("una lista vacía quita las restricciones", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "plex", { allowedChannels: ["c1"], allowedRoles: ["r1"] });

        acl.setCommandAcl(g, "plex", { allowedChannels: [], allowedRoles: [] });

        expect(acl.getCommandAcl(g, "plex")).toEqual({ enabled: true, allowedChannels: [], allowedRoles: [] });
    });
});

describe("listCommandAcl", () => {
    test("sin servidor da lista vacía", () => {
        expect(acl.listCommandAcl(null)).toEqual([]);
    });

    test("lista solo los de ese servidor, por nombre de comando", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "tienda", { enabled: false });
        acl.setCommandAcl(g, "ayuda", { allowedRoles: ["r9"] });
        acl.setCommandAcl(nuevoServidor(), "otro", { enabled: false });

        expect(acl.listCommandAcl(g)).toEqual([
            { command: "ayuda", enabled: true, allowedChannels: [], allowedRoles: ["r9"] },
            { command: "tienda", enabled: false, allowedChannels: [], allowedRoles: [] },
        ]);
    });
});

describe("isCommandAllowed: quién puede usar un comando", () => {
    test("sin servidor, sin comando o sin interacción, no se bloquea", () => {
        expect(acl.isCommandAllowed(null, "ayuda")).toEqual({ ok: true });
        expect(acl.isCommandAllowed({ channelId: "c1" }, "ayuda")).toEqual({ ok: true });
        expect(acl.isCommandAllowed(interaccion({ guildId: nuevoServidor() }), "")).toEqual({ ok: true });
    });

    test("un comando apagado se bloquea en cualquier canal", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "casino", { enabled: false });

        const r = acl.isCommandAllowed(interaccion({ guildId: g, roles: [] }), "casino");

        expect(r.ok).toBe(false);
        expect(r.message).toContain("/casino");
        expect(r.message).toContain("deshabilitado");
    });

    test("con canales permitidos, fuera de ellos se bloquea y dentro pasa", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "plex", { allowedChannels: ["c-ok"] });

        const fuera = acl.isCommandAllowed(interaccion({ guildId: g, canal: "c-otro", roles: [] }), "plex");
        expect(fuera.ok).toBe(false);
        expect(fuera.message).toContain("no está permitido en este canal");

        expect(acl.isCommandAllowed(interaccion({ guildId: g, canal: "c-ok", roles: [] }), "plex")).toEqual({ ok: true });
    });

    test("con roles permitidos, sin ninguno se bloquea y con uno de ellos pasa", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "seerr", { allowedRoles: ["r-mod", "r-vip"] });

        const sinRol = acl.isCommandAllowed(interaccion({ guildId: g, roles: ["r-otro"] }), "seerr");
        expect(sinRol.ok).toBe(false);
        expect(sinRol.message).toContain("requiere uno de los roles permitidos");

        expect(acl.isCommandAllowed(interaccion({ guildId: g, roles: ["r-otro", "r-vip"] }), "seerr")).toEqual({ ok: true });
    });

    test("quien no tiene roles en la interacción no cumple una restricción de roles", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "seerr", { allowedRoles: ["r-mod"] });

        const r = acl.isCommandAllowed(interaccion({ guildId: g }), "seerr");

        expect(r.ok).toBe(false);
    });

    test("si hay canal y rol restringidos, tienen que cumplirse los dos", () => {
        const g = nuevoServidor();
        acl.setCommandAcl(g, "plex", { allowedChannels: ["c1"], allowedRoles: ["r-mod"] });

        expect(acl.isCommandAllowed(interaccion({ guildId: g, canal: "c1", roles: [] }), "plex").ok).toBe(false);
        expect(acl.isCommandAllowed(interaccion({ guildId: g, canal: "c2", roles: ["r-mod"] }), "plex").ok).toBe(false);
        expect(acl.isCommandAllowed(interaccion({ guildId: g, canal: "c1", roles: ["r-mod"] }), "plex")).toEqual({ ok: true });
    });
});
