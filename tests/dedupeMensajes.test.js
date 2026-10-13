// #482: el dedupe de mensajes borra solo lo caducado desde el principio del mapa, sin recorrerlo entero en cada mensaje.
const { performance } = require("node:perf_hooks");
const mensajes = require("../src/core/mensajes");

const { isDuplicateMessage, tamanoDedupe, MESSAGE_DEDUPE_WINDOW_MS: VENTANA } = mensajes;
const T0 = 10_000_000;

describe("ventana de 5 minutos", () => {
    test("un mismo id dentro de la ventana se ignora, y fuera de ella se acepta", () => {
        expect(isDuplicateMessage("dd-a", T0)).toBe(false);
        expect(isDuplicateMessage("dd-a", T0 + 1000)).toBe(true);
        expect(isDuplicateMessage("dd-a", T0 + VENTANA - 1)).toBe(true);
        // Pasada la ventana desde su primer registro, vuelve a valer como nuevo.
        expect(isDuplicateMessage("dd-a", T0 + VENTANA + 1)).toBe(false);
        expect(isDuplicateMessage("dd-a", T0 + VENTANA + 2)).toBe(true);
    });

    test("ver otra vez un id duplicado no le renueva el plazo", () => {
        const t = T0 + 3 * VENTANA; // el reloj solo avanza: cada prueba usa un tramo de tiempo posterior
        expect(isDuplicateMessage("dd-b", t)).toBe(false);
        expect(isDuplicateMessage("dd-b", t + VENTANA - 10)).toBe(true); // duplicado: sigue contando desde t
        expect(isDuplicateMessage("dd-b", t + VENTANA + 1)).toBe(false);
    });

    test("el mapa no supera los mensajes de la ventana, aunque llegue una ráfaga larga", () => {
        // 1 mensaje por segundo durante 20 minutos: solo los 300 últimos segundos caben en la ventana.
        for (let s = 0; s < 1200; s++) isDuplicateMessage(`ráfaga-${s}`, T0 + 10 * VENTANA + s * 1000);
        expect(tamanoDedupe()).toBeLessThanOrEqual(VENTANA / 1000 + 1);
        expect(tamanoDedupe()).toBeGreaterThan(VENTANA / 1000 - 2);
        // Los del principio ya no están (se aceptarían de nuevo); los últimos, sí.
        expect(isDuplicateMessage("ráfaga-1199", T0 + 10 * VENTANA + 1200 * 1000)).toBe(true);
        expect(isDuplicateMessage("ráfaga-0", T0 + 10 * VENTANA + 1200 * 1000)).toBe(false);
    });
});

describe("coste con la ventana llena", () => {
    test("con 20.000 mensajes en la ventana, cada mensaje nuevo cuesta microsegundos y no crece con el tamaño", () => {
        const base = T0 + 100 * VENTANA;
        // 20.000 mensajes repartidos en los 5 minutos de la ventana (67 por segundo).
        for (let i = 0; i < 20_000; i++) isDuplicateMessage(`bench-${i}`, base + Math.floor((i * (VENTANA - 1)) / 20_000));
        expect(tamanoDedupe()).toBeGreaterThanOrEqual(20_000);

        const nuevos = 2000;
        const t0 = performance.now();
        for (let i = 0; i < nuevos; i++) isDuplicateMessage(`bench-nuevo-${i}`, base + VENTANA - 1);
        const microsPorMensaje = ((performance.now() - t0) * 1000) / nuevos;
        // Recorriendo el mapa entero eran ~250 µs por mensaje con esta carga; borrando solo desde el principio, menos de 5 µs.
        expect(microsPorMensaje).toBeLessThan(25);
    });
});
