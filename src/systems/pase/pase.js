// 🛡️ Pase de batalla (#36), temporadas de 15 días. Cada cosa que haces (escribir, estar en voz, jugar al casino, operar en
// cripto, apostar, comprar en la tienda, completar un logro, ganar un reto) da XP de pase, con topes diarios por categoría (que un admin
// puede ajustar, #353). Las misiones del día (3) dan más XP al completarlas, y las tres juntas, un bonus (#334) y rachas (#335). Subir de
// nivel desbloquea una recompensa en monedas (y, en algunos niveles, un objeto, #364), que se cobra a mano en /pase.
// Decisión: el diseño tenía roles de Discord como recompensa (moderación, emojis...). No se conceden: los permisos de
// Discord los decide el servidor, no un juego. Ver docs/planificacion/diseno/pase-de-batalla-s1.md, sección 10.
// Las piezas están en systems/pase/: constantes, ajustes, niveles, xp, misiones, rachas, historial y avisos.
const db = require("../../core/db");
const dinero = require("../dinero");
const catalogo = require("../../repositorios/catalogo");
const { createLogger } = require("../../core/logger");
const {
    DIA_MS,
    DURACION_TEMPORADA_DIAS,
    NIVEL_MAX,
    MISION_XP,
    ORIGEN,
    CATEGORIAS,
    MISIONES,
    RECOMPENSA,
    monedasDelNivel,
} = require("./constantes");
const { ajustes, curvaDe } = require("./ajustes");
const { xpParaNivel, nivelDe } = require("./niveles");
const { sumarXp, alSubirDeNivel } = require("./xp");
const { misionesDeHoy, avanzarMision } = require("./misiones");
const { rachaDe } = require("./rachas");

const log = createLogger("Pase");

const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const diaDe = (ms) => formatoDia.format(new Date(ms));

/** Número de la temporada en ese momento, y sus fechas (inicio y fin en ms, UTC). */
function temporadaDe(ahora = Date.now()) {
    const numero = Math.floor((ahora - ORIGEN) / (DURACION_TEMPORADA_DIAS * DIA_MS));
    const inicio = ORIGEN + numero * DURACION_TEMPORADA_DIAS * DIA_MS;
    return { numero, inicio, fin: inicio + DURACION_TEMPORADA_DIAS * DIA_MS };
}

const usadoHoy = (g, numero, u, categoria, dia) =>
    db
        .prepare("SELECT xp FROM pase_caps WHERE guildId = ? AND temporada = ? AND userId = ? AND categoria = ? AND dia = ?")
        .get(g, numero, u, categoria, dia)?.xp || 0;

/**
 * Suma XP del pase a alguien por un evento (con su tope diario) y avanza sus misiones del día. Con el pase desactivado en el servidor
 * (#353) no suma nada.
 */
function registrar(guildId, userId, categoria, cantidad = 1, ahora = Date.now()) {
    const cfg = CATEGORIAS[categoria];
    const config = ajustes(guildId);
    if (!config.activo) return 0;
    const mision = MISIONES.find((m) => m.categoria === categoria);
    const { numero } = temporadaDe(ahora);
    const dia = diaDe(ahora);
    const g = String(guildId);
    const u = String(userId);
    return db.transaction(() => {
        let ganado = 0;
        if (cfg) {
            ganado = Math.max(0, Math.min(cfg.xp * cantidad, config.topes[categoria] - usadoHoy(g, numero, u, categoria, dia)));
            if (ganado > 0) {
                db.prepare(
                    `INSERT INTO pase_caps (guildId, temporada, userId, categoria, dia, xp) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(guildId, temporada, userId, categoria, dia) DO UPDATE SET xp = xp + excluded.xp`,
                ).run(g, numero, u, categoria, dia, ganado);
                sumarXp(g, numero, u, ganado);
            }
        }
        if (mision && misionesDeHoy(ahora).some((m) => m.id === mision.id)) avanzarMision(g, numero, u, dia, mision, cantidad, ahora);
        return ganado;
    })();
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
    // 📋 Los encargos semanales (#523) avanzan con la misma actividad, aunque el pase esté apagado.
    require("../encargos").registrarSeguro(guildId, userId, categoria, cantidad, ahora);
}

/** El objeto de cada nivel que lo da (#364): { nivel: { id, nombre } }, solo los objetos que siguen en el catálogo. */
function objetosPorNivel(guildId) {
    const resultado = {};
    for (const [nivel, id] of Object.entries(ajustes(guildId).objetos)) {
        const objeto = catalogo.objetoPorId(Number(id));
        if (objeto) resultado[Number(nivel)] = { id: objeto.id, nombre: objeto.nombre };
    }
    return resultado;
}

/** Lo que ve alguien en la temporada actual: nivel, XP, recompensas y misiones de hoy. */
function estado(guildId, userId, ahora = Date.now()) {
    const { numero, fin } = temporadaDe(ahora);
    const curva = curvaDe(guildId);
    const fila = db
        .prepare("SELECT xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND userId = ?")
        .get(String(guildId), numero, String(userId));
    const xp = fila?.xp || 0;
    const nivel = nivelDe(xp, curva);
    const cobrados = new Set(
        db
            .prepare("SELECT nivel FROM pase_recompensas WHERE guildId = ? AND temporada = ? AND userId = ?")
            .all(String(guildId), numero, String(userId))
            .map((r) => r.nivel),
    );
    const objetos = objetosPorNivel(guildId);
    const recompensas = Array.from({ length: NIVEL_MAX }, (_, i) => ({
        nivel: i + 1,
        monedas: monedasDelNivel(i + 1),
        objeto: objetos[i + 1] || null,
        alcanzada: i + 1 <= nivel,
        cobrada: cobrados.has(i + 1),
    }));
    const dia = diaDe(ahora);
    const misiones = misionesDeHoy(ahora).map((m) => {
        const f = db
            .prepare(
                "SELECT progreso, completada FROM pase_misiones WHERE guildId = ? AND temporada = ? AND userId = ? AND dia = ? AND mision = ?",
            )
            .get(String(guildId), numero, String(userId), dia, m.id);
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
        xpSiguiente: nivel < NIVEL_MAX ? xpParaNivel(nivel + 1, curva) : null,
        xpNivelActual: xpParaNivel(nivel, curva),
        recompensas,
        pendientes: recompensas.filter((r) => r.alcanzada && !r.cobrada),
        misiones,
        racha: rachaDe(String(guildId), String(userId), dia),
    };
}

/**
 * Cobra al efectivo las recompensas de los niveles alcanzados y no cobrados, y deja en el inventario los objetos de esos niveles (#364).
 * Todo en una transacción: un nivel no se cobra dos veces (su clave en pase_recompensas lo impide).
 * @returns {{ ok: boolean, monedas: number, niveles: number[], objetos?: { id: number, nombre: string }[] }}
 */
function reclamar(guildId, userId, ahora = Date.now()) {
    const e = estado(guildId, userId, ahora);
    if (!e.pendientes.length) return { ok: false, monedas: 0, niveles: [] };
    const monedas = e.pendientes.reduce((t, r) => t + r.monedas, 0);
    const niveles = e.pendientes.map((r) => r.nivel);
    const objetos = e.pendientes.map((r) => r.objeto).filter(Boolean);
    db.transaction(() => {
        dinero.pagar(String(userId), monedas);
        dinero.apuntar(String(userId), "pase", `Pase de batalla, niveles ${niveles.join(", ")}`, monedas);
        const insertar = db.prepare("INSERT INTO pase_recompensas (guildId, temporada, userId, nivel, cobrado_en) VALUES (?, ?, ?, ?, ?)");
        for (const nivel of niveles) insertar.run(String(guildId), e.temporada, String(userId), nivel, ahora);
        const dar = db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)");
        for (const objeto of objetos) dar.run(String(userId), objeto.id, new Date(ahora).toISOString());
    })();
    return { ok: true, monedas, niveles, ...(objetos.length ? { objetos } : {}) };
}

/** Quién va primero en la temporada actual (XP del pase). */
function top(guildId, limite = 10, ahora = Date.now()) {
    const { numero } = temporadaDe(ahora);
    const curva = curvaDe(guildId);
    return db
        .prepare("SELECT userId, xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND xp > 0 ORDER BY xp DESC, userId LIMIT ?")
        .all(String(guildId), numero, limite)
        .map((r) => ({ userId: r.userId, xp: r.xp, nivel: nivelDe(r.xp, curva) }));
}

/**
 * Tu puesto en la temporada actual (#332), con el mismo orden que `top` (más XP, y a igualdad, el id menor), y lo que te falta para
 * entrar en el top de `limite`. Con 0 XP no hay puesto. `faltan` es 0 si ya estás dentro.
 * @returns {{ puesto: number|null, xp: number, faltan: number }}
 */
function posicionDe(guildId, userId, limite = 10, ahora = Date.now()) {
    const { numero } = temporadaDe(ahora);
    const g = String(guildId);
    const u = String(userId);
    const xp = db.prepare("SELECT xp FROM pase_progreso WHERE guildId = ? AND temporada = ? AND userId = ?").get(g, numero, u)?.xp || 0;
    if (xp <= 0) return { puesto: null, xp, faltan: 0 };
    const delante = db
        .prepare(
            "SELECT COUNT(*) AS n FROM pase_progreso WHERE guildId = ? AND temporada = ? AND xp > 0 AND (xp > ? OR (xp = ? AND userId < ?))",
        )
        .get(g, numero, xp, xp, u).n;
    const puesto = delante + 1;
    if (puesto <= limite) return { puesto, xp, faltan: 0 };
    const [ultimo] = top(g, limite, ahora).slice(-1);
    const necesario = ultimo.xp + (u < ultimo.userId ? 0 : 1);
    return { puesto, xp, faltan: Math.max(0, necesario - xp) };
}

/**
 * Cuánta XP de pase ha usado alguien hoy en cada categoría y cuánto le queda hasta su tope (#331).
 * @returns {{ categoria: string, usado: number, tope: number, lleno: boolean }[]}
 */
function topesDeHoy(guildId, userId, ahora = Date.now()) {
    const { numero } = temporadaDe(ahora);
    const dia = diaDe(ahora);
    const { topes } = ajustes(guildId);
    return Object.keys(CATEGORIAS).map((categoria) => {
        const tope = topes[categoria];
        const usado = Math.min(usadoHoy(String(guildId), numero, String(userId), categoria, dia), tope);
        return { categoria, usado, tope, lleno: usado >= tope };
    });
}

module.exports = {
    MISION_XP,
    NIVEL_MAX,
    CATEGORIAS,

    RECOMPENSA,

    xpParaNivel,
    nivelDe,
    temporadaDe,
    diaDe,
    alSubirDeNivel,

    registrar,
    registrarSeguro,
    registrarEnTodos,
    estado,
    reclamar,
    top,
    posicionDe,
    topesDeHoy,
};
