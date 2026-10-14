// Copias de seguridad de la BD (economía, XP, logros, apuestas...).
//
// Usa la API de backup de SQLite (better-sqlite3 `db.backup`): copia consistente con el bot en
// marcha, sin pararlo ni bloquear escrituras. Se guardan en data/backups/ como
// banco-AAAA-MM-DD.db y se conservan las últimas BACKUP_KEEP (7 por defecto).
// Se programa a diario en index.js; también a mano con `npm run db:backup`.
//
// data/backups está en el mismo disco que la BD: protege de corrupciones o de un borrado por
// error, no de que se estropee el disco. Para eso, copiar data/backups a otro sitio (ver
// docs/planificacion/DEUDA_TECNICA.md).
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../core/paths");
const { createLogger } = require("../core/logger");
const { momentoMadrid } = require("../core/zonaMadrid");
const alertas = require("./alertas");

const log = createLogger("Backups");

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 7));
const PATRON = /^banco-(\d{4}-\d{2}-\d{2})\.db$/;

function fechaLocal(d = new Date()) {
    // Fecha de Madrid (la misma zona que el cron), no UTC: la copia de las 04:30 es "de hoy".
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function listarBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => PATRON.test(f))
        .sort()
        .map((f) => ({ fichero: f, ruta: path.join(BACKUP_DIR, f), bytes: fs.statSync(path.join(BACKUP_DIR, f)).size }));
}

/** ¿Existe ya la copia de hoy (fecha de Madrid)? (#417, #419) */
function hayCopiaDeHoy() {
    const hoy = `banco-${fechaLocal()}.db`;
    return listarBackups().some((b) => b.fichero === hoy);
}

/** ¿Toca hacer la copia al arrancar? Pasadas las 04:30 (Madrid) y sin la de hoy; antes de esa hora la hará el cron (#419). */
function faltaCopiaAlArrancar(ahora = Date.now()) {
    const m = momentoMadrid(ahora);
    return (m.hora > 4 || (m.hora === 4 && m.minuto >= 30)) && !hayCopiaDeHoy();
}

/**
 * Abre la copia en solo lectura y le pasa `PRAGMA integrity_check` (el completo: la BD es pequeña y se hace una vez al día).
 * @returns {string|null} null si está sana; si no, el motivo (#418)
 */
function problemaDeIntegridad(ruta) {
    const Database = require("better-sqlite3");
    let copia;
    try {
        copia = new Database(ruta, { readonly: true, fileMustExist: true });
        const filas = copia.pragma("integrity_check");
        const resultado = filas.map((f) => f.integrity_check);
        return resultado.length === 1 && resultado[0] === "ok" ? null : resultado.slice(0, 3).join(" | ");
    } catch (e) {
        return e.message;
    } finally {
        copia?.close();
    }
}

function rotar() {
    const todos = listarBackups();
    const sobran = todos.slice(0, Math.max(0, todos.length - BACKUP_KEEP));
    for (const b of sobran) {
        try {
            fs.unlinkSync(b.ruta);
        } catch (e) {
            log.warn(`No se pudo borrar la copia antigua ${b.fichero}: ${e.message}`);
        }
    }
    return sobran.length;
}

/**
 * Hace la copia del día (si ya existe, la sustituye) y borra las que sobran. Antes de darla por buena la comprueba (#418):
 * si está dañada se descarta, se avisa por DM (una vez al día) y no se rota nada, así no se pierden las sanas.
 * @param {import("better-sqlite3").Database} [database] - por defecto la BD del bot
 * @returns {Promise<{ fichero: string, bytes: number, ms: number, borradas: number, integra: boolean, motivo?: string }>}
 */
async function hacerBackup(database = require("../core/db")) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const fichero = `banco-${fechaLocal()}.db`;
    const destino = path.join(BACKUP_DIR, fichero);
    const tmp = destino + ".tmp";
    const t0 = Date.now();
    try {
        await database.backup(tmp);
        const motivo = problemaDeIntegridad(tmp);
        if (motivo) {
            fs.unlinkSync(tmp);
            return avisarCopiaDanada(fichero, motivo, Date.now() - t0);
        }
        fs.renameSync(tmp, destino);
    } catch (e) {
        try {
            fs.unlinkSync(tmp);
        } catch (errBorrado) {
            log.debug(`No se pudo borrar el temporal de la copia: ${errBorrado.message}`);
        }
        log.error(`La copia de seguridad ${fichero} falló:`, e);
        throw e;
    }
    const bytes = fs.statSync(destino).size;
    const borradas = rotar();
    const ms = Date.now() - t0;
    log.info(
        `Copia ${fichero} hecha (${(bytes / 1024).toFixed(0)} KB, ${ms} ms)${borradas ? ` · ${borradas} antiguas borradas` : ""} · se conservan ${Math.min(BACKUP_KEEP, listarBackups().length)}`,
    );
    return { fichero, bytes, ms, borradas, integra: true };
}

// Copia descartada: no es un error del código (no pasa por el logger de errores) pero sí hay que enterarse: alerta por DM
// con la clave `backup:integridad` y como mucho una al día.
async function avisarCopiaDanada(fichero, motivo, ms) {
    log.warn(`La copia ${fichero} no pasó la comprobación de integridad y se ha descartado: ${motivo}`);
    await alertas.alertar({
        clave: `backup:integridad:${fechaLocal()}`,
        titulo: "💾 La copia de seguridad ha fallado",
        detalle: `La copia de hoy (${fichero}) no pasó la comprobación de integridad y se ha descartado. Las anteriores se conservan.

${String(motivo).slice(0, 500)}`,
        cooldownMs: 24 * 60 * 60 * 1000,
    });
    return { fichero, bytes: 0, ms, borradas: 0, integra: false, motivo };
}

module.exports = { hacerBackup, listarBackups, hayCopiaDeHoy, faltaCopiaAlArrancar, fechaLocal, BACKUP_DIR, BACKUP_KEEP };
