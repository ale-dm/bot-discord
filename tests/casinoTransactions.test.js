// BD en memoria (ver tests/setupEnv.js) con el esquema de las migraciones: cada fichero de test empieza vacío.
const db = require("../src/core/db");

const guildSettings = require("../src/systems/guildSettings");
const tx = require("../src/systems/casinoTransactions");
const activeGames = require("../src/systems/activeGames");

const GUILD = "guild-test";
let n = 0;
// Un usuario nuevo por test para que los saldos y los cupos no se pisen entre tests.
function nuevoUsuario(saldo = 1000) {
    const id = `user-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo) VALUES (?, ?)").run(id, saldo);
    return id;
}
const saldo = (id) => db.prepare("SELECT saldo FROM banco WHERE userId = ?").get(id).saldo;

afterEach(() => {
    guildSettings.setSetting(GUILD, "casino.daily_limit", 0);
    guildSettings.setSetting(GUILD, "casino.global_cooldown_sec", 0);
    guildSettings.setSetting(GUILD, "casino.rtp_blackjack", 100);
});

describe("obtenerSaldo", () => {
    test("crea al usuario con 1000 si no existe", () => {
        expect(tx.obtenerSaldo("desconocido")).toBe(1000);
        expect(saldo("desconocido")).toBe(1000);
    });
});

describe("validarApuesta", () => {
    test("respeta mínimo, máximo y saldo", () => {
        expect(tx.validarApuesta(0, 1000, GUILD).valida).toBe(false);
        expect(tx.validarApuesta(9, 1000, GUILD).valida).toBe(false); // mínimo por defecto: 10
        expect(tx.validarApuesta(10, 1000, GUILD).valida).toBe(true);
        expect(tx.validarApuesta(1001, 1000, GUILD).valida).toBe(false);
        expect(tx.validarApuesta(100001, 10 ** 9, GUILD).valida).toBe(false); // máximo por defecto: 100000
    });
});

describe("descontarApuesta", () => {
    test("descuenta la apuesta y devuelve el saldo restante", () => {
        const u = nuevoUsuario(1000);
        const r = tx.descontarApuesta(u, 300, GUILD);
        expect(r.exito).toBe(true);
        expect(r.saldoRestante).toBe(700);
        expect(saldo(u)).toBe(700);
    });

    test("rechaza sin saldo suficiente y no toca el saldo", () => {
        const u = nuevoUsuario(100);
        const r = tx.descontarApuesta(u, 500, GUILD);
        expect(r.exito).toBe(false);
        expect(saldo(u)).toBe(100);
    });

    test("una apuesta rechazada no gasta el cupo diario", () => {
        guildSettings.setSetting(GUILD, "casino.daily_limit", 1);
        const u = nuevoUsuario(100);
        expect(tx.descontarApuesta(u, 500, GUILD).exito).toBe(false); // sin saldo
        expect(tx.descontarApuesta(u, 5, GUILD).exito).toBe(false); // bajo el mínimo
        expect(tx.descontarApuesta(u, 50, GUILD).exito).toBe(true); // el cupo sigue intacto
        const cuarta = tx.descontarApuesta(u, 20, GUILD);
        expect(cuarta.exito).toBe(false);
        expect(cuarta.mensaje).toMatch(/límite diario/);
    });

    test("una apuesta rechazada no activa el cooldown", () => {
        guildSettings.setSetting(GUILD, "casino.global_cooldown_sec", 60);
        const u = nuevoUsuario(100);
        expect(tx.descontarApuesta(u, 500, GUILD).exito).toBe(false);
        expect(tx.descontarApuesta(u, 50, GUILD).exito).toBe(true);
        expect(tx.descontarApuesta(u, 20, GUILD).mensaje).toMatch(/Espera/);
    });
});

describe("descontarExtra (doblar/separar)", () => {
    test("no aplica mínimo, cooldown ni cupo diario", () => {
        guildSettings.setSetting(GUILD, "casino.daily_limit", 1);
        guildSettings.setSetting(GUILD, "casino.global_cooldown_sec", 60);
        const u = nuevoUsuario(1000);
        expect(tx.descontarApuesta(u, 15, GUILD).exito).toBe(true); // gasta el único cupo del día
        const extra = tx.descontarExtra(u, 5, GUILD); // 5 < mínimo, y ya sin cupo
        expect(extra.exito).toBe(true);
        expect(saldo(u)).toBe(980);
    });

    test("falla sin saldo y no toca el saldo", () => {
        const u = nuevoUsuario(50);
        expect(tx.descontarExtra(u, 100, GUILD).exito).toBe(false);
        expect(saldo(u)).toBe(50);
    });
});

describe("procesarGanancia / procesarPerdida", () => {
    test("la ganancia suma el total y registra el neto", () => {
        const u = nuevoUsuario(900); // como si ya se hubieran descontado 100
        expect(tx.procesarGanancia(u, "blackjack", 100, 200, "test", {})).toBe(true);
        expect(saldo(u)).toBe(1100);
        const partida = db.prepare("SELECT * FROM casino WHERE userId = ?").get(u);
        expect(partida.resultado).toBe(100);
        const hist = db.prepare("SELECT cantidad FROM historial WHERE userId = ?").get(u);
        expect(hist.cantidad).toBe(100);
    });

    test("la pérdida no toca el saldo (ya se descontó) y registra -apuesta", () => {
        const u = nuevoUsuario(900);
        expect(tx.procesarPerdida(u, "blackjack", 100, "test", {})).toBe(true);
        expect(saldo(u)).toBe(900);
        expect(db.prepare("SELECT resultado FROM casino WHERE userId = ?").get(u).resultado).toBe(-100);
    });
});

describe("applyRtp", () => {
    test("100% no cambia nada", () => {
        expect(tx.applyRtp(GUILD, "blackjack", 100, 250)).toBe(250);
    });

    test("escala solo el premio neto, nunca la apuesta devuelta", () => {
        guildSettings.setSetting(GUILD, "casino.rtp_blackjack", 50);
        expect(tx.applyRtp(GUILD, "blackjack", 100, 300)).toBe(200); // neto 200 -> 100
        expect(tx.applyRtp(GUILD, "blackjack", 100, 100)).toBe(100); // empate: se devuelve entera
    });

    test("juegos sin RTP configurable quedan igual", () => {
        guildSettings.setSetting(GUILD, "casino.rtp_blackjack", 50);
        expect(tx.applyRtp(GUILD, "quiniela", 100, 300)).toBe(300);
    });
});

describe("activeGames (partidas interrumpidas por reinicio)", () => {
    test("reembolsa lo apostado, incluido lo añadido al doblar, y limpia el registro", () => {
        const u = nuevoUsuario(800);
        activeGames.registrar(u, "blackjack", GUILD, 100);
        activeGames.sumarApuesta(u, "blackjack", 100);
        expect(activeGames.reembolsarPendientes()).toBe(1);
        expect(saldo(u)).toBe(1000);
        expect(activeGames.reembolsarPendientes()).toBe(0);
    });

    test("una partida cerrada no se reembolsa", () => {
        const u = nuevoUsuario(900);
        activeGames.registrar(u, "adivinar", GUILD, 100);
        activeGames.cerrar(u, "adivinar");
        expect(activeGames.reembolsarPendientes()).toBe(0);
        expect(saldo(u)).toBe(900);
    });

    test("estaAbandonada tras 15 minutos", () => {
        expect(activeGames.estaAbandonada(Date.now())).toBe(false);
        expect(activeGames.estaAbandonada(Date.now() - activeGames.ABANDON_MS - 1)).toBe(true);
    });
});
