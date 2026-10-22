// 🎁 Sorteos programados (F-AD-08, #541): creación, participantes, cancelación y cierre con ganadores.
// El premio es dinero (se reparte) o un objeto del catálogo (si es único, un solo ganador). Los requisitos
// (rol y nivel) se comprueban al entrar y otra vez al cerrar, con la lista de elegibles que pasa el aviso.
const db = require("../core/db");
const dinero = require("./dinero");
const { createLogger } = require("../core/logger");

const log = createLogger("Sorteos");
const MAX_GANADORES = 5;
const MAX_HORAS = 24 * 7;
const ESTADOS = ["activo", "cerrado", "cancelado"];

function porId(id) {
    return db.prepare("SELECT * FROM sorteos WHERE id = ?").get(Number(id)) || null;
}

function activos(guildId = null) {
    const sql = `SELECT * FROM sorteos WHERE estado = 'activo' ${guildId ? "AND guildId = ?" : ""} ORDER BY fin`;
    return guildId ? db.prepare(sql).all(String(guildId)) : db.prepare(sql).all();
}

function pendientes(ahora = Date.now()) {
    return db.prepare("SELECT * FROM sorteos WHERE estado = 'activo' AND fin <= ? ORDER BY fin").all(ahora);
}

function participantes(sorteoId) {
    return db.prepare("SELECT userId, fecha FROM sorteos_participantes WHERE sorteoId = ? ORDER BY fecha").all(Number(sorteoId));
}

const cuentaParticipantes = (sorteoId) =>
    db.prepare("SELECT COUNT(*) AS n FROM sorteos_participantes WHERE sorteoId = ?").get(Number(sorteoId)).n;

const ganadoresDe = (sorteoId) => db.prepare("SELECT userId, cantidad FROM sorteos_ganadores WHERE sorteoId = ?").all(Number(sorteoId));

function objetoPorNombre(nombre) {
    return db.prepare("SELECT id, nombre, unico FROM objeto WHERE lower(nombre) = lower(?)").get(String(nombre || "").trim()) || null;
}

const objetoPorId = (id) => db.prepare("SELECT id, nombre, unico FROM objeto WHERE id = ?").get(Number(id)) || null;

const tieneObjeto = (userId, itemId) =>
    !!db.prepare("SELECT 1 FROM inventario WHERE userId = ? AND itemId = ?").get(String(userId), Number(itemId));

/**
 * Crea un sorteo. `premioValor`: monedas (entero) o el id del objeto. `horas`: duración (1 a 168).
 * @returns {{ok:true, sorteo:object} | {ok:false, motivo:string}}
 */
function crear({
    guildId,
    channelId,
    premioTipo,
    premioValor,
    premioNombre,
    ganadores = 1,
    rolId = "",
    nivel = 0,
    horas = 24,
    creadorId,
    ahora = Date.now(),
}) {
    if (!guildId || !channelId) return { ok: false, motivo: "Falta el servidor o el canal." };
    if (!["dinero", "objeto"].includes(premioTipo)) return { ok: false, motivo: "El premio tiene que ser dinero u objeto." };
    if (!Number.isInteger(horas) || horas < 1 || horas > MAX_HORAS)
        return { ok: false, motivo: `La duración va de 1 a ${MAX_HORAS} horas.` };
    if (!Number.isInteger(ganadores) || ganadores < 1 || ganadores > MAX_GANADORES)
        return { ok: false, motivo: `Los ganadores van de 1 a ${MAX_GANADORES}.` };
    if (!Number.isInteger(nivel) || nivel < 0 || nivel > 1000) return { ok: false, motivo: "El nivel mínimo no es válido." };
    if (premioTipo === "dinero") {
        const valor = Number(premioValor);
        if (!Number.isInteger(valor) || valor < ganadores)
            return { ok: false, motivo: "El premio tiene que ser entero y llegar para todos los ganadores." };
    } else {
        const obj = objetoPorId(premioValor);
        if (!obj) return { ok: false, motivo: "Ese objeto no existe en el catálogo." };
        if (obj.unico && ganadores !== 1) return { ok: false, motivo: "Un objeto único solo puede tener un ganador." };
        premioNombre = obj.nombre;
    }
    const inicio = ahora;
    const fin = ahora + horas * 60 * 60 * 1000;
    const info = db
        .prepare(
            `INSERT INTO sorteos (guildId, channelId, premioTipo, premioValor, premioNombre, ganadores, rolId, nivel, inicio, fin, creadorId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            String(guildId),
            String(channelId),
            premioTipo,
            String(premioValor),
            String(premioNombre),
            ganadores,
            String(rolId || ""),
            nivel,
            inicio,
            fin,
            String(creadorId || ""),
        );
    log.info(`${creadorId} creó el sorteo #${info.lastInsertRowid} en ${guildId} (ganadores: ${ganadores})`);
    return { ok: true, sorteo: porId(info.lastInsertRowid) };
}

const guardarMensaje = (id, messageId) => db.prepare("UPDATE sorteos SET messageId = ? WHERE id = ?").run(String(messageId), Number(id));

/**
 * Entra o sale de un sorteo activo. @returns {{ok:true, dentro:boolean} | {ok:false, motivo:string}}
 */
function participar(id, userId, ahora = Date.now()) {
    const s = porId(id);
    if (!s || s.estado !== "activo" || s.fin <= ahora) return { ok: false, motivo: "Este sorteo ya ha terminado." };
    const dentro = db.prepare("SELECT 1 FROM sorteos_participantes WHERE sorteoId = ? AND userId = ?").get(s.id, String(userId));
    if (dentro) {
        db.prepare("DELETE FROM sorteos_participantes WHERE sorteoId = ? AND userId = ?").run(s.id, String(userId));
        return { ok: true, dentro: false };
    }
    db.prepare("INSERT INTO sorteos_participantes (sorteoId, userId, fecha) VALUES (?, ?, ?)").run(s.id, String(userId), ahora);
    return { ok: true, dentro: true };
}

/** Cancela un sorteo activo. Devuelve la fila cancelada, o null si ya no estaba activo. */
function cancelar(id, ahora = Date.now()) {
    const r = db.prepare("UPDATE sorteos SET estado = 'cancelado' WHERE id = ? AND estado = 'activo'").run(Number(id));
    if (r.changes !== 1) return null;
    log.info(`Sorteo #${id} cancelado`);
    return porId(id);
}

/** Elige `n` ganadores al azar de `elegibles` (sin repetir). */
function elegirGanadores(elegibles, n, rng = Math.random) {
    const copia = [...elegibles];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia.slice(0, Math.max(0, n));
}

/**
 * Cierra el sorteo: elige ganadores entre `elegibles`, reparte el premio y marca cerrado. Idempotente: si ya
 * no estaba activo, devuelve null y no paga dos veces.
 * @returns {null | {sorteo:object, ganadores:Array<{userId:string, cantidad:number}>, premioNombre:string, premioTipo:string}}
 */
function cerrar(id, elegibles = [], ahora = Date.now()) {
    const s = porId(id);
    if (!s || s.estado !== "activo") return null;
    const cupo = s.premioTipo === "objeto" ? (objetoPorId(s.premioValor)?.unico ? 1 : s.ganadores) : s.ganadores;
    const elegidos = elegirGanadores(elegibles, cupo);
    const ganadores = [];
    const ok = db.transaction(() => {
        const r = db.prepare("UPDATE sorteos SET estado = 'cerrado' WHERE id = ? AND estado = 'activo'").run(s.id);
        if (r.changes !== 1) return false;
        if (s.premioTipo === "dinero") {
            const total = Number(s.premioValor);
            const base = Math.floor(total / cupo);
            const resto = total % cupo;
            elegidos.forEach((userId, i) => {
                const cantidad = base + (i < resto ? 1 : 0);
                if (cantidad > 0) dinero.pagarSinImpuesto(userId, "premio", `Sorteo #${s.id}: ${s.premioNombre}`, cantidad);
                db.prepare("INSERT OR REPLACE INTO sorteos_ganadores (sorteoId, userId, cantidad) VALUES (?, ?, ?)").run(
                    s.id,
                    userId,
                    cantidad,
                );
                ganadores.push({ userId, cantidad });
            });
        } else {
            const obj = objetoPorId(s.premioValor);
            for (const userId of elegidos) {
                if (obj?.unico && tieneObjeto(userId, obj.id)) continue;
                db.prepare("INSERT INTO inventario (userId, itemId, fecha) VALUES (?, ?, ?)").run(
                    String(userId),
                    Number(s.premioValor),
                    new Date(ahora).toISOString(),
                );
                db.prepare("INSERT OR REPLACE INTO sorteos_ganadores (sorteoId, userId, cantidad) VALUES (?, ?, 0)").run(s.id, userId);
                ganadores.push({ userId, cantidad: 0 });
            }
        }
        return true;
    })();
    if (!ok) return null;
    log.info(`Sorteo #${id} cerrado con ${ganadores.length} ganador(es)`);
    return { sorteo: { ...s, estado: "cerrado" }, ganadores, premioNombre: s.premioNombre, premioTipo: s.premioTipo };
}

module.exports = {
    MAX_GANADORES,
    MAX_HORAS,
    ESTADOS,
    porId,
    activos,
    pendientes,
    participantes,
    cuentaParticipantes,
    ganadoresDe,
    objetoPorNombre,
    objetoPorId,
    tieneObjeto,
    crear,
    guardarMensaje,
    participar,
    cancelar,
    elegirGanadores,
    cerrar,
};
