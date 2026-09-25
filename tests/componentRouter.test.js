const { createComponentRouter } = require("../src/core/componentRouter");

// Interacción falsa con lo mínimo que usa el router.
function fake(type, customId) {
    const is = (t) => () => t === type;
    return {
        customId,
        isButton: is("button"),
        isStringSelectMenu: is("stringSelect"),
        isUserSelectMenu: is("userSelect"),
        isRoleSelectMenu: is("roleSelect"),
        isChannelSelectMenu: is("channelSelect"),
        isModalSubmit: is("modal"),
    };
}

const noop = async () => {};
const apuestas = {
    handleButton: noop,
    handleModal: noop,
    componentHandlers: [
        { types: ["button"], ids: ["ver_mis_apuestas"], prefixes: ["apuestas_"], method: "handleButton" },
        { types: ["modal"], prefixes: ["apuestas_modal_"], method: "handleModal" },
    ],
};
const quiniela = {
    handleButton: noop,
    handleModal: noop,
    componentHandlers: [
        { types: ["button"], prefixes: ["apuestas_quiniela_"], method: "handleButton" },
        { types: ["modal"], prefixes: ["apuestas_modal_quiniela_"], method: "handleModal" },
    ],
};

function router() {
    const r = createComponentRouter();
    r.register(apuestas, "apuestas");
    r.register(quiniela, "quiniela");
    return r;
}

test("gana el prefijo más largo", () => {
    const r = router();
    expect(r.match(fake("button", "apuestas_ver")).mod).toBe(apuestas);
    expect(r.match(fake("button", "apuestas_quiniela_5")).mod).toBe(quiniela);
    expect(r.match(fake("modal", "apuestas_modal_quiniela_3")).mod).toBe(quiniela);
    expect(r.match(fake("modal", "apuestas_modal_7")).mod).toBe(apuestas);
});

test("id exacto", () => {
    expect(router().match(fake("button", "ver_mis_apuestas")).mod).toBe(apuestas);
});

test("el tipo de componente tiene que coincidir", () => {
    expect(router().match(fake("stringSelect", "apuestas_ver"))).toBeNull();
    expect(router().match(fake("button", "otra_cosa"))).toBeNull();
});

test("falla al registrar un método que no existe", () => {
    const r = createComponentRouter();
    expect(() => r.register({ componentHandlers: [{ types: ["button"], prefixes: ["x_"], method: "nope" }] }, "roto")).toThrow(/nope/);
});

test("todos los módulos reales declaran rutas válidas", () => {
    // Cargar los módulos de verdad valida que cada method existe y cada type es conocido.
    const fs = require("fs");
    const path = require("path");
    const r = createComponentRouter();
    const files = [];
    const walk = (d) =>
        fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js")) files.push(p);
        });
    // Como index.js: los comandos y los juegos (que no son comandos pero tienen botones).
    walk(path.join(__dirname, "../src/commands"));
    walk(path.join(__dirname, "../src/juegos"));
    for (const f of files) r.register(require(f), f);
    expect(r.size).toBeGreaterThan(20);
    expect(r.match(fake("button", "bj_hit")).source).toMatch(/blackjack/);
    expect(r.match(fake("button", "quiniela_refrescar_laliga")).source).toMatch(/quiniela/);
    expect(r.match(fake("channelSelect", "paneladmin_plex_channel_add_select")).method).toBe("handleChannelSelect");
    expect(r.match(fake("modal", "casino_ruleta_numero_modal")).acl).toBe("juegos");
    expect(r.match(fake("button", "casino_play_blackjack_100")).source).toMatch(/juegos/);
    expect(r.match(fake("button", "perfil_casino_1")).source).toMatch(/perfil/);
});
