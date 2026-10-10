// El ranking de apostadores (systems/apuestas/ranking) calcula todo con consultas agrupadas, no una por persona (#285).
// Este test lo compara con cifras(), que sigue haciendo las consultas de una persona, sobre un volumen de datos
// aleatorio pero reproducible: si las dos rutas dieran cifras distintas, el ranking enseñaría otra cosa que 📊 Stats.
const db = require("../src/core/db");
const ranking = require("../src/systems/apuestas/ranking");

// Generador de 32 bits fijo (mulberry32): el mismo dato en cada ejecución.
let semilla = 7;
const azar = () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const elegir = (xs) => xs[Math.floor(azar() * xs.length)];

const USUARIOS = Array.from({ length: 120 }, (_, i) => `vol-${i}`);
const INICIO = Date.UTC(2026, 0, 1);

function cargarDatos() {
    const partido = db.prepare(
        "INSERT INTO apuestas_partidos (match_id, home_team, away_team, start_time, estado, deporte, resultado) VALUES (?, 'Local', 'Visitante', ?, ?, 'laliga', 'home')",
    );
    const apuesta = db.prepare(
        "INSERT INTO apuestas_usuario (user_id, match_id, eleccion, cantidad, cuota, pagado, premio) VALUES (?, ?, 'home', ?, 2, 1, ?)",
    );
    for (let n = 0; n < 1500; n++) {
        const matchId = `vol-p-${n}`;
        const estado = elegir(["finalizado", "finalizado", "finalizado", "abierto", "caducado"]);
        partido.run(matchId, new Date(INICIO + n * 3600_000).toISOString(), estado);
        for (let k = 0; k < 1 + Math.floor(azar() * 3); k++) {
            const premio = elegir([null, 0, 0, 50, 300, 1000]);
            apuesta.run(elegir(USUARIOS), matchId, 10 + Math.floor(azar() * 90), premio);
        }
    }
    const quiniela = db.prepare("INSERT INTO quinielas (deporte, jornada, estado, creada_en) VALUES ('laliga', 'J', ?, ?)");
    const jugada = db.prepare(
        "INSERT INTO quiniela_apuestas (quiniela_id, user_id, predicciones, cantidad, premio, pagado, creada_en) VALUES (?, ?, '1', ?, ?, 1, ?)",
    );
    for (let n = 0; n < 200; n++) {
        const estado = elegir(["abierta", "cerrada", "cerrada", "caducada"]);
        const cuando = new Date(INICIO + n * 86400_000).toISOString();
        const id = quiniela.run(estado, cuando).lastInsertRowid;
        for (let k = 0; k < 1 + Math.floor(azar() * 4); k++) {
            jugada.run(id, elegir(USUARIOS), 20 + Math.floor(azar() * 80), elegir([0, 0, 150, 400]), cuando);
        }
    }
}

const porBeneficio = (a, b) => b.beneficio - a.beneficio || (b.acierto ?? -1) - (a.acierto ?? -1);

beforeAll(() => {
    cargarDatos();
});

test("el ranking agrupado da exactamente las cifras de cada persona", () => {
    const ids = db
        .prepare("SELECT user_id FROM apuestas_usuario UNION SELECT user_id FROM quiniela_apuestas")
        .all()
        .map((r) => r.user_id)
        .filter(Boolean);
    const esperado = ids
        .map((id) => ranking.cifras(id))
        .filter((c) => c.resueltas >= ranking.MIN_RESUELTAS)
        .sort(porBeneficio);

    expect(esperado.length).toBeGreaterThan(20);
    expect(ranking.ranking({ limite: 1000 })).toEqual(esperado.slice(0, 1000));
});

test("sin mínimo, entran todos los que tienen apuestas, también los que no tienen nada resuelto", () => {
    const ids = db
        .prepare("SELECT user_id FROM apuestas_usuario UNION SELECT user_id FROM quiniela_apuestas")
        .all()
        .map((r) => r.user_id)
        .filter(Boolean);
    const esperado = ids.map((id) => ranking.cifras(id)).sort(porBeneficio);

    expect(ranking.ranking({ limite: 1000, minimo: 0 })).toEqual(esperado.slice(0, 1000));
});
