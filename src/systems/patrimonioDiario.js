// 📈 Evolución del dinero (#388): cada día se guarda el efectivo + banco de cada persona (el negro no cuenta) al empezar el día, hora
// de Madrid, y 💰 Economía enseña los últimos 30 con barras de texto. Se guardan 35 días. Si el bot estaba apagado a esa hora, se
// guarda al arrancar (guardarHoy no pisa lo que ya hay).
const db = require("../core/db");
const { madridDateStr } = require("./xp/rachas");
const { sumarDias } = require("../core/zonaMadrid");

const DIAS_MOSTRADOS = 30;
const DIAS_GUARDADOS = 35;
const BARRAS = "▁▂▃▄▅▆▇█";

/** Guarda el total de todos los que tienen cuenta para el día de `ahora` (los que ya tienen fila se dejan) y borra lo viejo. @returns {number} filas nuevas */
function guardarHoy(ahora = Date.now()) {
    const hoy = madridDateStr(new Date(ahora));
    return db.transaction(() => {
        const r = db
            .prepare("INSERT OR IGNORE INTO patrimonio_diario (userId, dia, total) SELECT userId, ?, enMano + saldo FROM banco")
            .run(hoy);
        db.prepare("DELETE FROM patrimonio_diario WHERE dia < ?").run(sumarDias(hoy, -DIAS_GUARDADOS));
        return r.changes;
    })();
}

/** Los últimos 30 días de alguien, del más antiguo al más reciente: [{ dia, total }]. */
function ultimos(userId, ahora = Date.now()) {
    const desde = sumarDias(madridDateStr(new Date(ahora)), -(DIAS_MOSTRADOS - 1));
    return db.prepare("SELECT dia, total FROM patrimonio_diario WHERE userId = ? AND dia >= ? ORDER BY dia").all(String(userId), desde);
}

/** Una barra de texto por día, de la más baja a la más alta. */
function barras(totales) {
    const min = Math.min(...totales);
    const max = Math.max(...totales);
    return totales.map((t) => BARRAS[max === min ? 3 : Math.round(((t - min) / (max - min)) * (BARRAS.length - 1))]).join("");
}

/** { barras, dias, neto } de alguien, o null si aún no tiene historial. */
function evolucion(userId, ahora = Date.now()) {
    const filas = ultimos(userId, ahora);
    if (!filas.length) return null;
    return { barras: barras(filas.map((f) => f.total)), dias: filas.length, neto: filas.at(-1).total - filas[0].total };
}

module.exports = { DIAS_MOSTRADOS, guardarHoy, ultimos, barras, evolucion };
