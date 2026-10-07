// Tono del Duende según la hora o el canal (F-DU-02). No cambia de personalidad (eso ya se hace por canal con /duende
// set): añade una instrucción encima de la que toque.
// - 🌙 De madrugada (de duende.madrugada_desde a duende.madrugada_hasta, hora de Madrid; de 00:00 a 07:00 por defecto):
//   más borde y seco, como alguien al que no le apetece estar despierto.
// - 👔 En los canales formales (duende.canales_formales, IDs separados por comas): más formal y educado, sin tacos.
// Viene desactivado: se configura en /paneladmin → ⚙️ Config Global → 🤖 Duende → 🕐 Tono.
const guildSettings = require("../guildSettings");

const formato = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** { hora, texto: "03:15" } en Madrid. */
function horaDe(ahora) {
    const p = Object.fromEntries(formato.formatToParts(new Date(ahora)).map((x) => [x.type, x.value]));
    return { hora: Number(p.hour), texto: `${p.hour}:${p.minute}` };
}

/** ¿`hora` está entre `desde` (incluida) y `hasta` (sin incluir)? Si desde > hasta, pasa por la medianoche (22 a 7). */
function dentroDeHoras(hora, desde, hasta) {
    if (desde === hasta) return false;
    return desde < hasta ? hora >= desde && hora < hasta : hora >= desde || hora < hasta;
}

const MADRUGADA =
    "Es de madrugada en España (son las {hora}): estás más borde, seco y gruñón de lo normal, como alguien al que no le " +
    "apetece nada estar despierto a estas horas; contestas con menos paciencia.";
const FORMAL =
    "En este canal hablas de forma más formal y educada que de costumbre: sin tacos ni insultos, aunque sigas siendo tú " +
    "(puedes mantener la ironía).";

/** Las instrucciones de tono que tocan ahora en ese canal (texto vacío si ninguna). */
function ajusteDeTono(guildId, channelId, ahora = Date.now()) {
    if (!guildId) return "";
    const cfg = guildSettings.getSettings(guildId).duende;
    const partes = [];
    const { hora, texto } = horaDe(ahora);
    if (cfg.madrugada_activa && dentroDeHoras(hora, Number(cfg.madrugada_desde), Number(cfg.madrugada_hasta))) {
        partes.push(MADRUGADA.replace("{hora}", texto));
    }
    if (channelId && guildSettings.parseCsvIds(cfg.canales_formales).includes(String(channelId))) partes.push(FORMAL);
    return partes.join(" ");
}

module.exports = { dentroDeHoras, ajusteDeTono };
