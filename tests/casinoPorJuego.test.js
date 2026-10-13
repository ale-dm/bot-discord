// #460 y #461: tope de apuesta y cooldown propios de cada juego del casino. Sin ajuste propio vale el general; el cupo diario
// sigue contando todos los juegos juntos; y el panel admin los lee y los guarda.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const tx = require("../src/systems/casinoTransactions");
const { handleSettingsButton } = require("../src/adminPanel/settings/botones");
const { handleSettingsModal } = require("../src/adminPanel/settings/modales");
const { buildCasinoPanel } = require("../src/adminPanel/settings/vistas");

const G = "g-casino-por-juego";
let n = 0;
function nuevoUsuario(saldo = 100000) {
    const id = `cpj-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, saldo);
    return id;
}

afterEach(() => {
    for (const j of ["blackjack", "tragaperras", "ruleta", "ppt", "adivinar"]) {
        guildSettings.setSetting(G, `casino.max_bet_${j}`, 0);
        guildSettings.setSetting(G, `casino.cooldown_sec_${j}`, 0);
    }
    guildSettings.setSetting(G, "casino.max_bet", 100000);
    guildSettings.setSetting(G, "casino.global_cooldown_sec", 0);
    guildSettings.setSetting(G, "casino.daily_limit", 0);
});

describe("#460 tope de apuesta por juego", () => {
    test("dos juegos con topes distintos: cada uno rechaza por encima del suyo y el mensaje dice cuál es", () => {
        guildSettings.setSetting(G, "casino.max_bet_tragaperras", 500);
        guildSettings.setSetting(G, "casino.max_bet_ruleta", 2000);
        const u = nuevoUsuario();

        const slots = tx.validarApuesta(600, 100000, G, "tragaperras");
        expect(slots.valida).toBe(false);
        expect(slots.mensaje).toContain("500");
        expect(slots.mensaje).toContain("tragaperras");
        expect(tx.validarApuesta(500, 100000, G, "tragaperras").valida).toBe(true);

        expect(tx.validarApuesta(600, 100000, G, "ruleta").valida).toBe(true);
        const ruleta = tx.validarApuesta(2001, 100000, G, "ruleta");
        expect(ruleta.valida).toBe(false);
        expect(ruleta.mensaje).toContain("2000");

        // Y a través de descontarApuesta: la rechazada no cobra nada.
        expect(tx.descontarApuesta(u, 600, G, "tragaperras").exito).toBe(false);
        expect(tx.obtenerSaldo(u)).toBe(100000);
        expect(tx.descontarApuesta(u, 600, G, "ruleta").exito).toBe(true);
    });

    test("un juego sin tope propio usa el general, y sin juego también", () => {
        guildSettings.setSetting(G, "casino.max_bet", 1000);
        guildSettings.setSetting(G, "casino.max_bet_ruleta", 5000);
        const r = tx.validarApuesta(1500, 100000, G, "blackjack");
        expect(r.valida).toBe(false);
        expect(r.mensaje).toContain("1000");
        expect(r.mensaje).not.toContain("blackjack");
        expect(tx.validarApuesta(1500, 100000, G).valida).toBe(false);
        expect(tx.validarApuesta(1500, 100000, G, "ruleta").valida).toBe(true);
    });
});

describe("#461 cooldown por juego", () => {
    test("con cooldown propio en un juego, jugar a otro no espera, y volver al mismo sí", () => {
        guildSettings.setSetting(G, "casino.cooldown_sec_ruleta", 60);
        const u = nuevoUsuario();
        expect(tx.descontarApuesta(u, 100, G, "ruleta").exito).toBe(true);
        expect(tx.descontarApuesta(u, 100, G, "blackjack").exito).toBe(true);
        const otra = tx.descontarApuesta(u, 100, G, "ruleta");
        expect(otra.exito).toBe(false);
        expect(otra.mensaje).toMatch(/Espera \d+s antes de volver a jugar a ruleta/);
    });

    test("un juego sin cooldown propio usa el global, y jugar un juego con cooldown propio no lo activa", () => {
        guildSettings.setSetting(G, "casino.global_cooldown_sec", 60);
        guildSettings.setSetting(G, "casino.cooldown_sec_ruleta", 10);
        const u = nuevoUsuario();
        expect(tx.descontarApuesta(u, 100, G, "blackjack").exito).toBe(true);
        const bj = tx.descontarApuesta(u, 100, G, "blackjack");
        expect(bj.exito).toBe(false);
        expect(bj.mensaje).toMatch(/^⏳ Espera \d+s antes de volver a jugar\.$/);

        const v = nuevoUsuario();
        expect(tx.descontarApuesta(v, 100, G, "ruleta").exito).toBe(true);
        expect(tx.descontarApuesta(v, 100, G, "blackjack").exito).toBe(true); // la ruleta no ha gastado el cooldown global
    });

    test("el cupo diario global cuenta todos los juegos juntos, con o sin cooldown propio", () => {
        guildSettings.setSetting(G, "casino.daily_limit", 3);
        guildSettings.setSetting(G, "casino.cooldown_sec_ruleta", 0);
        guildSettings.setSetting(G, "casino.cooldown_sec_ppt", 1);
        const u = nuevoUsuario();
        expect(tx.descontarApuesta(u, 100, G, "blackjack").exito).toBe(true);
        expect(tx.descontarApuesta(u, 100, G, "ppt").exito).toBe(true);
        expect(tx.descontarApuesta(u, 100, G, "ruleta").exito).toBe(true);
        const cuarta = tx.descontarApuesta(u, 100, G, "tragaperras");
        expect(cuarta.exito).toBe(false);
        expect(cuarta.mensaje).toContain("límite diario");
    });

    test("una jugada rechazada por el cupo diario no gasta el cooldown del juego", () => {
        guildSettings.setSetting(G, "casino.daily_limit", 1);
        guildSettings.setSetting(G, "casino.cooldown_sec_ppt", 600);
        const u = nuevoUsuario();
        expect(tx.descontarApuesta(u, 100, G, "blackjack").exito).toBe(true);
        expect(tx.descontarApuesta(u, 100, G, "ppt").mensaje).toContain("límite diario");
        guildSettings.setSetting(G, "casino.daily_limit", 5);
        expect(tx.descontarApuesta(u, 100, G, "ppt").exito).toBe(true); // su cooldown no se había gastado
    });
});

describe("el panel admin", () => {
    const interaccion = (customId, campos = {}) => ({
        customId,
        guildId: G,
        guild: { id: G },
        user: { id: "admin-cpj", username: "admin", tag: "admin#0004" },
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        fields: { getTextInputValue: (id) => campos[id] ?? "" },
    });

    test("los formularios muestran lo guardado y guardan por juego (vacío = el general)", async () => {
        guildSettings.setSetting(G, "casino.max_bet_ppt", 750);
        const abre = interaccion("paneladmin_cfg_casino_topes");
        expect(await handleSettingsButton(abre)).toBe(true);
        const campos = Object.fromEntries(
            abre.showModal.mock.calls[0][0].toJSON().components.map((f) => [f.components[0].custom_id, f.components[0].value]),
        );
        expect(campos).toEqual({ bj: "0", slots: "0", ruleta: "0", ppt: "750", adivinar: "0" });

        const guarda = interaccion("paneladmin_cfg_casino_topes_modal", {
            bj: "300",
            slots: "",
            ruleta: "1500",
            ppt: "750",
            adivinar: "50",
        });
        expect(await handleSettingsModal(guarda)).toBe(true);
        const c = guildSettings.getSettings(G).casino;
        expect([c.max_bet_blackjack, c.max_bet_tragaperras, c.max_bet_ruleta, c.max_bet_ppt, c.max_bet_adivinar]).toEqual([
            300, 0, 1500, 750, 50,
        ]);

        const espera = interaccion("paneladmin_cfg_casino_esperas_modal", { bj: "5", slots: "10", ruleta: "", ppt: "", adivinar: "" });
        expect(await handleSettingsModal(espera)).toBe(true);
        expect(guildSettings.getSettings(G).casino.cooldown_sec_tragaperras).toBe(10);
        expect(guildSettings.getSettings(G).casino.cooldown_sec_blackjack).toBe(5);
    });

    test("el panel del casino lista el tope y el cooldown de cada juego", () => {
        guildSettings.setSetting(G, "casino.max_bet_ruleta", 2000);
        guildSettings.setSetting(G, "casino.cooldown_sec_ppt", 20);
        const campo = buildCasinoPanel(G)
            .embeds[0].toJSON()
            .fields.find((f) => f.name.startsWith("Por juego"));
        expect(campo.value).toContain("Ruleta: **2000** · **global**");
        expect(campo.value).toContain("PPT: **general** · **20s**");
    });
});
