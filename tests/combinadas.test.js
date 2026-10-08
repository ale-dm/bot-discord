// 🧩 Combinadas (#1): un boleto con 2 a 5 partidos. La cuota es el producto de las patas; se gana si aciertan todas, se
// pierde en cuanto falla una, y se devuelve entera si un partido se caduca. Las patas usan la misma regla que la apuesta
// simple (1X2, goles y hándicap), con la línea guardada en la pata.
const db = require("../src/core/db");
const dinero = require("../src/systems/dinero");
const combinadas = require("../src/systems/apuestas/combinadas");

const G = "g-combinadas";
let n = 0;
const FUTURO = "2099-01-01T20:00:00.000Z";
const PASADO = "2000-01-01T20:00:00.000Z";

/** Un partido abierto con 1X2, goles (2,5) y hándicap (−1,5). */
function partido(id, { start = FUTURO, estado = "abierto" } = {}) {
    db.prepare(
        `INSERT INTO apuestas_partidos (match_id, deporte, home_team, away_team, start_time, estado, cuota_home, cuota_draw, cuota_away,
            cuota_mas, cuota_menos, total_linea, cuota_casa, cuota_fuera, hcap_linea)
         VALUES (?, 'laliga', ?, ?, ?, ?, 2.0, 3.0, 4.0, 1.9, 1.95, 2.5, 2.3, 1.6, -1.5)`,
    ).run(id, `Local ${id}`, `Visitante ${id}`, start, estado);
    return id;
}
const usuario = (efectivo) => {
    const id = `comb-${++n}`;
    dinero.pagar(id, efectivo);
    return id;
};
const efectivo = (u) => dinero.efectivo(u);

describe("cuota y premio", () => {
    test("la cuota total es el producto de las patas, con dos decimales", () => {
        expect(combinadas.cuotaTotal([2, 3])).toBe(6);
        expect(combinadas.cuotaTotal([1.9, 2.3, 1.6])).toBe(6.99); // 1.9 × 2.3 × 1.6 = 6.992
        expect(combinadas.cuotaTotal([1.85, 2.1])).toBe(3.89);
    });

    test("el premio es lo apostado por la cuota total", () => {
        expect(combinadas.premioDe(100, 6)).toBe(600);
        expect(combinadas.premioDe(50, 3.5)).toBe(175);
    });
});

describe("el boleto en armado", () => {
    test("se puede sumar un partido con 1X2 o con un mercado, y sumar otra vez el mismo partido cambia la pata", () => {
        const u = usuario(1000);
        const a = partido(`ca-${++n}`);
        expect(combinadas.sumar(u, a, "home").ok).toBe(true);
        expect(combinadas.sumar(u, a, "mas").ok).toBe(true);
        const patas = combinadas.borrador(u);
        expect(patas).toHaveLength(1);
        expect(patas[0]).toMatchObject({ eleccion: "mas", cuota: 1.9, linea: 2.5 });
    });

    test("no se puede sumar un partido empezado, ni una elección sin cuota, ni el marcador exacto", () => {
        const u = usuario(1000);
        const empezado = partido(`ca-${++n}`, { start: PASADO });
        expect(combinadas.sumar(u, empezado, "home").ok).toBe(false);
        const a = partido(`ca-${++n}`);
        expect(combinadas.sumar(u, a, "exacto_2-1").ok).toBe(false);
    });

    test("como mucho 5 partidos", () => {
        const u = usuario(1000);
        for (let i = 0; i < 5; i++) expect(combinadas.sumar(u, partido(`ca-${++n}`), "home").ok).toBe(true);
        const sexto = combinadas.sumar(u, partido(`ca-${++n}`), "home");
        expect(sexto.ok).toBe(false);
        expect(sexto.mensaje).toMatch(/5/);
    });
});

describe("apostar", () => {
    test("hacen falta al menos 2 partidos, y el importe dentro de los límites", () => {
        const u = usuario(1000);
        combinadas.sumar(u, partido(`ca-${++n}`), "home");
        expect(combinadas.apostar(G, u, 100).mensaje).toMatch(/al menos/);
        combinadas.sumar(u, partido(`ca-${++n}`), "away");
        expect(combinadas.apostar(G, u, 1).ok).toBe(false);
        expect(combinadas.apostar(G, u, 5000).ok).toBe(false);
    });

    test("cobra el importe, guarda el boleto con sus patas y vacía el borrador", () => {
        const u = usuario(1000);
        const a = partido(`ca-${++n}`);
        const b = partido(`ca-${++n}`);
        combinadas.sumar(u, a, "home"); // cuota 2
        combinadas.sumar(u, b, "mas"); // cuota 1.9, línea 2,5
        const antes = efectivo(u);
        const r = combinadas.apostar(G, u, 100);
        expect(r).toMatchObject({ ok: true, cuota: 3.8, premio: 380 });
        expect(efectivo(u)).toBe(antes - 100);
        expect(combinadas.borrador(u)).toEqual([]);
        const boleto = db.prepare("SELECT * FROM combinadas WHERE id = ?").get(r.id);
        expect(boleto).toMatchObject({ user_id: u, cantidad: 100, cuota: 3.8, estado: "abierta" });
        const patas = db
            .prepare("SELECT match_id, eleccion, cuota, linea, resultado FROM combinada_patas WHERE combinada_id = ? ORDER BY id")
            .all(r.id);
        expect(patas).toEqual([
            { match_id: a, eleccion: "home", cuota: 2, linea: null, resultado: "pendiente" },
            { match_id: b, eleccion: "mas", cuota: 1.9, linea: 2.5, resultado: "pendiente" },
        ]);
    });

    test("si la cuota cambia desde que se sumó, no se apuesta", () => {
        const u = usuario(1000);
        const a = partido(`ca-${++n}`);
        const b = partido(`ca-${++n}`);
        combinadas.sumar(u, a, "home");
        combinadas.sumar(u, b, "away");
        db.prepare("UPDATE apuestas_partidos SET cuota_home = 2.5 WHERE match_id = ?").run(a);
        const r = combinadas.apostar(G, u, 100);
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/cambiado la cuota/);
    });

    test("sin efectivo no se apuesta", () => {
        const u = usuario(0);
        dinero.cobrar(u, dinero.efectivo(u) - 50); // se queda con 50 de efectivo (las cuentas nuevas empiezan con saldo)
        combinadas.sumar(u, partido(`ca-${++n}`), "home");
        combinadas.sumar(u, partido(`ca-${++n}`), "away");
        expect(combinadas.apostar(G, u, 100).ok).toBe(false);
    });
});

describe("cómo se liquida", () => {
    /** Un boleto de dos partidos (1X2 local y más de 2,5), ya apostado. */
    function boleto(cantidad = 100) {
        const u = usuario(1000);
        const a = partido(`ca-${++n}`);
        const b = partido(`ca-${++n}`);
        combinadas.sumar(u, a, "home"); // gana el local
        combinadas.sumar(u, b, "mas"); // más de 2,5 goles
        const r = combinadas.apostar(G, u, cantidad);
        return { u, a, b, id: r.id, cuota: r.cuota };
    }
    const estado = (id) => db.prepare("SELECT estado, premio FROM combinadas WHERE id = ?").get(id);

    test("si acierta todas, se paga la cuota total al resolver la última pata", () => {
        const { u, a, b, id } = boleto(100);
        const antes = efectivo(u);
        expect(combinadas.resolverPartido(a, "home", "2-0")).toEqual([]);
        expect(estado(id)).toEqual({ estado: "abierta", premio: null });
        const pagos = combinadas.resolverPartido(b, "draw", "2-1"); // 3 goles: más de 2,5
        expect(pagos).toEqual([{ userId: u, premio: 380, descripcion: "Combinada ganada (cuota 3.8)" }]);
        expect(estado(id)).toEqual({ estado: "ganada", premio: 380 });
        expect(efectivo(u)).toBe(antes + 380);
    });

    test("una pata que falla pierde el boleto, y la otra no paga nada", () => {
        const { u, a, b, id } = boleto(100);
        const antes = efectivo(u);
        expect(combinadas.resolverPartido(a, "away", "0-1")).toEqual([]); // falla el local
        expect(estado(id)).toEqual({ estado: "perdida", premio: 0 });
        expect(combinadas.resolverPartido(b, "home", "3-0")).toEqual([]); // acierta, pero ya está perdida
        expect(estado(id)).toEqual({ estado: "perdida", premio: 0 });
        expect(efectivo(u)).toBe(antes);
    });

    test("un partido caducado devuelve el boleto entero", () => {
        const { u, a, b, id } = boleto(100);
        const reembolsos = [];
        const antes = efectivo(u);
        expect(combinadas.caducarPartido(a, (userId, cantidad, descripcion) => reembolsos.push({ userId, cantidad, descripcion }))).toBe(1);
        expect(reembolsos).toEqual([{ userId: u, cantidad: 100, descripcion: "Reembolso: combinada con un partido sin resultado" }]);
        expect(estado(id)).toEqual({ estado: "reembolsada", premio: 100 });
        // El reembolso lo hace la liquidación (con dinero.pagar): aquí solo se comprueba que el boleto queda cerrado.
        expect(combinadas.resolverPartido(b, "draw", "1-1")).toEqual([]);
        expect(efectivo(u)).toBe(antes);
    });

    test("la línea de una pata es la que tenía al apostar, aunque la API la cambie después", () => {
        const { u, a, b, id } = boleto(100);
        // La API mueve la línea a 3,5 después de apostar: con 3 goles, la línea de 3,5 no acertaría.
        db.prepare("UPDATE apuestas_partidos SET total_linea = 3.5 WHERE match_id = ?").run(b);
        expect(db.prepare("SELECT linea FROM combinada_patas WHERE combinada_id = ? AND match_id = ?").get(id, b).linea).toBe(2.5);
        combinadas.resolverPartido(a, "home", "1-0"); // acierta el local
        const pagos = combinadas.resolverPartido(b, "draw", "2-1"); // 3 goles: más de 2,5 (la de la apuesta)
        expect(pagos).toEqual([{ userId: u, premio: 380, descripcion: "Combinada ganada (cuota 3.8)" }]);
        expect(estado(id)).toEqual({ estado: "ganada", premio: 380 });
    });
});
