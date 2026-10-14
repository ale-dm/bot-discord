// 🌙 Horario de silencio de los sonidos (#330): un tramo del día (hora de Madrid, como la sesión de cine) en el que /sonidos no
// suena, y un interruptor para apagarlos del todo. El tramo puede cruzar la medianoche (22:00 a 08:00).
const { momentoMadrid } = require("../../core/zonaMadrid");

/** "08:00" → minutos desde la medianoche, o null si no es una hora HH:MM. */
function parseHora(texto) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(texto ?? "").trim());
    if (!m) return null;
    const [h, min] = [Number(m[1]), Number(m[2])];
    return h > 23 || min > 59 ? null : h * 60 + min;
}

const formatearHora = (minutos) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

/** Valida las dos horas del tramo. Las dos vacías quitan el horario. @returns {{ ok: boolean, motivo?: string, desde?: string, hasta?: string }} */
function validarHorario(desde, hasta) {
    const [d, h] = [String(desde ?? "").trim(), String(hasta ?? "").trim()];
    if (!d && !h) return { ok: true, desde: "", hasta: "" };
    const [dm, hm] = [parseHora(d), parseHora(h)];
    if (dm === null || hm === null)
        return { ok: false, motivo: "Escribe las dos horas como HH:MM (por ejemplo 00:00 y 08:00), o déjalas vacías." };
    if (dm === hm) return { ok: false, motivo: "La hora de inicio y la de fin no pueden ser la misma." };
    return { ok: true, desde: formatearHora(dm), hasta: formatearHora(hm) };
}

/**
 * ¿Están en silencio los sonidos ahora? `cfg` = { apagado, desde, hasta } (ajustes `sonidos.*`).
 * @returns {{ silencio: boolean, hasta?: string }} `hasta` (HH:MM) falta si están apagados del todo
 */
function silencioAhora({ apagado, desde, hasta }, ahora = Date.now()) {
    if (apagado) return { silencio: true };
    const [dm, hm] = [parseHora(desde), parseHora(hasta)];
    if (dm === null || hm === null || dm === hm) return { silencio: false };
    const m = momentoMadrid(ahora);
    const minuto = m.hora * 60 + m.minuto;
    const dentro = dm < hm ? minuto >= dm && minuto < hm : minuto >= dm || minuto < hm;
    return dentro ? { silencio: true, hasta: formatearHora(hm) } : { silencio: false };
}

const avisoSilencio = (r) => (r.hasta ? `🌙 Los sonidos están en silencio hasta las ${r.hasta}.` : "🌙 Los sonidos están apagados.");

module.exports = { parseHora, validarHorario, silencioAhora, avisoSilencio };
