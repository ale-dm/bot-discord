// 🔊 Panel de sonidos (/sonidos): los sonidos del servidor (un admin los sube, cualquiera los reproduce). Pulsar un botón
// hace que el bot entre al canal de voz de quien lo pulsa, toque el sonido y se salga. Un solo sonido a la vez por servidor,
// y no se toca una conversación de voz que ya esté en marcha.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    entersState,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection,
} = require("@discordjs/voice");
const db = require("../core/db");
const { DATA_DIR } = require("../core/paths");
const { createLogger } = require("../core/logger");

const log = createLogger("Sonidos");
const MAX_SONIDOS = 40;
const MAX_BYTES = 1024 * 1024;
const NOMBRE_MAX = 32;
const EXTENSIONES = [".mp3", ".ogg", ".wav"];
const TIEMPO_MAX_MS = 30 * 1000;

const carpetaRaiz = () => process.env.SONIDOS_DIR || path.join(DATA_DIR, "sonidos");
const carpetaDe = (guildId) => path.join(carpetaRaiz(), String(guildId));

/** El nombre limpio (sin espacios de más), o un motivo si no sirve. */
function validarNombre(texto) {
    const t = String(texto ?? "")
        .trim()
        .replace(/\s+/g, " ");
    if (!t) return { ok: false, motivo: "El nombre no puede estar vacío." };
    if (t.length > NOMBRE_MAX) return { ok: false, motivo: `El nombre puede tener como mucho ${NOMBRE_MAX} caracteres.` };
    return { ok: true, nombre: t };
}

/** Los sonidos de un servidor, por nombre. */
function listar(guildId) {
    return db.prepare("SELECT id, nombre, archivo FROM sonidos WHERE guildId = ? ORDER BY nombre COLLATE NOCASE").all(String(guildId));
}

const obtener = (guildId, id) => db.prepare("SELECT * FROM sonidos WHERE guildId = ? AND id = ?").get(String(guildId), Number(id)) || null;
const rutaDe = (sonido) => path.join(carpetaDe(sonido.guildId), sonido.archivo);

/**
 * Guarda un sonido nuevo: valida el nombre, el formato, el tamaño y el número de sonidos, y descarga el fichero.
 * @param {{ nombreArchivo: string, url: string, tamano?: number, fetchFn?: Function }} archivo
 * @returns {Promise<{ ok: boolean, motivo?: string, sonido?: object }>}
 */
async function guardar(guildId, { nombre, archivo, userId }) {
    const n = validarNombre(nombre);
    if (!n.ok) return n;
    const ext = path.extname(archivo.nombreArchivo || "").toLowerCase();
    if (!EXTENSIONES.includes(ext)) return { ok: false, motivo: `Formato no válido. Vale ${EXTENSIONES.join(", ")}.` };
    if (Number(archivo.tamano || 0) > MAX_BYTES) return { ok: false, motivo: "El archivo pasa de 1 MB." };
    if (db.prepare("SELECT COUNT(*) AS n FROM sonidos WHERE guildId = ?").get(String(guildId)).n >= MAX_SONIDOS) {
        return { ok: false, motivo: `Ya hay ${MAX_SONIDOS} sonidos en el servidor: borra alguno antes.` };
    }
    if (db.prepare("SELECT 1 FROM sonidos WHERE guildId = ? AND nombre = ? COLLATE NOCASE").get(String(guildId), n.nombre)) {
        return { ok: false, motivo: `Ya hay un sonido que se llama «${n.nombre}».` };
    }

    const descarga = await (archivo.fetchFn || fetch)(archivo.url);
    if (!descarga.ok) return { ok: false, motivo: `No pude descargar el archivo (${descarga.status}).` };
    const datos = Buffer.from(await descarga.arrayBuffer());
    if (datos.length > MAX_BYTES) return { ok: false, motivo: "El archivo pasa de 1 MB." };

    const { lastInsertRowid } = db
        .prepare("INSERT INTO sonidos (guildId, nombre, archivo, creado_por, creado_en) VALUES (?, ?, ?, ?, ?)")
        .run(String(guildId), n.nombre, "pendiente", String(userId), Date.now());
    const nombreFichero = `${lastInsertRowid}${ext}`;
    try {
        fs.mkdirSync(carpetaDe(guildId), { recursive: true });
        fs.writeFileSync(path.join(carpetaDe(guildId), nombreFichero), datos);
    } catch (e) {
        db.prepare("DELETE FROM sonidos WHERE id = ?").run(lastInsertRowid);
        log.warn(`No se pudo guardar el sonido ${n.nombre}: ${e.message}`);
        return { ok: false, motivo: "No pude guardar el archivo." };
    }
    db.prepare("UPDATE sonidos SET archivo = ? WHERE id = ?").run(nombreFichero, lastInsertRowid);
    log.info(`Sonido «${n.nombre}» añadido en ${guildId} por ${userId}`);
    return { ok: true, sonido: obtener(guildId, lastInsertRowid) };
}

/** Borra un sonido (la fila y el fichero). */
function borrar(guildId, id) {
    const sonido = obtener(guildId, id);
    if (!sonido) return false;
    db.prepare("DELETE FROM sonidos WHERE id = ?").run(sonido.id);
    try {
        fs.rmSync(rutaDe(sonido), { force: true });
    } catch (e) {
        log.warn(`No se pudo borrar el fichero de ${sonido.nombre}: ${e.message}`);
    }
    return true;
}

function borrarPorNombre(guildId, nombre) {
    const fila = db
        .prepare("SELECT id FROM sonidos WHERE guildId = ? AND nombre = ? COLLATE NOCASE")
        .get(String(guildId), String(nombre).trim());
    return fila ? borrar(guildId, fila.id) : false;
}

const ocupados = new Set(); // servidores con un sonido sonando

/**
 * Entra al canal, toca el sonido y se sale. `deps` es para los tests (unirse, esperar, crear el reproductor y el recurso).
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
async function reproducir(voiceChannel, sonido, deps = {}) {
    const guildId = voiceChannel.guild.id;
    if (ocupados.has(guildId)) return { ok: false, motivo: "Ya está sonando otro sonido en el servidor. Espera a que acabe." };
    const enConversacion = deps.getConnection ? deps.getConnection(guildId) : getVoiceConnection(guildId);
    if (enConversacion) return { ok: false, motivo: "Estoy en otra conversación de voz en este servidor." };
    const permisos = voiceChannel.permissionsFor(voiceChannel.guild.members.me);
    if (!permisos || !permisos.has("Connect") || !permisos.has("Speak")) {
        return { ok: false, motivo: "Me faltan permisos para entrar a ese canal o hablar en él." };
    }

    ocupados.add(guildId);
    let conexion = null;
    try {
        conexion = (deps.unirse || joinVoiceChannel)({
            channelId: voiceChannel.id,
            guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
        });
        await (deps.esperarListo || ((c) => entersState(c, VoiceConnectionStatus.Ready, 10 * 1000)))(conexion);
        const reproductor = (deps.crearReproductor || createAudioPlayer)();
        const acabado = new Promise((resolve, reject) => {
            const tope = setTimeout(resolve, TIEMPO_MAX_MS);
            reproductor.once(AudioPlayerStatus.Idle, () => {
                clearTimeout(tope);
                resolve();
            });
            reproductor.on("error", (e) => {
                clearTimeout(tope);
                reject(e);
            });
        });
        conexion.subscribe(reproductor);
        reproductor.play((deps.crearRecurso || createAudioResource)(rutaDe(sonido)));
        await acabado;
        return { ok: true };
    } catch (e) {
        log.warn(`No se pudo reproducir «${sonido.nombre}» en ${guildId}: ${e.message}`);
        return { ok: false, motivo: "No pude reproducirlo. Vuelve a intentarlo." };
    } finally {
        try {
            conexion?.destroy();
        } catch {
            /* ya estaba cerrada */
        }
        ocupados.delete(guildId);
    }
}

/** Un reproductor de mentira para los tests (emite "idle" cuando se le pide tocar). */
class ReproductorFalso extends EventEmitter {
    play() {
        setImmediate(() => this.emit(AudioPlayerStatus.Idle));
    }
}

module.exports = {
    MAX_SONIDOS,
    MAX_BYTES,
    EXTENSIONES,
    NOMBRE_MAX,
    validarNombre,
    listar,
    obtener,
    rutaDe,
    guardar,
    borrar,
    borrarPorNombre,
    reproducir,
    ReproductorFalso,
};
