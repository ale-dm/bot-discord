// 🎱 Bingo de sala (#528): alguien abre una sala en un canal y la gente entra pagando la entrada fija del servidor, que forma
// el bote (de 2 a 6 jugadores). Cada uno recibe un cartón de 5×5 al estilo americano (columnas B 1-15, I 16-30, N 31-45 con el
// centro libre, G 46-60 y O 61-75). Empieza cuando la abre quien la creó con al menos 2, cuando se llena o a los 2 minutos;
// con menos de 2 se cancela y se devuelve todo. Al empezar se fija el orden de las 75 bolas: así el resultado está decidido en
// el servidor y una partida que pilló un reinicio se resuelve igual. El bot marca solo; gana quien completa el cartón entero
// (solo bingo, sin línea). Si cantan bingo varios con la misma bola, el bote se reparte. Hay un cupo de partidas al día por
// persona. Sin Discord: el canto (una bola cada 3 segundos) está en discord/envios/bingo.js.
const db = require("../core/db");
const dinero = require("./dinero");
const guildSettings = require("./guildSettings");
const autoexclusion = require("./casinoAutoexclusion");
const { momentoMadrid } = require("../core/zonaMadrid");
const { fmtNumero } = require("../core/formato");

const MIN_JUGADORES = 2;
const MAX_JUGADORES = 6;
const ESPERA_MS = 2 * 60 * 1000;
const CUPO_DIARIO = 10;
const BOLAS = 75;
const COLUMNAS = ["B", "I", "N", "G", "O"];
const LIBRE = 0;

const error = (motivo) => ({ ok: false, motivo });

const entrada = (guildId) => Math.max(1, Number(guildSettings.getSettings(guildId).bingo.entrada) || 100);

/** Baraja una lista con el azar dado (Fisher-Yates). */
function barajar(lista, azar) {
    const x = [...lista];
    for (let i = x.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
}

/** Un cartón de 5×5 por columnas (cartón[columna][fila]), con el centro libre (0). */
function carton(azar = Math.random) {
    return COLUMNAS.map((_, c) => {
        const numeros = barajar(
            Array.from({ length: 15 }, (__, i) => c * 15 + i + 1),
            azar,
        ).slice(0, 5);
        if (c === 2) numeros[2] = LIBRE;
        return numeros;
    });
}

/** Cuántas bolas de `orden` hacen falta para completar el cartón (el índice de la última que le falta, contando desde 1). */
function bolasParaCompletar(cart, orden) {
    const posicion = new Map(orden.map((n, i) => [n, i + 1]));
    return Math.max(
        ...cart
            .flat()
            .filter((n) => n !== LIBRE)
            .map((n) => posicion.get(n) || Infinity),
    );
}

const leerPartida = (f) => (f ? { ...f, bolas: f.bolas ? JSON.parse(f.bolas) : null } : null);
const obtener = (id) => leerPartida(db.prepare("SELECT * FROM bingo_partidas WHERE id = ?").get(Number(id)));
const jugadores = (partidaId) =>
    db
        .prepare("SELECT * FROM bingo_jugadores WHERE partida_id = ? ORDER BY entro_en, userId")
        .all(Number(partidaId))
        .map((j) => ({ ...j, carton: JSON.parse(j.carton) }));

/** La sala abierta (esperando o jugando) de un servidor, o null. Una a la vez. */
const activa = (guildId) =>
    leerPartida(
        db
            .prepare("SELECT * FROM bingo_partidas WHERE guildId = ? AND estado IN ('esperando', 'jugando') ORDER BY id DESC LIMIT 1")
            .get(String(guildId)),
    );

/** Cuántas partidas ha jugado hoy (día de Madrid). */
function partidasDeHoy(userId, ahora = Date.now()) {
    const hoy = momentoMadrid(ahora).dia;
    return db
        .prepare("SELECT entro_en FROM bingo_jugadores WHERE userId = ? AND entro_en > ?")
        .pluck()
        .all(String(userId), ahora - 2 * 86400000)
        .filter((ms) => momentoMadrid(ms).dia === hoy).length;
}

/** Entra en la sala pagando la entrada (como el casino: primero el dinero negro) y recibe su cartón. */
function entrar(partidaId, userId, { azar = Math.random, ahora = Date.now() } = {}) {
    const bloqueo = autoexclusion.mensajeBloqueo(userId, ahora);
    if (bloqueo) return error(String(bloqueo).replace(/^❌\s*/, ""));
    if (partidasDeHoy(userId, ahora) >= CUPO_DIARIO) return error(`Ya has jugado ${CUPO_DIARIO} partidas de bingo hoy.`);
    return db.transaction(() => {
        const p = obtener(partidaId);
        if (!p || p.estado !== "esperando") return error("Esta sala ya ha empezado o se ha cerrado.");
        const dentro = jugadores(p.id);
        if (dentro.some((j) => j.userId === String(userId))) return error("Ya estás dentro.");
        if (dentro.length >= MAX_JUGADORES) return error(`La sala está llena (${MAX_JUGADORES} jugadores).`);
        if (!dinero.cobrarCombinado(userId, p.entrada)) return error(`Te hacen falta **${fmtNumero(p.entrada)}** 🪙.`);
        dinero.apuntar(userId, "casino", `Bingo #${p.id}: entrada`, -p.entrada);
        db.prepare("INSERT INTO bingo_jugadores (partida_id, userId, carton, entro_en) VALUES (?, ?, ?, ?)").run(
            p.id,
            String(userId),
            JSON.stringify(carton(azar)),
            ahora,
        );
        db.prepare("UPDATE bingo_partidas SET bote = bote + ? WHERE id = ?").run(p.entrada, p.id);
        return { ok: true, partida: obtener(p.id), llena: dentro.length + 1 >= MAX_JUGADORES };
    })();
}

/** Abre una sala en un canal y entra quien la abre. */
function abrir({ guildId, channelId, userId }, opciones = {}) {
    if (activa(guildId)) return error("Ya hay una sala de bingo en marcha en este servidor.");
    const ahora = opciones.ahora ?? Date.now();
    const { lastInsertRowid } = db
        .prepare("INSERT INTO bingo_partidas (guildId, channelId, abierta_por, entrada, creada, cierra_espera) VALUES (?, ?, ?, ?, ?, ?)")
        .run(String(guildId), channelId, String(userId), entrada(guildId), ahora, ahora + ESPERA_MS);
    const r = entrar(lastInsertRowid, userId, opciones);
    if (!r.ok) {
        db.prepare("DELETE FROM bingo_partidas WHERE id = ?").run(lastInsertRowid);
        return r;
    }
    return { ok: true, partida: obtener(lastInsertRowid) };
}

function guardarMensaje(id, messageId) {
    db.prepare("UPDATE bingo_partidas SET messageId = ? WHERE id = ?").run(messageId, Number(id));
}

/** Devuelve la entrada a todos y la cancela. */
function cancelar(p, ahora) {
    for (const j of jugadores(p.id)) {
        dinero.pagar(j.userId, p.entrada);
        dinero.apuntar(j.userId, "casino", `Bingo #${p.id}: devolución de la entrada`, p.entrada);
    }
    db.prepare("UPDATE bingo_partidas SET estado = 'cancelada', terminada = ? WHERE id = ?").run(ahora, p.id);
}

/**
 * Empieza la partida (quien la abrió, al llenarse o al acabar la espera): fija el orden de las bolas y en qué bola se canta
 * bingo. Con menos de 2 jugadores, la cancela y devuelve. @returns {{ partida, cancelada: boolean } | { ok: false, motivo }}
 */
function empezar(partidaId, { azar = Math.random, ahora = Date.now(), porId = null } = {}) {
    return db.transaction(() => {
        const p = obtener(partidaId);
        if (!p || p.estado !== "esperando") return error("Esta sala ya ha empezado o se ha cerrado.");
        if (porId && p.abierta_por !== String(porId)) return error("Solo quien abrió la sala puede empezarla antes de tiempo.");
        const lista = jugadores(p.id);
        if (lista.length < MIN_JUGADORES) {
            if (porId) return error(`Hacen falta al menos ${MIN_JUGADORES} jugadores.`);
            cancelar(p, ahora);
            return { partida: obtener(p.id), cancelada: true };
        }
        const orden = barajar(
            Array.from({ length: BOLAS }, (_, i) => i + 1),
            azar,
        );
        const ganadora = Math.min(...lista.map((j) => bolasParaCompletar(j.carton, orden)));
        db.prepare("UPDATE bingo_partidas SET estado = 'jugando', bolas = ?, bola_ganadora = ?, empezada = ? WHERE id = ?").run(
            JSON.stringify(orden),
            ganadora,
            ahora,
            p.id,
        );
        return { partida: obtener(p.id), cancelada: false };
    })();
}

/**
 * Termina la partida: reparte el bote entre quienes cantaron bingo con la bola ganadora (lo que no se puede repartir va al
 * primero que entró). Una sola vez. @returns {{ partida, ganadores: { userId, premio }[] } | null}
 */
function terminar(partidaId, ahora = Date.now()) {
    return db.transaction(() => {
        const p = obtener(partidaId);
        if (!p || p.estado !== "jugando") return null;
        const lista = jugadores(p.id);
        const ganan = lista.filter((j) => bolasParaCompletar(j.carton, p.bolas) === p.bola_ganadora);
        db.prepare("UPDATE bingo_partidas SET estado = 'terminada', terminada = ? WHERE id = ?").run(ahora, p.id);
        if (!ganan.length) {
            cancelar(p, ahora);
            return { partida: obtener(p.id), ganadores: [] };
        }
        const parte = Math.floor(p.bote / ganan.length);
        const ganadores = ganan.map((j, n) => ({ userId: j.userId, premio: parte + (n === 0 ? p.bote - parte * ganan.length : 0) }));
        for (const g of ganadores) {
            db.prepare("UPDATE bingo_jugadores SET premio = ? WHERE partida_id = ? AND userId = ?").run(g.premio, p.id, g.userId);
            dinero.pagarConImpuesto(g.userId, p.guildId, "casino", `Bingo #${p.id}: ¡bingo!`, g.premio);
        }
        return { partida: obtener(p.id), ganadores };
    })();
}

/** Las salas que han agotado la espera (hay que empezarlas o cancelarlas). */
const esperasVencidas = (ahora = Date.now()) =>
    db.prepare("SELECT id FROM bingo_partidas WHERE estado = 'esperando' AND cierra_espera <= ?").pluck().all(ahora);

/** Las que se están jugando desde hace más de `ms` (huérfanas de un reinicio: se terminan directamente). */
const jugandoDesde = (ms, ahora = Date.now()) =>
    db
        .prepare("SELECT id FROM bingo_partidas WHERE estado = 'jugando' AND empezada <= ?")
        .pluck()
        .all(ahora - ms);

module.exports = {
    MIN_JUGADORES,
    MAX_JUGADORES,
    ESPERA_MS,
    CUPO_DIARIO,
    BOLAS,
    COLUMNAS,
    LIBRE,
    entrada,
    carton,
    bolasParaCompletar,
    obtener,
    jugadores,
    activa,
    partidasDeHoy,
    abrir,
    entrar,
    guardarMensaje,
    empezar,
    terminar,
    esperasVencidas,
    jugandoDesde,
};
