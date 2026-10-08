// 🎬 Sesión de cine (#24): la hora en Madrid, apuntarse y salirse, quién puede cancelar, el recordatorio (una sola vez) y el
// mensaje con sus botones.
const db = require("../src/core/db");
const cine = require("../src/systems/cine");
const { pantallaSesion } = require("../src/paneles/cine");

const G = "g-cine";
const CANAL = "c-cine";
// 8 de octubre de 2026, 20:00 en Madrid (CEST, +2): 18:00 UTC.
const AHORA = Date.UTC(2026, 9, 8, 18, 0);

function sesion(inicio = Date.UTC(2026, 9, 8, 18, 5)) {
    return cine.crear({ guildId: G, canalId: CANAL, organizador: "ana", peli: "Dune", inicio });
}

beforeEach(() => {
    db.prepare("DELETE FROM cine_asistentes").run();
    db.prepare("DELETE FROM cine_sesiones").run();
});

describe("la hora", () => {
    test("es la de hoy en Madrid si aún no ha pasado", () => {
        // 21:30 en Madrid son 19:30 UTC.
        expect(cine.proximaHora("21:30", AHORA)).toBe(Date.UTC(2026, 9, 8, 19, 30));
    });

    test("si ya ha pasado, es la de mañana", () => {
        // 19:00 en Madrid ya ha pasado (son las 20:00): mañana a las 19:00 son 17:00 UTC.
        expect(cine.proximaHora("19:00", AHORA)).toBe(Date.UTC(2026, 9, 9, 17, 0));
    });

    test("solo acepta HH:MM válidos", () => {
        expect(cine.proximaHora("25:00", AHORA)).toBeNull();
        expect(cine.proximaHora("21:70", AHORA)).toBeNull();
        expect(cine.proximaHora("ayer", AHORA)).toBeNull();
    });
});

test("quien convoca se apunta solo, y luego se apuntan y se salen los demás", () => {
    const id = sesion();
    expect(cine.asistentes(id)).toEqual(["ana"]);
    cine.apuntar(id, "luis");
    cine.apuntar(id, "luis"); // dos veces no cuenta doble
    expect(cine.asistentes(id)).toEqual(["ana", "luis"]);
    expect(cine.salir(id, "luis")).toBe(true);
    expect(cine.asistentes(id)).toEqual(["ana"]);
});

test("solo quien la convocó o un admin puede cancelarla", () => {
    const id = sesion();
    expect(cine.cancelar(id, "luis").ok).toBe(false);
    expect(cine.cancelar(id, "luis", true).ok).toBe(true); // admin
    expect(cine.sesion(id).cancelada).toBe(1);
    expect(cine.cancelar(id, "ana").ok).toBe(false); // ya no está activa
});

test("el recordatorio sale 10 minutos antes, una sola vez, y solo a quien se apuntó", async () => {
    const id = sesion(AHORA + 6 * 60000); // empieza en 6 minutos
    cine.apuntar(id, "luis");
    expect(cine.recordatoriosPendientes(AHORA).map((s) => s.id)).toEqual([id]);

    const canal = { send: jest.fn(async () => {}) };
    const client = { channels: { fetch: jest.fn(async () => canal) } };
    expect(await cine.enviarRecordatorios(client, AHORA)).toBe(1);
    const aviso = canal.send.mock.calls[0][0];
    expect(aviso.content).toMatch(/Dentro de 10 minutos: \*\*Dune\*\*/);
    expect(aviso.allowedMentions.users).toEqual(["ana", "luis"]);

    expect(await cine.enviarRecordatorios(client, AHORA)).toBe(0);
    expect(canal.send).toHaveBeenCalledTimes(1);
});

test("una sesión cancelada o que empieza más tarde no tiene recordatorio todavía", () => {
    sesion(AHORA + 30 * 60000); // dentro de media hora: aún no
    const cancelada = sesion(AHORA + 5 * 60000);
    cine.cancelar(cancelada, "ana");
    expect(cine.recordatoriosPendientes(AHORA)).toEqual([]);
});

test("el mensaje lista a quien se ha apuntado y tiene los tres botones", () => {
    const id = sesion();
    cine.apuntar(id, "luis");
    const p = pantallaSesion(id);
    expect(p.embeds[0].data.description).toMatch(/Apuntados \(2\)/);
    const ids = p.components[0].components.map((b) => b.data.custom_id);
    expect(ids).toEqual([`cine_apuntarse_${id}`, `cine_salirse_${id}`, `cine_cancelar_${id}`]);
});

test("una sesión cancelada no tiene botones", () => {
    const id = sesion();
    cine.cancelar(id, "ana");
    expect(pantallaSesion(id).components).toEqual([]);
});
