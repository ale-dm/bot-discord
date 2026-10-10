// Quiniela (#241): crear la jornada (solo admins), apostar paso a paso (editor, pronósticos, navegar, cancelar, confirmar)
// y los avisos de cada paso. La API de cuotas se simula: no hay red.
const db = require("../src/core/db");
const guildSettings = require("../src/systems/guildSettings");
const dinero = require("../src/systems/dinero");
const quiniela = require("../src/juegos/apuestas/quiniela");

jest.mock("../src/services/oddsApi", () => ({
    ...jest.requireActual("../src/services/oddsApi"),
    sincronizarPartidos: jest.fn(async () => []),
}));

const G = "g-quiniela-flujo";
guildSettings.setSetting(G, "casino.global_cooldown_sec", 0);
guildSettings.setSetting(G, "casino.daily_limit", 0);

let n = 0;
const ADMIN = { memberPermissions: { has: (p) => p === "Administrator" } };
const NO_ADMIN = { memberPermissions: { has: () => false } };

function jugador() {
    const id = `qf-${++n}`;
    db.prepare("INSERT INTO banco (userId, saldo, enMano) VALUES (?, 0, ?)").run(id, 100000);
    return id;
}

// Seis partidos abiertos en el futuro: lo mínimo para crear una jornada.
function partidosAbiertos(deporte) {
    for (let i = 0; i < 6; i++) {
        db.prepare(
            `INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, cuota_home, cuota_draw, cuota_away)
             VALUES (?, ?, ?, ?, 'abierto', ?, 2, 3, 4)`,
        ).run(`qf-${deporte}-${i}-${n}`, `Local ${i}`, `Visitante ${i}`, new Date(Date.now() + (i + 2) * 86400000).toISOString(), deporte);
    }
}

function interaccion(userId, extra = {}) {
    return {
        customId: "",
        guildId: G,
        guild: { id: G },
        user: { id: userId, username: userId, tag: userId },
        options: { getString: () => null, getInteger: () => null },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
        isButton: () => true,
        fields: { getTextInputValue: () => "" },
        ...extra,
    };
}
async function pulsar(userId, customId, extra) {
    const i = interaccion(userId, { customId, ...extra });
    await quiniela.handleButton(null, i);
    return i;
}
const ultimo = (mock) => mock.mock.calls.at(-1)[0];

// Crea una jornada de laliga y devuelve su id.
async function crearJornada() {
    partidosAbiertos("laliga");
    const admin = jugador();
    const i = interaccion(admin, { customId: "quiniela_crear_laliga", ...ADMIN });
    await quiniela.handleButton(null, i);
    return db.prepare("SELECT id FROM quinielas WHERE deporte = 'laliga' ORDER BY id DESC LIMIT 1").get().id;
}

describe("crear la jornada", () => {
    test("quien no es admin no puede crear una quiniela", async () => {
        const u = jugador();
        const i = interaccion(u, { customId: "quiniela_crear_laliga", ...NO_ADMIN });
        await quiniela.handleButton(null, i);
        expect(ultimo(i.reply).content).toContain("Solo administradores");
    });

    test("un admin crea la jornada con los partidos abiertos", async () => {
        partidosAbiertos("laliga");
        const admin = jugador();
        const i = interaccion(admin, { customId: "quiniela_crear_laliga", ...ADMIN });
        await quiniela.handleButton(null, i);
        expect(ultimo(i.reply).content).toContain("creada");
        const id = db.prepare("SELECT id FROM quinielas WHERE deporte = 'laliga' ORDER BY id DESC LIMIT 1").get().id;
        expect(db.prepare("SELECT COUNT(*) AS n FROM quiniela_partidos WHERE quiniela_id = ?").get(id).n).toBe(6);
    });

    test("con una jornada abierta ya no se crea otra de la misma competición", async () => {
        await crearJornada();
        const admin = jugador();
        const i = interaccion(admin, { customId: "quiniela_crear_laliga", ...ADMIN });
        await quiniela.handleButton(null, i);
        expect(ultimo(i.reply).content).toContain("Ya existe una quiniela activa");
    });
});

describe("apostar", () => {
    test("abre el editor con los partidos de la jornada", async () => {
        const id = await crearJornada();
        const u = jugador();
        const i = await pulsar(u, `quiniela_apostar_${id}`);
        expect(i.reply).toHaveBeenCalledTimes(1);
        expect(i.reply.mock.calls[0][0].embeds).toHaveLength(1);
    });

    test("elegir pronósticos avanza el editor y se puede volver atrás, quitar y navegar", async () => {
        const id = await crearJornada();
        const u = jugador();
        await pulsar(u, `quiniela_apostar_${id}`);
        const pick = await pulsar(u, `quiniela_pick_${id}_1`);
        const prev = await pulsar(u, `quiniela_prev_${id}`);
        const next = await pulsar(u, `quiniela_next_${id}`);
        const clear = await pulsar(u, `quiniela_clear_${id}`);
        // Cada paso repinta el editor una vez.
        for (const i of [pick, prev, next, clear]) expect(i.update).toHaveBeenCalledTimes(1);
    });

    test("un pronóstico no válido o sin sesión avisa", async () => {
        const id = await crearJornada();
        const u = jugador();
        const sinSesion = await pulsar(u, `quiniela_pick_${id}_1`);
        expect(ultimo(sinSesion.reply).content).toContain("Sesión no válida");
        await pulsar(u, `quiniela_apostar_${id}`);
        const confirmar = await pulsar(u, `quiniela_confirmar_${id}`);
        expect(ultimo(confirmar.reply).content).toContain("Completa todos los partidos");
    });

    test("cancelar cierra la sesión", async () => {
        const id = await crearJornada();
        const u = jugador();
        await pulsar(u, `quiniela_apostar_${id}`);
        const c = await pulsar(u, `quiniela_cancelar_${id}`);
        expect(ultimo(c.update).embeds[0].data.title).toContain("cancelada");
    });

    test("con todos los pronósticos, confirmar pide la cantidad en un formulario", async () => {
        const id = await crearJornada();
        const u = jugador();
        await pulsar(u, `quiniela_apostar_${id}`);
        for (let k = 0; k < 6; k++) await pulsar(u, `quiniela_pick_${id}_1`);
        const c = await pulsar(u, `quiniela_confirmar_${id}`);
        expect(c.showModal).toHaveBeenCalledTimes(1);
    });

    test("el formulario registra la apuesta, descuenta el saldo y no deja apostar dos veces", async () => {
        const id = await crearJornada();
        const u = jugador();
        await pulsar(u, `quiniela_apostar_${id}`);
        for (let k = 0; k < 6; k++) await pulsar(u, `quiniela_pick_${id}_1`);
        const saldoAntes = dinero.efectivo(u);
        const modal = {
            customId: `quiniela_modal_confirmar_${id}`,
            guildId: G,
            guild: { id: G },
            user: { id: u, username: u, tag: u },
            fields: { getTextInputValue: (c) => (c === "cantidad" ? "200" : "") },
            reply: jest.fn(async () => {}),
            isFromMessage: () => false,
        };
        await quiniela.handleModal(null, modal);
        expect(ultimo(modal.reply).content).toContain("Quiniela registrada");
        expect(dinero.efectivo(u)).toBe(saldoAntes - 200);

        const otra = interaccion(u, { customId: `quiniela_apostar_${id}` });
        await quiniela.handleButton(null, otra);
        expect(ultimo(otra.reply).content).toContain("Ya has enviado una apuesta");
    });

    test("una cantidad fuera de rango no se cobra", async () => {
        const id = await crearJornada();
        const u = jugador();
        await pulsar(u, `quiniela_apostar_${id}`);
        for (let k = 0; k < 6; k++) await pulsar(u, `quiniela_pick_${id}_1`);
        const saldoAntes = dinero.efectivo(u);
        const modal = {
            customId: `quiniela_modal_confirmar_${id}`,
            guildId: G,
            guild: { id: G },
            user: { id: u, username: u, tag: u },
            fields: { getTextInputValue: (c) => (c === "cantidad" ? "1" : "") },
            reply: jest.fn(async () => {}),
            isFromMessage: () => false,
        };
        await quiniela.handleModal(null, modal);
        expect(ultimo(modal.reply).content).toContain("Cantidad inválida");
        expect(dinero.efectivo(u)).toBe(saldoAntes);
    });
});

describe("ver la quiniela", () => {
    test("refrescar desde el botón vuelve a mostrar la jornada", async () => {
        await crearJornada();
        const u = jugador();
        const i = await pulsar(u, "quiniela_refrescar_laliga");
        expect(i.reply.mock.calls.length + i.update.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});
