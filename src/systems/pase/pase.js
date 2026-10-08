// 🛡️ Pase de batalla (#36), temporadas de 15 días. Cada cosa que haces (escribir, estar en voz, jugar al casino, operar en
// cripto, apostar, comprar en la tienda, completar un logro) da XP de pase, con topes diarios por categoría. Las misiones
// del día (3) dan más XP al completarlas. Subir de nivel desbloquea una recompensa en monedas, que se cobra a mano en /pase.
// Decisión: el diseño tenía roles de Discord como recompensa (moderación, emojis...). No se conceden: los permisos de
// Discord los decide el servidor, no un juego. Ver docs/planificacion/diseno/pase-de-batalla-s1.md, sección 10.
const db = require("../../core/db");
const dinero = require("../dinero");
const { createLogger } = require("../../core/logger");

const log = createLogger("Pase");

const DIA_MS = 86400 * 1000;
const DURACION_TEMPORADA_DIAS = 15;
const NIVEL_MAX = 20;
const MISION_XP = 70;
const MISIONES_DIA = 3;
const ORIGEN = Date.UTC(2026, 9, 1); // la temporada 0 empezó el 1 de octubre de 2026 (hora de Madrid, a medianoche)

/** XP de pase por categoría: cuánto da cada cosa y el tope diario (de la propuesta de diseño, sección 2). */
const CATEGORIAS = {
    mensaje: { xp: 2, tope: 120 },
    voz: { xp: 1, tope: 120 }, // por minuto
    casino: { xp: 8, tope: 260 },
    cripto: { xp: 6, tope: 180 },
    apuesta: { xp: 12, tope: 180 },
    tienda: { xp: 8, tope: 80 },
    logro: { xp: 20, tope: 120 }, // por logro completado (no los de la importación de Plex)
};

/** Misiones del día: se eligen 3 de estas cada día (rotando), y cuentan los eventos de su categoría. */
const MISIONES = [
    { id: "mensajes", nombre: "Envía 25 mensajes", categoria: "mensaje", meta: 25 },
    { id: "voz", nombre: "Pasa 10 minutos en voz", categoria: "voz", meta: 10 },
    { id: "casino", nombre: "Juega 5 partidas de casino", categoria: "casino", meta: 5 },
    { id: "cripto", nombre: "Haz 2 operaciones de cripto", categoria: "cripto", meta: 2 },
    { id: "apuesta", nombre: "Ten 1 apuesta resuelta", categoria: "apuesta", meta: 1 },
];

/** Recompensa en monedas de cada nivel (de la propuesta, en TTCL que se leen como monedas 🪙), y el bonus del nivel final. */
const RECOMPENSA = [80, 120, 160, 200, 240, 300, 360, 430, 500, 600, 700, 820, 950, 1100, 1250, 1400, 1600, 1800, 2100, 2500];
const BONUS_FINAL = 2000;

const xpDelNivel = (n) => 280 + (n - 1) * 40;
/** XP acumulada necesaria para llegar al nivel n (el nivel 1 cuesta 0). */
function xpParaNivel(n) {
    let total = 0;
    for (let k = 1; k < n; k++) total += xpDelNivel(k);
    return total;
}
/** Nivel de un total de XP de pase: 1 a NIVEL_MAX. */
function nivelDe(xp) {
    let nivel = 1;
    while (nivel < NIVEL_MAX && xp >= xpParaNivel(nivel + 1)) nivel++;
    return nivel;
}

const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const diaDe = (ms) => formatoDia.format(new Date(ms));

/** Número de la temporada en ese momento, y sus fechas (inicio y fin en ms, UTC). */
function temporadaDe(ahora = Date.now()) {
    const numero = Math.floor((ahora - ORIGEN) / (DURACION_TEMPORADA_DIAS * DIA_MS));
    const inicio = ORIGEN + numero * DURACION_TEMPORADA_DIAS * DIA_MS;
    return { numero, inicio, fin: inicio + DURACION_TEMPORADA_DIAS * DIA_MS };
}

/** Las 3 misiones de hoy: rotan con el día, así que son las mismas para todos. */
function misionesDeHoy(ahora = Date.now()) {
    const indice = Math.floor((ahora - ORIGEN) / DIA_MS);
    return Array.from({ length: MISIONES_DIA }, (_, k) => MISIONES[(indice + k) % MISIONES.length]);
}

/** Suma XP del pase a alguien por un evento (con su tope diario) y avanza sus misiones del día. */
function registrar(guildId, userId, categoria, cantidad = 1, ahora = Date.now()) {
    const cfg = CATEGORIAS[categoria];
    const mision = MISIONES.find((m) => m.categoria === categoria);
    const { numero } = temporadaDe(ahora);
    const dia = diaDe(ahora);
    const g = String(guildId);
    const u = String(userId);
    const ganada = db.transaction(() => {
        let ganado = 0;
        if (cfg) {
            const usado =
                db
                    .prepare("SELECT xp FROM pase_caps WHERE guildId = ? AND temporada = ? AND userId = ? AND categoria = ? AND dia = ?")
                    .get(g, numero, u, categoria, dia)?.xp || 0;
            ganado = Math.max(0, Math.min(cfg.xp * cantidad, cfg.tope - usado));
            if (ganado > 0) {
                db.prepare(
                    `INSERT INTO pase_caps (guildId, temporada, userId, categoria, dia, xp) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(guildId, temporada, userId, categoria, dia) DO UPDATE SET xp = xp + excluded.xp`,
                ).run(g, numero, u, categoria, dia, ganado);
                sumarXp(g, numero, u, ganado);
            }
        }
        if (mision && misionesDeHoy(ahora).some((m) => m.id === mision.id)) avanzarMision(g, numero, u, dia, mision, cantidad);
        return ganado;
    })();
    return ganada;
}

function sumarXp(guildId, temporada, userId, xp) {
    db.prepare(
        `INSERT INTO pase_progreso (guildId, temporada, userId, xp) VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, temporada, userId) DO UPDATE SET xp = xp + excluded.xp`,
    ).run(guildId, temporada, userId, xp);
}

function avanzarMision(guildId, temporada, userId, dia, mision, cantidad) {
    db.prepare(
        `INSERT INTO pase_misiones (guildId, temporada, userId, dia, mision, progreso) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId, temporada, userId, dia, mision) DO UPDATE SET progreso = progreso + excluded.progreso`,
    ).run(guildId, temporada, userId, dia, mision.id, cantidad);
    const fila = db
        .prepare(
            "SELECT progreso, completada FROM pase_misiones WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?",
        )
        .get(guildId, temporada, userId, dia, mision.id);
    if (!fila.completada && fila.progreso >= mision.meta) {
        db.prepare(
            "UPDATE pase_misiones SET completada = 1 WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?",
        ).run(guildId, temporada, userId, dia, mision.id);
        sumarXp(guildId, temporada, userId, MISION_XP);
    }
}

/** Como registrar, pero para los eventos globales (apuestas y cripto): en cada servidor donde esa persona tiene XP. */
function registrarEnTodos(userId, categoria, cantidad = 1, ahora = Date.now()) {
    const servidores = db.prepare("SELECT DISTINCT guildId FROM xp_users WHERE userId = ?").all(String(userId));
    for (const { guildId } of servidores) registrarSeguro(guildId, userId, categoria, cantidad, ahora);
}

/**
 * Para los engranajes del bot que no deben romperse por el pase (un mensaje, una compra, una apuesta): si falla, se
 * avisa en el log y se sigue. No devuelve nada.
 */
function registrarSeguro(guildId, userId, categoria, cantidad = 1, ahora = Date.now()) {
    try {
        registrar(guildId, userId, categoria, cantidad, ahora);
    } catch (e) {
        log.warn(`Pase de batalla (${categoria}) de ${userId} en ${guildId}: ${e.message}`);
    }
}

/** Lo que ve alguien en la temporada actual: nivel, XP, recompensas y misiones de hoy. */
function estado(guildId, userId, ahora = Date.now()) {
    const { numero, fin } = temporadaDe(ahora);
    const fila = db
        .prepare("SELECT xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND userId = ?")
        .get(String(guildId), numero, String(userId));
    const xp = fila?.xp || 0;
    const nivel = nivelDe(xp);
    const cobrados = new Set(
        db
            .prepare("SELECT nivel FROM pase_recompensas WHERE guildId = ? AND temporada = ? AND userId = ?")
            .all(String(guildId), numero, String(userId))
            .map((r) => r.nivel),
    );
    const recompensas = Array.from({ length: NIVEL_MAX }, (_, i) => ({
        nivel: i + 1,
        monedas: RECOMPENSA[i] + (i + 1 === NIVEL_MAX ? BONUS_FINAL : 0),
        alcanzada: i + 1 <= nivel,
        cobrada: cobrados.has(i + 1),
    }));
    const misiones = misionesDeHoy(ahora).map((m) => {
        const f = db
            .prepare(
                "SELECT progreso, completada FROM pase_misiones WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?",
            )
            .get(String(guildId), numero, String(userId), diaDe(ahora), m.id);
        return {
            id: m.id,
            nombre: m.nombre,
            meta: m.meta,
            progreso: Math.min(f?.progreso || 0, m.meta),
            completada: Boolean(f?.completada),
        };
    });
    return {
        temporada: numero,
        fin,
        xp,
        nivel,
        xpSiguiente: nivel < NIVEL_MAX ? xpParaNivel(nivel + 1) : null,
        recompensas,
        pendientes: recompensas.filter((r) => r.alcanzada && !r.cobrada),
        misiones,
    };
}

/** Cobra al efectivo las recompensas de los niveles alcanzados y no cobrados. @returns {{ ok, monedas, niveles }} */
function reclamar(guildId, userId, ahora = Date.now()) {
    const e = estado(guildId, userId, ahora);
    if (!e.pendientes.length) return { ok: false, monedas: 0, niveles: [] };
    const monedas = e.pendientes.reduce((t, r) => t + r.monedas, 0);
    const niveles = e.pendientes.map((r) => r.nivel);
    db.transaction(() => {
        dinero.pagar(String(userId), monedas);
        dinero.apuntar(String(userId), "pase", `Pase de batalla, niveles ${niveles.join(", ")}`, monedas);
        const insertar = db.prepare("INSERT INTO pase_recompensas (guildId, temporada, userId, nivel, cobrado_en) VALUES (?, ?, ?, ?, ?)");
        for (const nivel of niveles) insertar.run(String(guildId), e.temporada, String(userId), nivel, ahora);
    })();
    return { ok: true, monedas, niveles };
}

/** Quién va primero en la temporada actual (XP del pase). */
function top(guildId, limite = 10, ahora = Date.now()) {
    const { numero } = temporadaDe(ahora);
    return db
        .prepare("SELECT userId, xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND xp > 0 ORDER BY xp DESC, userId LIMIT ?")
        .all(String(guildId), numero, limite)
        .map((r) => ({ userId: r.userId, xp: r.xp, nivel: nivelDe(r.xp) }));
}

module.exports = {
    MISION_XP,
    NIVEL_MAX,
    CATEGORIAS,
    MISIONES,
    RECOMPENSA,
    BONUS_FINAL,
    xpParaNivel,
    nivelDe,
    temporadaDe,
    misionesDeHoy,
    registrar,
    registrarSeguro,
    registrarEnTodos,
    estado,
    reclamar,
    top,
};
