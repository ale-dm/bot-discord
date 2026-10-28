// 📋 Encargos semanales de economía (#523): tres retos por persona y semana (de lunes a domingo, hora de Madrid), uno fácil,
// uno medio y uno difícil, sacados de un catálogo de acciones positivas (nunca de gastar dinero). El progreso llega solo con
// lo que la persona hace de verdad: el registro de actividad del pase (systems/pase/pase.js → registrarSeguro) avisa aquí de
// cada evento, también con el pase apagado, así que los encargos no dependen de las tablas del pase. La recompensa (de 100 a
// 500 monedas según la dificultad) se cobra con un botón, una sola vez; lo que no se completa caduca con la semana.
// Los encargos de una semana se eligen al azar con una semilla fija (persona y semana): son siempre los mismos aunque se
// pidan varias veces. Sin Discord: la pantalla está en paneles/encargos.js.
const db = require("../core/db");
const dinero = require("./dinero");
const { createLogger } = require("../core/logger");
const { momentoMadrid, lunesDe, sumarDias, aFecha, desfaseMadrid } = require("../core/zonaMadrid");

/** El catálogo: cada encargo con su categoría de actividad y la meta de cada dificultad. */
const CATALOGO = [
    { id: "casino_gana", categoria: "casino_gana", texto: (n) => `Gana ${n} 🪙 en el casino`, metas: [300, 1500, 5000] },
    { id: "apuesta_ganada", categoria: "apuesta_ganada", texto: (n) => `Acierta ${n} apuestas deportivas`, metas: [1, 3, 6] },
    { id: "robo", categoria: "robo", texto: (n) => `Roba con éxito ${n} ${n === 1 ? "vez" : "veces"}`, metas: [1, 3, 6] },
    { id: "trabajo", categoria: "trabajo", texto: (n) => `Trabaja ${n} veces con éxito`, metas: [3, 8, 15] },
    { id: "mensaje", categoria: "mensaje", texto: (n) => `Escribe ${n} mensajes`, metas: [30, 120, 300] },
    { id: "voz", categoria: "voz", texto: (n) => `Pasa ${n} minutos en voz`, metas: [30, 120, 300] },
    { id: "reto", categoria: "reto", texto: (n) => `Juega ${n} ${n === 1 ? "reto" : "retos"} contra alguien`, metas: [1, 3, 5] },
    { id: "logro", categoria: "logro", texto: (n) => `Completa ${n} ${n === 1 ? "logro" : "logros"}`, metas: [1, 2, 4] },
];
const DIFICULTADES = [
    { id: "facil", nombre: "Fácil", recompensa: 100 },
    { id: "media", nombre: "Media", recompensa: 250 },
    { id: "dificil", nombre: "Difícil", recompensa: 500 },
];
const CATEGORIAS = new Set(CATALOGO.map((e) => e.categoria));

const log = createLogger("Encargos");
const error = (motivo) => ({ ok: false, motivo });

/** El lunes («AAAA-MM-DD», hora de Madrid) de la semana de `ahora`. */
const semanaDe = (ahora = Date.now()) => lunesDe(momentoMadrid(ahora).dia);

/** Cuándo acaba la semana que empieza en `lunes`: el lunes siguiente a las 00:00 de Madrid (ms). */
function finDeSemana(lunes) {
    const comoUtc = aFecha(sumarDias(lunes, 7)).getTime();
    return comoUtc - desfaseMadrid(comoUtc);
}

/** Un número de 0 a 1 que siempre sale igual para la misma semilla (FNV-1a + xorshift). */
function azarFijo(semilla) {
    let h = 2166136261;
    for (const c of semilla) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h ^= h << 13;
        h ^= h >>> 17;
        h ^= h << 5;
        return ((h >>> 0) % 1_000_000) / 1_000_000;
    };
}

/** Los tres encargos de una persona y semana: tres del catálogo distintos, fácil, medio y difícil. */
function elegir(userId, semana) {
    const azar = azarFijo(`${userId}|${semana}`);
    const bolsa = [...CATALOGO];
    return DIFICULTADES.map((dif, slot) => {
        const e = bolsa.splice(Math.floor(azar() * bolsa.length), 1)[0];
        return { slot, encargo: e.id, categoria: e.categoria, dificultad: dif.id, meta: e.metas[slot], recompensa: dif.recompensa };
    });
}

/** Le asigna los encargos de la semana si aún no los tiene (una vez). */
function asegurar(guildId, userId, semana) {
    const insertar = db.prepare(
        `INSERT OR IGNORE INTO encargos (guildId, userId, semana, slot, encargo, categoria, dificultad, meta, recompensa)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of elegir(userId, semana)) {
        insertar.run(String(guildId), String(userId), semana, e.slot, e.encargo, e.categoria, e.dificultad, e.meta, e.recompensa);
    }
}

const leer = (f) => {
    const e = CATALOGO.find((c) => c.id === f.encargo);
    const dif = DIFICULTADES.find((d) => d.id === f.dificultad);
    return { ...f, texto: e ? e.texto(f.meta) : f.encargo, nombreDificultad: dif?.nombre || f.dificultad };
};

/** Los encargos de esta semana de alguien (se los asigna si aún no los tenía), con el fin de la semana. */
function deLaSemana(guildId, userId, ahora = Date.now()) {
    const semana = semanaDe(ahora);
    asegurar(guildId, userId, semana);
    const filas = db
        .prepare("SELECT * FROM encargos WHERE guildId = ? AND userId = ? AND semana = ? ORDER BY slot")
        .all(String(guildId), String(userId), semana)
        .map(leer);
    return { semana, fin: finDeSemana(semana), encargos: filas };
}

/**
 * Suma `cantidad` a los encargos de esa categoría que siguen sin completar esta semana, sin pasar de la meta. Lo llama el
 * registro de actividad del pase con cada evento. @returns {number} cuántos encargos se han completado ahora
 */
function registrar(guildId, userId, categoria, cantidad = 1, ahora = Date.now()) {
    if (!CATEGORIAS.has(categoria) || !guildId || !(cantidad > 0)) return 0;
    const semana = semanaDe(ahora);
    asegurar(guildId, userId, semana);
    return db.transaction(() => {
        const g = String(guildId);
        const u = String(userId);
        db.prepare(
            `UPDATE encargos SET progreso = MIN(meta, progreso + ?)
             WHERE guildId = ? AND userId = ? AND semana = ? AND categoria = ? AND completado_en IS NULL`,
        ).run(Math.floor(cantidad), g, u, semana, categoria);
        return db
            .prepare(
                `UPDATE encargos SET completado_en = ?
                 WHERE guildId = ? AND userId = ? AND semana = ? AND categoria = ? AND completado_en IS NULL AND progreso >= meta`,
            )
            .run(ahora, g, u, semana, categoria).changes;
    })();
}

/** Como registrar, pero sin romper nunca a quien avisa (un mensaje, un robo, una partida): si falla, al log. */
function registrarSeguro(guildId, userId, categoria, cantidad = 1, ahora = Date.now()) {
    try {
        registrar(guildId, userId, categoria, cantidad, ahora);
    } catch (e) {
        log.warn(`Encargos (${categoria}) de ${userId} en ${guildId}: ${e.message}`);
    }
}

/** Para lo que no sabe en qué servidor pasó (casino, apuestas): en todos los servidores donde tiene actividad. */
function registrarEnTodos(userId, categoria, cantidad = 1, ahora = Date.now()) {
    if (!CATEGORIAS.has(categoria)) return;
    const servidores = db.prepare("SELECT DISTINCT guildId FROM xp_users WHERE userId = ?").pluck().all(String(userId));
    for (const guildId of servidores) registrarSeguro(guildId, userId, categoria, cantidad, ahora);
}

/** Cobra la recompensa de un encargo completado de esta semana, una sola vez. */
function reclamar(guildId, userId, slot, ahora = Date.now()) {
    const semana = semanaDe(ahora);
    return db.transaction(() => {
        const f = db
            .prepare("SELECT * FROM encargos WHERE guildId = ? AND userId = ? AND semana = ? AND slot = ?")
            .get(String(guildId), String(userId), semana, Number(slot));
        if (!f) return error("Ese encargo ya no es de esta semana.");
        if (!f.completado_en) return error("Todavía no lo has completado.");
        const r = db
            .prepare(
                "UPDATE encargos SET reclamado_en = ? WHERE guildId = ? AND userId = ? AND semana = ? AND slot = ? AND reclamado_en IS NULL",
            )
            .run(ahora, String(guildId), String(userId), semana, Number(slot));
        if (r.changes !== 1) return error("Ya cobraste este encargo.");
        const e = leer(f);
        dinero.pagarConImpuesto(userId, guildId, "premio", `Encargo semanal: ${e.texto}`, f.recompensa);
        return { ok: true, encargo: e };
    })();
}

module.exports = {
    CATALOGO,
    DIFICULTADES,
    CATEGORIAS,
    semanaDe,
    finDeSemana,
    elegir,
    deLaSemana,
    registrar,
    registrarSeguro,
    registrarEnTodos,
    reclamar,
};
