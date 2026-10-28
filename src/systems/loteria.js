// 🎟️ Lotería semanal (#524): cada servidor tiene un sorteo abierto con su bote. Cada boleto cuesta lo que diga Config Global
// (solo efectivo: con dinero negro sería blanquear a precio de lotería), lleva 4 números distintos del 1 al 20 y hay un tope
// por persona. El sorteo es el domingo a las 21:00 de Madrid: si alguien acierta los 4, se reparte el bote; si no, pasa
// entero al siguiente. Al sortear, si se vendió algún boleto, se suma el 10 % del bote de impuestos (como mucho 100.000).
// Si el bot estaba apagado a la hora, se sortea al arrancar. Sin Discord: anunciar y avisar está en discord/envios/loteria.js.
const db = require("../core/db");
const dinero = require("./dinero");
const impuestos = require("./impuestos");
const guildSettings = require("./guildSettings");
const { momentoMadrid, sumarDias, diaSemana, desfaseMadrid } = require("../core/zonaMadrid");
const { fmtNumero } = require("../core/formato");

const NUMEROS = 4;
const MAX_NUMERO = 20;
const HORA_SORTEO = 21;
const APORTACION_PCT = 10;
const APORTACION_MAX = 100_000;

const error = (motivo) => ({ ok: false, motivo });

/** Precio del boleto, tope por persona y canal de los anuncios. */
function ajustes(guildId) {
    const l = guildSettings.getSettings(guildId).loteria;
    return {
        canal: String(l.canal || ""),
        precio: Math.max(1, Number(l.precio) || 100),
        maxBoletos: Math.max(1, Number(l.max_boletos) || 10),
    };
}

/** El próximo domingo a las 21:00 de Madrid estrictamente después de `ahora` (ms). */
function proximoSorteo(ahora = Date.now()) {
    const m = momentoMadrid(ahora);
    const yaPaso = diaSemana(m.dia) === 7 && m.hora >= HORA_SORTEO;
    const dia = sumarDias(m.dia, (7 - diaSemana(m.dia)) % 7 || (yaPaso ? 7 : 0));
    const [a, mes, d] = dia.split("-").map(Number);
    const comoUtc = Date.UTC(a, mes - 1, d, HORA_SORTEO, 0);
    return comoUtc - desfaseMadrid(comoUtc - 2 * 3600 * 1000);
}

/** «3-7-12-20»: los números ya ordenados, como se guardan. */
const clave = (numeros) => [...numeros].sort((x, y) => x - y).join("-");

/** Lee 4 números distintos del 1 al 20 escritos con espacios, comas o guiones. @returns {number[] | null} ordenados */
function leerNumeros(texto) {
    const partes = String(texto ?? "")
        .split(/[\s,;-]+/)
        .filter(Boolean);
    if (partes.length !== NUMEROS || partes.some((p) => !/^\d{1,2}$/.test(p))) return null;
    const numeros = partes.map(Number);
    if (numeros.some((n) => n < 1 || n > MAX_NUMERO) || new Set(numeros).size !== NUMEROS) return null;
    return numeros.sort((x, y) => x - y);
}

/** 4 números distintos al azar, ordenados. `azar` se inyecta en los tests. */
function alAzar(azar = Math.random) {
    const bombo = Array.from({ length: MAX_NUMERO }, (_, i) => i + 1);
    const salen = [];
    for (let i = 0; i < NUMEROS; i++) salen.push(bombo.splice(Math.floor(azar() * bombo.length), 1)[0]);
    return salen.sort((x, y) => x - y);
}

const obtener = (id) => db.prepare("SELECT * FROM loteria_sorteos WHERE id = ?").get(Number(id)) || null;

/** El sorteo abierto del servidor; si no hay ninguno, abre el primero (con bote 0). */
function abierto(guildId, ahora = Date.now()) {
    const actual = db
        .prepare("SELECT * FROM loteria_sorteos WHERE guildId = ? AND estado = 'abierto' ORDER BY id DESC LIMIT 1")
        .get(String(guildId));
    if (actual) return actual;
    return abrir(guildId, 0, ahora);
}

function abrir(guildId, arrastre, ahora) {
    const { lastInsertRowid } = db
        .prepare("INSERT INTO loteria_sorteos (guildId, estado, bote, arrastre, sorteo_en, abierto_en) VALUES (?, 'abierto', ?, ?, ?, ?)")
        .run(String(guildId), arrastre, arrastre, proximoSorteo(ahora), ahora);
    return obtener(lastInsertRowid);
}

const boletosDe = (sorteoId, userId) =>
    db.prepare("SELECT * FROM loteria_boletos WHERE sorteo_id = ? AND userId = ? ORDER BY id").all(Number(sorteoId), String(userId));

/**
 * Compra un boleto con esos números (o al azar si no se dan). Cobra del efectivo y suma el precio al bote, todo junto.
 * @returns {{ ok: true, boleto: object, sorteo: object } | { ok: false, motivo: string }}
 */
function comprar({ guildId, userId, numeros = null, azar = Math.random, ahora = Date.now() }) {
    const sorteo = abierto(guildId, ahora);
    if (sorteo.sorteo_en <= ahora) return error("El sorteo está a punto de celebrarse: espera al siguiente.");
    const { precio, maxBoletos } = ajustes(guildId);
    const elegidos = numeros ? leerNumeros(numeros.join ? numeros.join(" ") : numeros) : alAzar(azar);
    if (!elegidos) return error(`Elige ${NUMEROS} números distintos del 1 al ${MAX_NUMERO}.`);
    const ok = db.transaction(() => {
        if (boletosDe(sorteo.id, userId).length >= maxBoletos) return "tope";
        if (!dinero.cobrar(userId, precio)) return "saldo";
        db.prepare("INSERT INTO loteria_boletos (sorteo_id, userId, numeros, precio, comprado_en) VALUES (?, ?, ?, ?, ?)").run(
            sorteo.id,
            String(userId),
            clave(elegidos),
            precio,
            ahora,
        );
        db.prepare("UPDATE loteria_sorteos SET bote = bote + ? WHERE id = ?").run(precio, sorteo.id);
        dinero.apuntar(userId, "loteria", `Boleto de lotería ${clave(elegidos)}`, -precio);
        return "ok";
    })();
    if (ok === "tope") return error(`Ya tienes ${maxBoletos} boletos para este sorteo.`);
    if (ok === "saldo") return error(`Te hacen falta **${fmtNumero(precio)}** 🪙 en efectivo (no vale el dinero negro).`);
    const boletos = boletosDe(sorteo.id, userId);
    return { ok: true, boleto: boletos[boletos.length - 1], sorteo: obtener(sorteo.id) };
}

/** Lo que aporta el bote de impuestos a un sorteo: el 10 %, como mucho 100.000. */
const aportacionDe = (guildId) => Math.min(Math.floor((impuestos.boteTotal(guildId) * APORTACION_PCT) / 100), APORTACION_MAX);

/**
 * Celebra un sorteo abierto: saca la combinación, paga a los acertantes (a partes iguales; lo que no se puede repartir pasa
 * al siguiente) y abre el siguiente con lo que quede. Una sola vez aunque se llame dos veces.
 * @returns {{ sorteo, combinacion: string, ganadores: { userId: string, premio: number }[], total: number, aportacion: number, siguiente } | null}
 */
function sortear(sorteoId, { azar = Math.random, ahora = Date.now() } = {}) {
    return db.transaction(() => {
        const sorteo = obtener(sorteoId);
        const combinacion = clave(alAzar(azar));
        const r = db
            .prepare("UPDATE loteria_sorteos SET estado = 'sorteado', combinacion = ?, sorteado_en = ? WHERE id = ? AND estado = 'abierto'")
            .run(combinacion, ahora, Number(sorteoId));
        if (r.changes !== 1) return null;
        const boletos = db.prepare("SELECT * FROM loteria_boletos WHERE sorteo_id = ? ORDER BY id").all(sorteo.id);
        const aportacion = boletos.length ? aportacionDe(sorteo.guildId) : 0;
        if (aportacion > 0) impuestos.sumarBote(sorteo.guildId, -aportacion);
        const total = sorteo.bote + aportacion;
        db.prepare("UPDATE loteria_sorteos SET aportacion = ? WHERE id = ?").run(aportacion, sorteo.id);
        const acertantes = boletos.filter((b) => b.numeros === combinacion);
        const parte = acertantes.length ? Math.floor(total / acertantes.length) : 0;
        const premios = new Map();
        for (const b of acertantes) {
            db.prepare("UPDATE loteria_boletos SET premio = ? WHERE id = ?").run(parte, b.id);
            premios.set(b.userId, (premios.get(b.userId) || 0) + parte);
        }
        for (const [userId, premio] of premios) {
            if (premio > 0) dinero.pagarConImpuesto(userId, sorteo.guildId, "loteria", `Premio de la lotería (${combinacion})`, premio);
        }
        const siguiente = abrir(sorteo.guildId, total - parte * acertantes.length, ahora);
        const ganadores = [...premios].map(([userId, premio]) => ({ userId, premio }));
        return { sorteo: obtener(sorteo.id), combinacion, ganadores, total, aportacion, siguiente, boletos: boletos.length };
    })();
}

/** Los sorteos abiertos cuya hora ya ha llegado (de todos los servidores). */
const vencidos = (ahora = Date.now()) =>
    db.prepare("SELECT * FROM loteria_sorteos WHERE estado = 'abierto' AND sorteo_en <= ? ORDER BY sorteo_en, id").all(ahora);

/** El último sorteo celebrado del servidor, o null. */
const ultimo = (guildId) =>
    db.prepare("SELECT * FROM loteria_sorteos WHERE guildId = ? AND estado = 'sorteado' ORDER BY id DESC LIMIT 1").get(String(guildId)) ||
    null;

module.exports = {
    NUMEROS,
    MAX_NUMERO,
    APORTACION_PCT,
    APORTACION_MAX,
    ajustes,
    proximoSorteo,
    leerNumeros,
    alAzar,
    abierto,
    obtener,
    boletosDe,
    comprar,
    aportacionDe,
    sortear,
    vencidos,
    ultimo,
};
