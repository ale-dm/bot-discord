// 🏆 Torneos de casino (#525): un admin programa uno (un juego del casino o todos, coste de inscripción, cuándo empieza y
// cuánto dura); la gente se apunta pagando la inscripción, que forma el bote (la casa no pone nada). Durante el torneo
// cuenta la ganancia neta (premios menos apuestas) de las partidas de ese juego en esa ventana, sacada de la tabla del
// casino: no hay que tocar los juegos. Al terminar se reparte 50/30/20 entre los tres primeros; las posiciones empatadas
// suman sus premios y los reparten a partes iguales, y las siguientes se corren. Con menos de tres, los porcentajes de las
// plazas que hay se reparten en proporción. Con menos de 2 inscritos al empezar, o si un admin lo cancela antes, se devuelve
// la inscripción a todos. Uno a la vez por servidor. Sin Discord: el mensaje está en paneles/torneo.js.
const db = require("../core/db");
const dinero = require("./dinero");
const { JUEGOS_CASINO } = require("./guildSettings/definicion");
const { fmtNumero } = require("../core/formato");

const JUEGOS = [...JUEGOS_CASINO, "rasca"];
const REPARTO = [50, 30, 20];
const MIN_INSCRITOS = 2;
const HORA_MS = 3600 * 1000;
const MIN_MS = 60 * 1000;
const EN_MARCHA = "('inscripcion', 'en_curso')";

const error = (motivo) => ({ ok: false, motivo });
const entero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

const obtener = (id) => db.prepare("SELECT * FROM torneos WHERE id = ?").get(Number(id)) || null;

/** El torneo en marcha del servidor (en inscripción o en curso), o null. */
const activo = (guildId) =>
    db.prepare(`SELECT * FROM torneos WHERE guildId = ? AND estado IN ${EN_MARCHA} ORDER BY id DESC LIMIT 1`).get(String(guildId)) || null;

const inscritos = (torneoId) =>
    db.prepare("SELECT * FROM torneo_inscritos WHERE torneo_id = ? ORDER BY inscrito_en, userId").all(Number(torneoId));

/**
 * Programa un torneo. `empiezaEnMin`: minutos hasta que empieza (la inscripción está abierta hasta entonces); `horas`: cuánto
 * dura. @returns {{ ok: true, torneo } | { ok: false, motivo }}
 */
function crear({ guildId, porId, juego, inscripcion, empiezaEnMin, horas, channelId = null }, ahora = Date.now()) {
    if (juego !== "todos" && !JUEGOS.includes(juego)) return error("Ese juego no es del casino.");
    if (!entero(inscripcion, 1, 1_000_000)) return error("La inscripción va de 1 a 1.000.000 🪙.");
    if (!entero(empiezaEnMin, 1, 7 * 24 * 60)) return error("Tiene que empezar dentro de 1 minuto a 7 días.");
    if (!entero(horas, 1, 72)) return error("Dura de 1 a 72 horas.");
    if (activo(guildId)) return error("Ya hay un torneo en marcha en este servidor.");
    const empieza = ahora + empiezaEnMin * MIN_MS;
    const { lastInsertRowid } = db
        .prepare(
            `INSERT INTO torneos (guildId, juego, inscripcion, empieza, termina, creado_por, creado_en, channelId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(String(guildId), juego, inscripcion, empieza, empieza + horas * HORA_MS, String(porId), ahora, channelId);
    return { ok: true, torneo: obtener(lastInsertRowid) };
}

function guardarMensaje(id, channelId, messageId) {
    db.prepare("UPDATE torneos SET channelId = ?, messageId = ? WHERE id = ?").run(channelId, messageId, Number(id));
}

/** Se apunta pagando la inscripción del efectivo, que va al bote. Solo antes de que empiece. */
function inscribir(torneoId, userId, ahora = Date.now()) {
    return db.transaction(() => {
        const t = obtener(torneoId);
        if (!t || t.estado !== "inscripcion" || t.empieza <= ahora) return error("La inscripción de este torneo está cerrada.");
        if (db.prepare("SELECT 1 FROM torneo_inscritos WHERE torneo_id = ? AND userId = ?").get(t.id, String(userId))) {
            return error("Ya estás inscrito.");
        }
        if (!dinero.cobrar(userId, t.inscripcion)) return error(`Te hacen falta **${fmtNumero(t.inscripcion)}** 🪙 en efectivo.`);
        dinero.apuntar(userId, "casino", `Inscripción al torneo #${t.id}`, -t.inscripcion);
        db.prepare("INSERT INTO torneo_inscritos (torneo_id, userId, inscrito_en) VALUES (?, ?, ?)").run(t.id, String(userId), ahora);
        db.prepare("UPDATE torneos SET bote = bote + ? WHERE id = ?").run(t.inscripcion, t.id);
        return { ok: true, torneo: obtener(t.id) };
    })();
}

/**
 * La clasificación: la ganancia neta de cada inscrito en las partidas del juego dentro de la ventana, de mayor a menor (a
 * igualdad, quien se inscribió antes va primero en la lista, pero comparte puesto).
 */
function clasificacion(t, hasta = t.termina) {
    const desde = new Date(t.empieza).toISOString();
    const fin = new Date(Math.min(hasta, t.termina)).toISOString();
    const filtroJuego = t.juego === "todos" ? "" : "AND juego = ?";
    const neto = db.prepare(`SELECT COALESCE(SUM(resultado), 0) FROM casino WHERE userId = ? AND fecha >= ? AND fecha < ? ${filtroJuego}`);
    return inscritos(t.id)
        .map((i) => ({ ...i, neto: neto.pluck().get(i.userId, desde, fin, ...(t.juego === "todos" ? [] : [t.juego])) }))
        .sort((a, b) => b.neto - a.neto || a.inscrito_en - b.inscrito_en);
}

/**
 * Los premios del bote: 50/30/20 entre los tres primeros, con los empates sumando los premios de sus posiciones y
 * repartiéndolos a partes iguales. Lo que no se pueda repartir en monedas enteras va al primero.
 * @returns {{ userId: string, neto: number, puesto: number, premio: number }[]}
 */
function repartir(tabla, bote) {
    const plazas = Math.min(REPARTO.length, tabla.length);
    const pesos = REPARTO.slice(0, plazas);
    const suma = pesos.reduce((s, p) => s + p, 0);
    const resultado = tabla.map((f) => ({ userId: f.userId, neto: f.neto, puesto: 0, premio: 0 }));
    let i = 0;
    while (i < resultado.length) {
        let j = i;
        while (j + 1 < resultado.length && resultado[j + 1].neto === resultado[i].neto) j++;
        const pctGrupo = pesos.slice(i, j + 1).reduce((s, p) => s + p, 0);
        const parte = Math.floor((bote * pctGrupo) / suma / (j - i + 1));
        for (let k = i; k <= j; k++) Object.assign(resultado[k], { puesto: i + 1, premio: pctGrupo ? parte : 0 });
        i = j + 1;
    }
    const resto = bote - resultado.reduce((s, r) => s + r.premio, 0);
    if (resultado.length && resto > 0) resultado[0].premio += resto;
    return resultado;
}

/** Devuelve la inscripción a todos y lo da por cancelado. */
function devolverYCancelar(t, ahora) {
    for (const i of inscritos(t.id)) {
        dinero.pagar(i.userId, t.inscripcion);
        dinero.apuntar(i.userId, "casino", `Devolución de la inscripción al torneo #${t.id}`, t.inscripcion);
    }
    db.prepare("UPDATE torneos SET estado = 'cancelado', cerrado_en = ? WHERE id = ?").run(ahora, t.id);
}

/** Un admin cancela el torneo antes de que empiece: se devuelve todo. */
function cancelar(guildId, ahora = Date.now()) {
    return db.transaction(() => {
        const t = activo(guildId);
        if (!t) return error("No hay ningún torneo en marcha.");
        if (t.estado !== "inscripcion") return error("Ya ha empezado: no se puede cancelar.");
        devolverYCancelar(t, ahora);
        return { ok: true, torneo: obtener(t.id) };
    })();
}

/**
 * Avanza un torneo según la hora: empieza (o se cancela con menos de 2 inscritos) y termina, pagando los premios. Una sola
 * vez por paso. @returns {{ torneo, paso: 'empieza'|'cancelado'|'terminado', premios? } | null}
 */
function avanzar(torneoId, ahora = Date.now()) {
    return db.transaction(() => {
        const t = obtener(torneoId);
        if (t?.estado === "inscripcion" && t.empieza <= ahora) {
            if (inscritos(t.id).length < MIN_INSCRITOS) {
                devolverYCancelar(t, ahora);
                return { torneo: obtener(t.id), paso: "cancelado" };
            }
            db.prepare("UPDATE torneos SET estado = 'en_curso' WHERE id = ? AND estado = 'inscripcion'").run(t.id);
            return { torneo: obtener(t.id), paso: "empieza" };
        }
        if (t?.estado !== "en_curso" || t.termina > ahora) return null;
        const premios = repartir(clasificacion(t), t.bote);
        const poner = db.prepare("UPDATE torneo_inscritos SET neto = ?, puesto = ?, premio = ? WHERE torneo_id = ? AND userId = ?");
        for (const p of premios) {
            poner.run(p.neto, p.puesto, p.premio, t.id, p.userId);
            if (p.premio > 0)
                dinero.pagarConImpuesto(p.userId, t.guildId, "premio", `Torneo de casino #${t.id}: puesto ${p.puesto}`, p.premio);
        }
        db.prepare("UPDATE torneos SET estado = 'terminado', cerrado_en = ? WHERE id = ?").run(ahora, t.id);
        return { torneo: obtener(t.id), paso: "terminado", premios };
    })();
}

/** Los torneos a los que les toca cambiar de fase. */
const pendientes = (ahora = Date.now()) =>
    db
        .prepare(
            `SELECT id FROM torneos WHERE (estado = 'inscripcion' AND empieza <= ?) OR (estado = 'en_curso' AND termina <= ?) ORDER BY id`,
        )
        .pluck()
        .all(ahora, ahora);

/** Los que están en curso (para repintar su clasificación). */
const enCurso = () => db.prepare("SELECT * FROM torneos WHERE estado = 'en_curso' ORDER BY id").all();

module.exports = {
    JUEGOS,
    REPARTO,
    MIN_INSCRITOS,
    obtener,
    activo,
    inscritos,
    crear,
    guardarMensaje,
    inscribir,
    clasificacion,
    repartir,
    cancelar,
    avanzar,
    pendientes,
    enCurso,
};
