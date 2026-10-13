// Crear retos: la validación de cada tipo (partido, duelo, porra) y la propuesta contra el Duende.
const db = require("../../core/db");
const dinero = require("../dinero");
const { createLogger } = require("../../core/logger");
const {
    MIN,
    MAX,
    MAX_PENDIENTES,
    ESPERA_ACEPTAR_MS,
    PORRA_DIAS,
    PORRA_MAX_OPCIONES,
    PORRA_MAX_LARGO_OPCION,
    TOPE_DUENDE,
    ELECCIONES,
    DUENDE,
    SIN_EFECTIVO,
    JUEGOS,
} = require("./constantes");
const { error, SinEfectivo, jugadaAlAzar } = require("./comun");
const { obtener, partidoDe, guardarDatos, guardarMensaje } = require("./persistencia");
const { unir } = require("./cobros");
const { bloqueado } = require("./bloqueos");

const log = createLogger("Retos");

function validarCantidad(cantidad) {
    if (!Number.isInteger(cantidad) || cantidad < MIN || cantidad > MAX) {
        return `❌ La cantidad tiene que ser un número entero entre ${MIN} y ${MAX.toLocaleString("es")}.`;
    }
    return null;
}

const MAX_PROVOCACION = 100;

/**
 * La frase de provocación opcional de un reto (#440): sin frase, `{ ok: true, texto: null }`. Se limpia (espacios y
 * saltos de línea) y se rechaza si es muy larga o lleva una mención masiva (@everyone, @here).
 */
function validarProvocacion(frase) {
    const texto = String(frase ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (!texto) return { ok: true, texto: null };
    if (texto.length > MAX_PROVOCACION) return { ok: false, mensaje: `❌ La frase puede tener como mucho ${MAX_PROVOCACION} caracteres.` };
    if (/@(everyone|here)/i.test(texto))
        return { ok: false, mensaje: "❌ La frase no puede mencionar a todo el mundo (@everyone o @here)." };
    return { ok: true, texto };
}

// ─── Crear ───────────────────────────────────────────────────────────────────

function insertar(campos, opcionCreador) {
    try {
        const reto = db.transaction(() => {
            const ahora = Date.now();
            const info = db
                .prepare(
                    `INSERT INTO retos (tipo, estado, creador, rival, cantidad, guildId, channelId, match_id, eleccion, juego, pregunta, opciones,
                                        provocacion, cierra_en, serie, creado_en, actualizado_en, expira_en)
                     VALUES (@tipo, @estado, @creador, @rival, @cantidad, @guildId, @channelId, @match_id, @eleccion, @juego, @pregunta, @opciones,
                             @provocacion, @cierra_en, @serie, @ahora, @ahora, @expira_en)`,
                )
                .run({
                    guildId: null,
                    channelId: null,
                    match_id: null,
                    eleccion: null,
                    juego: null,
                    pregunta: null,
                    opciones: null,
                    provocacion: null,
                    cierra_en: null,
                    serie: 1,
                    ...campos,
                    creador: String(campos.creador),
                    rival: campos.rival ? String(campos.rival) : null,
                    ahora,
                });
            const nuevo = obtener(info.lastInsertRowid);
            if (opcionCreador !== undefined && !unir(nuevo, campos.creador, opcionCreador)) throw new SinEfectivo();
            return obtener(nuevo.id);
        })();
        log.info(`Reto ${reto.id} creado (${reto.tipo}) por ${reto.creador}${reto.rival ? ` contra ${reto.rival}` : ""}: ${reto.cantidad}`);
        return { ok: true, reto };
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        throw e;
    }
}

/** Lo que se contesta a quien intenta retar a alguien que le ha bloqueado (#450): no dice que hay un bloqueo. */
const NO_SE_PUEDE_RETAR = "❌ No puedes retar a esa persona ahora mismo.";

/** `abierto` (#438): un duelo sin rival fijo, que acepta el primero que quiera. */
function validarDuelo(creador, rival, cantidad, abierto = false) {
    if (!rival && !abierto) return "❌ Elige a quién retas.";
    if (rival && String(rival) === String(creador)) return "❌ No puedes retarte a ti mismo.";
    if (rival && bloqueado(rival, creador)) return NO_SE_PUEDE_RETAR;
    const n = db.prepare("SELECT COUNT(*) AS n FROM retos WHERE creador = ? AND estado = 'pendiente'").get(String(creador)).n;
    if (n >= MAX_PENDIENTES) return `❌ Ya tienes ${n} retos sin aceptar: espera a que respondan o cancela alguno.`;
    return validarCantidad(cantidad);
}

/** Apuesta 1 contra 1 a un partido: el creador va con `eleccion` (home/draw/away) y el rival con lo contrario. */
function crearPartido({ creador, rival, matchId, eleccion, cantidad, provocacion = null, guildId = null, channelId = null }) {
    const invalido = validarDuelo(creador, rival, cantidad);
    if (invalido) return error(invalido);
    const frase = validarProvocacion(provocacion);
    if (!frase.ok) return error(frase.mensaje);
    if (!ELECCIONES.includes(eleccion)) return error("❌ Elige un resultado.");
    const p = partidoDe(matchId);
    if (!p) return error("❌ No encuentro ese partido.");
    if (p.estado !== "abierto" || !(p.start_time > new Date().toISOString())) return error("⏱️ Ese partido ya ha empezado.");
    const expira = Math.min(Date.now() + ESPERA_ACEPTAR_MS, Date.parse(p.start_time));
    return insertar(
        {
            tipo: "partido",
            estado: "pendiente",
            creador,
            rival,
            cantidad,
            guildId,
            channelId,
            match_id: matchId,
            eleccion,
            provocacion: frase.texto,
            expira_en: expira,
        },
        "a_favor",
    );
}

/** Duelo de casino (ppt, dados o blackjack) contra otra persona. */
function crearDuelo({
    creador,
    rival = null,
    abierto = false,
    juego,
    cantidad,
    serie = 1,
    provocacion = null,
    guildId = null,
    channelId = null,
}) {
    const invalido = validarDuelo(creador, rival, cantidad, abierto);
    if (invalido) return error(invalido);
    if (!JUEGOS[juego]) return error("❌ Ese juego no existe.");
    if (![1, 3].includes(serie)) return error("❌ Un duelo se juega a una partida o al mejor de 3.");
    const frase = validarProvocacion(provocacion);
    if (!frase.ok) return error(frase.mensaje);
    return insertar(
        {
            tipo: "duelo",
            estado: "pendiente",
            creador,
            rival: abierto ? null : rival,
            cantidad,
            guildId,
            channelId,
            juego,
            serie,
            provocacion: frase.texto,
            expira_en: Date.now() + ESPERA_ACEPTAR_MS,
        },
        null,
    );
}

/** Opciones de una porra a partir de lo escrito en el formulario (una por línea o separadas por comas). */
function leerOpciones(texto) {
    const opciones = String(texto || "")
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean);
    return opciones.length ? opciones : ["Sí", "No"];
}

const MINUTO_MS = 60 * 1000;
const UNIDADES_CIERRE = { m: MINUTO_MS, h: 60 * MINUTO_MS, d: 24 * 60 * MINUTO_MS };

/**
 * Cuánto falta para cerrar una porra, escrito como «30m», «2h» o «1d» (un número solo son horas), en milisegundos (#448).
 * Vacío = sin cierre automático (`ms: null`). Tiene que ser de al menos un minuto y de menos de PORRA_DIAS días, que es
 * cuando una porra sin resolver se devuelve.
 * @returns {{ ok: true, ms: number | null } | { ok: false, mensaje: string }}
 */
function leerCierre(texto) {
    const t = String(texto ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    if (!t) return { ok: true, ms: null };
    const m = /^(\d+(?:[.,]\d+)?)([mhd])?$/.exec(t);
    const invalido = { ok: false, mensaje: "❌ El cierre se escribe como 30m, 2h o 1d (minutos, horas o días)." };
    if (!m) return invalido;
    const ms = Math.round(Number(m[1].replace(",", ".")) * UNIDADES_CIERRE[m[2] || "h"]);
    if (!(ms >= MINUTO_MS)) return { ok: false, mensaje: "❌ El cierre tiene que ser de al menos un minuto." };
    if (ms >= PORRA_DIAS * UNIDADES_CIERRE.d) return { ok: false, mensaje: `❌ El cierre tiene que ser de menos de ${PORRA_DIAS} días.` };
    return { ok: true, ms };
}

/**
 * Porra: cualquiera entra con `cantidad` eligiendo una opción, y un admin decide cuál gana. Con `cierraEn` (ms desde ahora,
 * ver leerCierre), la porra pasa sola a cerrada al llegar ese momento (#448); sin él se cierra a mano.
 */
function crearPorra({ creador, pregunta, opciones, cantidad, cierraEn = null, guildId = null, channelId = null }) {
    const texto = String(pregunta || "").trim();
    if (texto.length < 3 || texto.length > 200) return error("❌ La pregunta tiene que tener entre 3 y 200 caracteres.");
    if (opciones.length < 2 || opciones.length > PORRA_MAX_OPCIONES) {
        return error(`❌ Pon entre 2 y ${PORRA_MAX_OPCIONES} opciones.`);
    }
    if (opciones.some((o) => o.length > PORRA_MAX_LARGO_OPCION)) {
        return error(`❌ Cada opción puede tener como mucho ${PORRA_MAX_LARGO_OPCION} caracteres.`);
    }
    if (new Set(opciones.map((o) => o.toLowerCase())).size !== opciones.length) return error("❌ Hay opciones repetidas.");
    const invalida = validarCantidad(cantidad);
    if (invalida) return error(invalida);
    if (cierraEn !== null && !(cierraEn >= MINUTO_MS && cierraEn < PORRA_DIAS * UNIDADES_CIERRE.d)) {
        return error("❌ El cierre automático tiene que estar entre un minuto y el plazo de la porra.");
    }
    return insertar({
        tipo: "porra",
        estado: "abierta",
        creador,
        cantidad,
        guildId,
        channelId,
        pregunta: texto,
        opciones: JSON.stringify(opciones),
        cierra_en: cierraEn === null ? null : Date.now() + cierraEn,
        expira_en: Date.now() + PORRA_DIAS * 24 * 3600 * 1000,
    });
}

/**
 * Por qué no se puede jugar `cantidad` contra el Duende (texto), o null si se puede. Con `matchId` y `eleccion`, a un
 * partido; si no, a piedra-papel-tijera. Lo usan las herramientas del Duende antes de proponerlo y crearContraDuende.
 */
function motivoNoContraDuende(userId, cantidad, { matchId = null, eleccion = null } = {}) {
    if (!Number.isInteger(cantidad) || cantidad < MIN || cantidad > TOPE_DUENDE) {
        return `Contra el Duende se juega un número entero entre ${MIN} y ${TOPE_DUENDE.toLocaleString("es")} 🪙.`;
    }
    const prestamo = require("../prestamos").abierto(userId);
    if (prestamo?.estado === "deuda") {
        return `Debes **${prestamo.falta.toLocaleString("es")}** 🪙 al Duende de un préstamo vencido: hasta saldarlo no te juegas nada con él.`;
    }
    if (matchId) {
        if (!ELECCIONES.includes(eleccion)) return "Elige un resultado.";
        const p = partidoDe(matchId);
        if (!p) return "No encuentro ese partido.";
        if (p.estado !== "abierto" || !(p.start_time > new Date().toISOString())) return "Ese partido ya ha empezado.";
    }
    if (dinero.efectivo(userId) < cantidad) return SIN_EFECTIVO.replace(/^❌ /, "");
    return null;
}

/**
 * Un reto contra el Duende que la persona acaba de aceptar (F-DU-03): empieza ya en juego, con lo suyo cobrado y la
 * parte del Duende puesta por la banca. Sin `matchId`, piedra-papel-tijera: el Duende reta y ya tiene su jugada
 * elegida, así que se resuelve en cuanto la persona elige. Con `matchId`, la persona va con `eleccion` y el Duende con
 * lo contrario; se resuelve con la liquidación, como cualquier reto a un partido.
 * `messageId`: el mensaje de la propuesta, que pasa a ser el del reto. Con él, un doble clic no crea dos retos.
 */
function crearContraDuende({ userId, cantidad, matchId = null, eleccion = null, guildId = null, channelId = null, messageId = null }) {
    const motivo = motivoNoContraDuende(userId, cantidad, { matchId, eleccion });
    if (motivo) return error(`❌ ${motivo}`);
    const partido = Boolean(matchId);
    try {
        const reto = db.transaction(() => {
            if (messageId && db.prepare("SELECT 1 FROM retos WHERE messageId = ?").get(messageId)) return null;
            const { reto: nuevo } = insertar({
                tipo: partido ? "partido" : "duelo",
                estado: "en_juego",
                creador: partido ? userId : DUENDE,
                rival: partido ? DUENDE : userId,
                cantidad,
                guildId,
                channelId,
                ...(partido ? { match_id: matchId, eleccion } : { juego: "ppt" }),
                expira_en: null,
            });
            const entradas = partido
                ? [
                      [userId, "a_favor"],
                      [DUENDE, "en_contra"],
                  ]
                : [
                      [DUENDE, null],
                      [userId, null],
                  ];
            for (const [id, opcion] of entradas) if (!unir(nuevo, id, opcion)) throw new SinEfectivo();
            if (!partido) guardarDatos(nuevo.id, { ronda: 1, jugadas: { [DUENDE]: jugadaAlAzar() }, empates: [] });
            if (messageId) guardarMensaje(nuevo.id, channelId, messageId);
            return obtener(nuevo.id);
        })();
        return reto ? { ok: true, reto } : error("Esta propuesta ya está aceptada.");
    } catch (e) {
        if (e instanceof SinEfectivo) return error(SIN_EFECTIVO);
        throw e;
    }
}

module.exports = {
    validarCantidad,
    MAX_PROVOCACION,
    validarProvocacion,
    crearPartido,
    crearDuelo,
    crearPorra,
    leerOpciones,
    leerCierre,
    motivoNoContraDuende,
    crearContraDuende,
};
