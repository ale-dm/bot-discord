// 🏇 Carreras con cuotas (#535): cada 15 minutos (en punto, y cuarto, y media y menos cuarto) se corre una carrera de 6
// caballos en el canal elegido. Cada caballo tiene un peso al azar; su probabilidad de ganar es su peso entre el total y su
// cuota, fija, sale de esa probabilidad con un 10 % de margen para la casa. Se apuesta a un solo caballo por carrera, con un
// importe entre el mínimo y el tope por persona, hasta que empieza. El ganador lo decide el servidor con esos pesos; quien
// acierta cobra lo apostado × la cuota. Una carrera que pilló el bot apagado se resuelve al arrancar (sin animación). Sin
// Discord: el mensaje y la animación están en paneles/carrera.js y discord/envios/carreras.js.
const db = require("../core/db");
const dinero = require("./dinero");
const guildSettings = require("./guildSettings");
const autoexclusion = require("./casinoAutoexclusion");
const limitePerdidas = require("./limitePerdidas");
const { fmtNumero } = require("../core/formato");

const CABALLOS = [
    { nombre: "Relámpago", emoji: "🐎" },
    { nombre: "Trueno", emoji: "🏇" },
    { nombre: "Canela", emoji: "🦄" },
    { nombre: "Tornado", emoji: "🐴" },
    { nombre: "Pimienta", emoji: "🎠" },
    { nombre: "Cometa", emoji: "🦓" },
];
const PESOS = [30, 22, 16, 14, 10, 8];
const MARGEN = 0.1;
const INTERVALO_MS = 15 * 60 * 1000;
const AVISO_MS = 2 * 60 * 1000;
const MIN_APUESTA = 10;

const error = (motivo) => ({ ok: false, motivo });

/** Canal, tope por persona y si están activas (hace falta un canal). */
function ajustes(guildId) {
    const c = guildSettings.getSettings(guildId).carreras;
    return { canal: String(c.canal || ""), maxApuesta: Math.max(MIN_APUESTA, Number(c.max_apuesta) || 1000) };
}

/** La cuota de una probabilidad, con el margen de la casa y dos decimales (como mínimo 1,10). */
const cuotaDe = (probabilidad) => Math.max(1.1, Math.floor(((1 - MARGEN) / probabilidad) * 100) / 100);

/** Los 6 corredores con los pesos repartidos al azar y su cuota. */
function corredores(azar = Math.random) {
    const pesos = [...PESOS];
    for (let i = pesos.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [pesos[i], pesos[j]] = [pesos[j], pesos[i]];
    }
    const total = pesos.reduce((s, p) => s + p, 0);
    return CABALLOS.map((c, n) => ({ ...c, peso: pesos[n], cuota: cuotaDe(pesos[n] / total) }));
}

/** El siguiente cuarto de hora en punto estrictamente después de `ahora`. */
const siguienteCuarto = (ahora) => Math.floor(ahora / INTERVALO_MS) * INTERVALO_MS + INTERVALO_MS;

const leer = (f) => (f ? { ...f, corredores: JSON.parse(f.corredores), avisada: Boolean(f.avisada) } : null);
const obtener = (id) => leer(db.prepare("SELECT * FROM carreras WHERE id = ?").get(Number(id)));
const abierta = (guildId) =>
    leer(db.prepare("SELECT * FROM carreras WHERE guildId = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1").get(String(guildId)));

/** Abre la próxima carrera del servidor si no hay ninguna abierta (con al menos 3 minutos para apostar). */
function asegurarAbierta(guildId, channelId, { azar = Math.random, ahora = Date.now() } = {}) {
    const actual = abierta(guildId);
    if (actual) return { carrera: actual, nueva: false };
    let empieza = siguienteCuarto(ahora);
    if (empieza - ahora < 3 * 60 * 1000) empieza += INTERVALO_MS;
    const { lastInsertRowid } = db
        .prepare("INSERT INTO carreras (guildId, channelId, corredores, empieza) VALUES (?, ?, ?, ?)")
        .run(String(guildId), channelId, JSON.stringify(corredores(azar)), empieza);
    return { carrera: obtener(lastInsertRowid), nueva: true };
}

function guardarMensaje(id, messageId) {
    db.prepare("UPDATE carreras SET messageId = ? WHERE id = ?").run(messageId, Number(id));
}

const apuestas = (carreraId) => db.prepare("SELECT * FROM carrera_apuestas WHERE carrera_id = ? ORDER BY creada").all(Number(carreraId));

/**
 * Apuesta a un caballo (uno por carrera). Cobra antes el dinero negro y luego el efectivo, como el resto del casino, y
 * respeta la autoexclusión y el límite de pérdidas. @returns {{ ok: true, apuesta } | { ok: false, motivo }}
 */
function apostar(carreraId, userId, corredor, cantidad, ahora = Date.now()) {
    const c = obtener(carreraId);
    if (!c || c.estado !== "abierta" || c.empieza <= ahora) return error("Las apuestas de esta carrera ya están cerradas.");
    const caballo = c.corredores[Number(corredor)];
    if (!caballo) return error("Ese caballo no corre.");
    const { maxApuesta } = ajustes(c.guildId);
    if (!Number.isInteger(cantidad) || cantidad < MIN_APUESTA || cantidad > maxApuesta) {
        return error(`La apuesta va de ${MIN_APUESTA} a ${fmtNumero(maxApuesta)} 🪙.`);
    }
    const bloqueo = autoexclusion.mensajeBloqueo(userId, ahora) || limitePerdidas.motivoDeBloqueo(userId, cantidad, ahora);
    if (bloqueo) return error(String(bloqueo).replace(/^❌\s*/, ""));
    return db.transaction(() => {
        if (db.prepare("SELECT 1 FROM carrera_apuestas WHERE carrera_id = ? AND userId = ?").get(c.id, String(userId))) {
            return error("Ya has apostado en esta carrera: una apuesta por persona.");
        }
        if (!dinero.cobrarCombinado(userId, cantidad)) return error("No te llega el dinero para esa apuesta.");
        dinero.apuntar(userId, "casino", `Carrera #${c.id}: ${fmtNumero(cantidad)} a ${caballo.nombre} @${caballo.cuota}`, -cantidad);
        db.prepare("INSERT INTO carrera_apuestas (carrera_id, userId, corredor, cantidad, cuota, creada) VALUES (?, ?, ?, ?, ?, ?)").run(
            c.id,
            String(userId),
            Number(corredor),
            cantidad,
            caballo.cuota,
            ahora,
        );
        return { ok: true, apuesta: { corredor: Number(corredor), cantidad, cuota: caballo.cuota, caballo } };
    })();
}

/** El ganador, al azar con los pesos de cada caballo. */
function sortearGanador(lista, azar = Math.random) {
    const total = lista.reduce((s, c) => s + c.peso, 0);
    let tirada = azar() * total;
    for (let i = 0; i < lista.length; i++) {
        tirada -= lista[i].peso;
        if (tirada < 0) return i;
    }
    return lista.length - 1;
}

/**
 * Resuelve una carrera que ya ha empezado: elige el ganador y paga a quien acertó, una sola vez.
 * @returns {{ carrera, ganadores: { userId, premio }[], apostado: number } | null}
 */
function resolver(carreraId, { azar = Math.random, ahora = Date.now() } = {}) {
    return db.transaction(() => {
        const c = obtener(carreraId);
        if (!c || c.estado !== "abierta" || c.empieza > ahora) return null;
        const ganador = sortearGanador(c.corredores, azar);
        db.prepare("UPDATE carreras SET estado = 'resuelta', ganador = ?, resuelta_en = ? WHERE id = ? AND estado = 'abierta'").run(
            ganador,
            ahora,
            c.id,
        );
        const lista = apuestas(c.id);
        const ganadores = [];
        for (const a of lista.filter((x) => x.corredor === ganador)) {
            const premio = Math.floor(a.cantidad * a.cuota);
            db.prepare("UPDATE carrera_apuestas SET premio = ? WHERE carrera_id = ? AND userId = ?").run(premio, c.id, a.userId);
            dinero.pagarConImpuesto(a.userId, c.guildId, "casino", `Carrera #${c.id}: ganó ${c.corredores[ganador].nombre}`, premio);
            ganadores.push({ userId: a.userId, premio });
        }
        return { carrera: obtener(c.id), ganadores, apostado: lista.reduce((s, a) => s + a.cantidad, 0) };
    })();
}

/** Las carreras abiertas que ya deberían haberse corrido. */
const vencidas = (ahora = Date.now()) =>
    db.prepare("SELECT id FROM carreras WHERE estado = 'abierta' AND empieza <= ? ORDER BY empieza").pluck().all(ahora);

/** Las abiertas a las que les toca el aviso de 2 minutos (las marca: el aviso sale una vez). */
function porAvisar(ahora = Date.now()) {
    const filas = db
        .prepare("SELECT * FROM carreras WHERE estado = 'abierta' AND avisada = 0 AND empieza > ? AND empieza - ? <= ?")
        .all(ahora, ahora, AVISO_MS)
        .map(leer);
    for (const c of filas) db.prepare("UPDATE carreras SET avisada = 1 WHERE id = ?").run(c.id);
    return filas;
}

/** Las últimas carreras resueltas del servidor (el histórico). */
const historial = (guildId, limite = 5) =>
    db
        .prepare("SELECT * FROM carreras WHERE guildId = ? AND estado = 'resuelta' ORDER BY id DESC LIMIT ?")
        .all(String(guildId), limite)
        .map(leer);

module.exports = {
    CABALLOS,
    PESOS,
    MARGEN,
    INTERVALO_MS,
    MIN_APUESTA,
    ajustes,
    cuotaDe,
    corredores,
    siguienteCuarto,
    obtener,
    abierta,
    asegurarAbierta,
    guardarMensaje,
    apuestas,
    apostar,
    sortearGanador,
    resolver,
    vencidas,
    porAvisar,
    historial,
};
