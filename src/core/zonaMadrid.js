// Fecha y hora en Madrid de un instante (#237). El día de calendario, la hora y el día de la semana, para las tareas y
// las reglas que dependen de la hora local de Madrid (la semana, el día de la racha, la hora de un partido destacado...).
const formatoFecha = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
});
const formatoSemana = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" });

/**
 * { anio, mes, dia: "AAAA-MM-DD", hora, lunes, finDeSemana } en hora de Madrid, de un instante (Date o milisegundos).
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
        lunes: diaSemana === "Mon",
        finDeSemana: diaSemana === "Sat" || diaSemana === "Sun",
    };
}

module.exports = { momentoMadrid };
