// 🎉 Eventos temporales (F-EC-02): durante un rato, los multiplicadores que ya existen suben solos.
// - ⚡ Happy hour de XP: cada día, de una hora a otra (hora de Madrid), la XP que se gana se multiplica (×2 por defecto),
//   encima del multiplicador global de XP y antes del bonus de racha (systems/xp/progreso).
// - 🎰 Fin de semana del casino: sábado y domingo (hora de Madrid), el premio neto de cada victoria del casino se
//   multiplica (150 % por defecto), igual que el RTP de cada juego y encima de él (casinoTransactions.applyRtp).
// Los dos vienen desactivados: se activan y ajustan en /paneladmin → ⚙️ Config Global → 🎉 Eventos.
const guildSettings = require("./guildSettings");

const formato = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", hourCycle: "h23" });
/** { hora, finDeSemana } en Madrid. */
function momento(ahora) {
    const p = Object.fromEntries(formato.formatToParts(new Date(ahora)).map((x) => [x.type, x.value]));
    return { hora: Number(p.hour), finDeSemana: p.weekday === "Sat" || p.weekday === "Sun" };
}

/** ¿`hora` está entre `desde` (incluida) y `hasta` (sin incluir)? Si desde > hasta, pasa por la medianoche (22 a 2). */
function dentroDeHoras(hora, desde, hasta) {
    if (desde === hasta) return false;
    return desde < hasta ? hora >= desde && hora < hasta : hora >= desde || hora < hasta;
}

/** Los eventos de un servidor y si están en marcha ahora. */
function estado(guildId, ahora = Date.now()) {
    const cfg = guildSettings.getSettings(guildId).eventos;
    const m = momento(ahora);
    const xp = { ...cfg.xp, enMarcha: Boolean(cfg.xp.activo) && dentroDeHoras(m.hora, cfg.xp.desde, cfg.xp.hasta) };
    const casino = { ...cfg.casino, enMarcha: Boolean(cfg.casino.activo) && m.finDeSemana };
    return { xp, casino };
}

/** Por cuánto se multiplica ahora la XP (1 si no hay happy hour). */
function multiplicadorXp(guildId, ahora = Date.now()) {
    const { xp } = estado(guildId, ahora);
    return xp.enMarcha ? Math.max(1, Number(xp.mult) || 1) : 1;
}

/** % del premio neto del casino ahora (100 si no es fin de semana del casino). */
function porcentajeCasino(guildId, ahora = Date.now()) {
    const { casino } = estado(guildId, ahora);
    return casino.enMarcha ? Math.max(100, Number(casino.pct) || 100) : 100;
}

const numero = (n) => Number(n).toLocaleString("es");

/** Línea para enseñar a la gente un evento en marcha (o null): "⚡ Happy hour: XP ×2 hasta las 22:00". */
function lineaXp(guildId, ahora = Date.now()) {
    const { xp } = estado(guildId, ahora);
    return xp.enMarcha ? `⚡ **Happy hour**: XP ×${numero(xp.mult)} hasta las ${String(xp.hasta).padStart(2, "0")}:00` : null;
}
function lineaCasino(guildId, ahora = Date.now()) {
    const { casino } = estado(guildId, ahora);
    return casino.enMarcha ? `🎉 **Fin de semana del casino**: premios ×${numero(casino.pct / 100)} hasta el lunes` : null;
}

module.exports = { dentroDeHoras, estado, multiplicadorXp, porcentajeCasino, lineaXp, lineaCasino };
