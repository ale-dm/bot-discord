// Fecha y hora en Madrid de un instante (#237). El día de calendario, la hora y el día de la semana, para las tareas y
// las reglas que dependen de la hora local de Madrid (la semana, el día de la racha, la hora de un partido destacado...).
const formatoFecha = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});
const formatoSemana = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" });

/**
 * { anio, mes, dia: "AAAA-MM-DD", hora, minuto, lunes, finDeSemana } en hora de Madrid, de un instante (Date o milisegundos).
 */
function momentoMadrid(instante) {
    const fecha = new Date(instante);
    const p = Object.fromEntries(formatoFecha.formatToParts(fecha).map((x) => [x.type, x.value]));
    const diaSemana = formatoSemana.format(fecha); // "Mon", "Tue"…, "Sun"
    return {
        anio: Number(p.year),
        mes: Number(p.month),
        dia: `${p.year}-${p.month}-${p.day}`,
        hora: Number(p.hour),
        minuto: Number(p.minute),
        lunes: diaSemana === "Mon",
        finDeSemana: diaSemana === "Sat" || diaSemana === "Sun",
    };
}

const DIA_MS = 86400 * 1000;
/** Un día «AAAA-MM-DD» como fecha (a las 00:00 UTC, solo para contar días). */
const aFecha = (dia) => new Date(`${dia}T00:00:00Z`);
/** El día «AAAA-MM-DD» `n` días después (o antes, si es negativo). */
const sumarDias = (dia, n) => new Date(aFecha(dia).getTime() + n * DIA_MS).toISOString().slice(0, 10);
/** 1 = lunes … 7 = domingo. */
const diaSemana = (dia) => aFecha(dia).getUTCDay() || 7;
/** El lunes de la semana de un día «AAAA-MM-DD». */
const lunesDe = (dia) => sumarDias(dia, 1 - diaSemana(dia));

/** La semana anterior completa (lunes y domingo, AAAA-MM-DD, en hora de Madrid) respecto a `ahora`. */
function semanaAnterior(ahora = Date.now()) {
    const lunesActual = lunesDe(momentoMadrid(ahora).dia);
    return { lunes: sumarDias(lunesActual, -7), domingo: sumarDias(lunesActual, -1) };
}

/** Cuánto se adelanta la hora de Madrid a UTC (ms) en un instante: 1 h en invierno, 2 h en verano. */
function desfaseMadrid(instante) {
    const m = momentoMadrid(instante);
    const comoUtc = Date.UTC(m.anio, m.mes - 1, Number(m.dia.slice(8, 10)), m.hora, m.minuto);
    return comoUtc - Math.floor(instante / 60000) * 60000;
}

/**
 * Un texto «DD/MM/AAAA» o «DD/MM/AAAA HH:MM» en hora de Madrid, como milisegundos (null si no es una fecha válida). Sin hora,
 * las 00:00.
 */
function fechaMadridAMs(texto) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(String(texto).trim());
    if (!m) return null;
    const [dia, mes, anio, hora = 0, minuto = 0] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
    const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto);
    const ms = comoUtc - desfaseMadrid(comoUtc - desfaseMadrid(comoUtc));
    const v = momentoMadrid(ms);
    const ok = v.anio === anio && v.mes === mes && v.dia.endsWith(String(dia).padStart(2, "0")) && v.hora === hora && v.minuto === minuto;
    return ok ? ms : null;
}

module.exports = { fechaMadridAMs, momentoMadrid, aFecha, sumarDias, diaSemana, lunesDe, semanaAnterior };
