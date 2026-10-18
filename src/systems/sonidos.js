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
const guildSettings = require("./guildSettings");
const ajustes = require("./sonidos/ajustes");
const cola = require("./sonidos/cola");
const { silencioAhora, avisoSilencio } = require("./sonidos/silencio");

const log = createLogger("Sonidos");
const MAX_SONIDOS = 40;
const MAX_BYTES = 1024 * 1024;
const NOMBRE_MAX = 32;
const EXTENSIONES = [".mp3", ".ogg", ".wav"];
// Un archivo de 1 MB suena como mucho un par de minutos; el tope solo está por si el reproductor se atasca.
const TIEMPO_MAX_MS = 4 * 60 * 1000;

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

const COLUMNAS = "id, guildId, nombre, archivo, categoria, volumen, reproducciones, creado_por, creado_en";
const minusculas = (t) => String(t ?? "").toLocaleLowerCase("es");

/**
 * Los sonidos de un servidor, por nombre. `categoria` deja solo los de esa categoría (SIN_CATEGORIA = los que no tienen) y
 * `texto`, los que lo contienen en el nombre (#323, #325), sin distinguir mayúsculas.
 */
function listar(guildId, { categoria = null, texto = "" } = {}) {
    let lista = db.prepare(`SELECT ${COLUMNAS} FROM sonidos WHERE guildId = ? ORDER BY nombre COLLATE NOCASE`).all(String(guildId));
    if (categoria === ajustes.SIN_CATEGORIA) lista = lista.filter((s) => !s.categoria);
    else if (categoria) lista = lista.filter((s) => s.categoria === categoria);
    const buscado = minusculas(texto).trim();
    return buscado ? lista.filter((s) => minusculas(s.nombre).includes(buscado)) : lista;
}

const obtener = (guildId, id) =>
    db.prepare(`SELECT ${COLUMNAS} FROM sonidos WHERE guildId = ? AND id = ?`).get(String(guildId), Number(id)) || null;
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

    const descargado = await descargar(archivo);
    if (!descargado.ok) return descargado;
    const datos = descargado.datos;

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

// Tiempo máximo para descargar un adjunto (#469): antes de que caduque el token de la interacción (15 min).
const TIEMPO_DESCARGA_MS = 15 * 1000;

/**
 * Descarga el archivo subido, con tiempo límite y mirando el tamaño anunciado antes de leer el cuerpo.
 * Devuelve { ok, datos } o { ok: false, motivo }.
 */
async function descargar(archivo) {
    const senal = AbortSignal.timeout(archivo.tiempoMs || TIEMPO_DESCARGA_MS);
    try {
        const descarga = await (archivo.fetchFn || fetch)(archivo.url, { signal: senal });
        if (!descarga.ok) return { ok: false, motivo: `No pude descargar el archivo (${descarga.status}).` };
        if (Number(descarga.headers?.get?.("content-length") || 0) > MAX_BYTES) return { ok: false, motivo: "El archivo pasa de 1 MB." };
        const datos = Buffer.from(await descarga.arrayBuffer());
        if (datos.length > MAX_BYTES) return { ok: false, motivo: "El archivo pasa de 1 MB." };
        return { ok: true, datos };
    } catch (e) {
        if (e.name === "TimeoutError" || e.name === "AbortError") {
            return { ok: false, motivo: "No pude descargar el archivo (tiempo agotado)." };
        }
        return { ok: false, motivo: "No pude descargar el archivo." };
    }
}

/** Cambia el nombre de un sonido, con las mismas reglas que al subirlo (sin repetir el de otro sonido del servidor). */
function renombrar(guildId, id, nombre) {
    const n = validarNombre(nombre);
    if (!n.ok) return n;
    const sonido = obtener(guildId, id);
    if (!sonido) return { ok: false, motivo: "Ese sonido ya no existe." };
    if (
        db
            .prepare("SELECT 1 FROM sonidos WHERE guildId = ? AND nombre = ? COLLATE NOCASE AND id != ?")
            .get(String(guildId), n.nombre, sonido.id)
    ) {
        return { ok: false, motivo: `Ya hay un sonido que se llama «${n.nombre}».` };
    }
    db.prepare("UPDATE sonidos SET nombre = ? WHERE id = ?").run(n.nombre, sonido.id);
    log.info(`Sonido «${sonido.nombre}» renombrado a «${n.nombre}» en ${guildId}`);
    return { ok: true, sonido: obtener(guildId, sonido.id) };
}

/**
 * Sustituye el archivo de un sonido, manteniendo su id y su nombre. Si cambia la extensión, borra el fichero anterior.
 * El servidor queda reservado desde antes de descargar hasta después de escribir (#468): ningún sonido puede empezar
 * en medio, y no se cambia un fichero que está sonando.
 */
async function reemplazarArchivo(guildId, id, archivo) {
    const sonido = obtener(guildId, id);
    if (!sonido) return { ok: false, motivo: "Ese sonido ya no existe." };
    const gid = String(guildId);
    if (ocupados.has(gid)) return { ok: false, motivo: "Ahora mismo suena un sonido en el servidor. Prueba en un momento." };
    const ext = path.extname(archivo.nombreArchivo || "").toLowerCase();
    if (!EXTENSIONES.includes(ext)) return { ok: false, motivo: `Formato no válido. Vale ${EXTENSIONES.join(", ")}.` };
    if (Number(archivo.tamano || 0) > MAX_BYTES) return { ok: false, motivo: "El archivo pasa de 1 MB." };

    // Desde aquí no hay más await hasta reservar: la comprobación de arriba sigue valiendo.
    ocupados.add(gid);
    try {
        const descargado = await descargar(archivo);
        if (!descargado.ok) return descargado;

        const nombreFichero = `${sonido.id}${ext}`;
        try {
            fs.mkdirSync(carpetaDe(guildId), { recursive: true });
            fs.writeFileSync(path.join(carpetaDe(guildId), nombreFichero), descargado.datos);
        } catch (e) {
            log.warn(`No se pudo cambiar el archivo de ${sonido.nombre}: ${e.message}`);
            return { ok: false, motivo: "No pude guardar el archivo." };
        }
        db.prepare("UPDATE sonidos SET archivo = ? WHERE id = ?").run(nombreFichero, sonido.id);
        if (sonido.archivo !== nombreFichero) fs.rmSync(rutaDe(sonido), { force: true });
        log.info(`Archivo de «${sonido.nombre}» cambiado en ${guildId}`);
        return { ok: true, sonido: obtener(guildId, sonido.id) };
    } finally {
        liberar(gid);
    }
}

/** Borra un sonido (la fila y el fichero). */
function borrar(guildId, id) {
    const sonido = obtener(guildId, id);
    if (!sonido) return false;
    db.transaction(() => {
        db.prepare("DELETE FROM sonidos WHERE id = ?").run(sonido.id);
        db.prepare("DELETE FROM sonido_roles WHERE sonidoId = ?").run(sonido.id);
        db.prepare("DELETE FROM sonidos_eventos WHERE sonidoId = ?").run(sonido.id);
    })();
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
const presencia = require("./presencia");
const ocupacion = require("./ocupacion");

/**
 * Toca el sonido en una conexión que ya existe (no se sale de ella al acabar). Termina cuando acaba el sonido, o cuando
 * Discord cierra la conexión a mitad. Al terminar, se quita la suscripción y se para el reproductor, para no dejar nada
 * sonando ni colgado. `deps.alEmpezar` se llama en cuanto el sonido empieza a sonar de verdad.
 */
function tocarEn(conexion, sonido, deps) {
    // El recurso va primero: si el archivo no vale, falla antes de crear el reproductor y los temporizadores.
    const recurso = (deps.crearRecurso || createAudioResource)(rutaDe(sonido), { inlineVolume: true });
    recurso.volume?.setVolume((sonido.volumen ?? 100) / 100);
    const reproductor = (deps.crearReproductor || createAudioPlayer)();
    let limpiar = () => {};
    const acabado = new Promise((resolve, reject) => {
        const tope = setTimeout(() => {
            reproductor.stop?.(true);
            resolve();
        }, TIEMPO_MAX_MS);
        const fin = () => {
            clearTimeout(tope);
            resolve();
        };
        const alCerrar = () => fin();
        reproductor.once(AudioPlayerStatus.Playing, () => deps.alEmpezar?.());
        reproductor.once(AudioPlayerStatus.Idle, fin);
        reproductor.on("error", (e) => {
            clearTimeout(tope);
            reject(e);
        });
        conexion.once?.(VoiceConnectionStatus.Destroyed, alCerrar);
        limpiar = () => {
            clearTimeout(tope);
            conexion.off?.(VoiceConnectionStatus.Destroyed, alCerrar);
        };
    });
    const suscripcion = conexion.subscribe(reproductor);
    reproductor.play(recurso);
    return acabado.finally(() => {
        limpiar();
        suscripcion?.unsubscribe?.();
        reproductor.stop?.(true);
    });
}

/** ¿Suena ahora mismo un sonido en el servidor? (lo mira /conectar para no cortarlo). */
function sonando(guildId) {
    return ocupados.has(String(guildId));
}
ocupacion.registrar("sonidos", sonando, ocupacion.REINTENTO_CORTO_MS);

/** El motivo por el que no se puede tocar ahora en el canal (o con la presencia), o null si se puede. `presente`: la presencia de /conectar. */
function motivoNoSePuede(id, canal, presente, deps) {
    if (presente) return null;
    if (!canal) return "Entra en un canal de voz, o pide al bot que se quede con /conectar.";
    if (deps.getConnection ? deps.getConnection(id) : getVoiceConnection(id)) return "Estoy en otra conversación de voz en este servidor.";
    const permisos = canal.permissionsFor(canal.guild.members.me);
    if (!permisos || !permisos.has("Connect") || !permisos.has("Speak"))
        return "Me faltan permisos para entrar a ese canal o hablar en él.";
    return null;
}

/** Toca el sonido en la presencia de /conectar o, si no la hay, entra al canal de quien lo pide, lo toca y se sale. */
async function tocarSegunPresencia(id, canal, sonido, deps) {
    const presente = deps.presencia !== undefined ? deps.presencia : presencia.actual(id);
    const motivo = motivoNoSePuede(id, canal, presente, deps);
    if (motivo) return { ok: false, motivo };
    let conexion = presente?.conexion ?? null;
    try {
        if (!presente) {
            conexion = (deps.unirse || joinVoiceChannel)({
                channelId: canal.id,
                guildId: id,
                adapterCreator: canal.guild.voiceAdapterCreator,
                selfDeaf: true,
            });
            await (deps.esperarListo || ((c) => entersState(c, VoiceConnectionStatus.Ready, 10 * 1000)))(conexion);
        }
        await tocarEn(conexion, sonido, deps);
        return { ok: true };
    } catch (e) {
        log.warn(`No se pudo reproducir «${sonido.nombre}» en ${id}: ${e.message}`);
        return { ok: false, motivo: "No pude reproducirlo. Vuelve a intentarlo." };
    } finally {
        if (!presente) {
            try {
                conexion?.destroy();
            } catch {
                /* ya estaba cerrada */
            }
        }
    }
}

/** Al acabar un sonido: suena el siguiente de la cola, o se libera el servidor. El servidor sigue «ocupado» entre dos sonidos. */
function liberar(id) {
    const siguiente = cola.siguiente(id);
    if (!siguiente) return void ocupados.delete(id);
    ejecutar(id, siguiente.canal, siguiente.sonido, siguiente.deps).then(siguiente.resolve);
}

/** Toca un sonido con el servidor ya reservado, cuenta la reproducción y pasa al siguiente de la cola. */
async function ejecutar(id, canal, sonido, deps) {
    try {
        const r = await tocarSegunPresencia(id, canal, sonido, deps);
        if (r.ok) ajustes.contar(sonido.id);
        return r;
    } finally {
        liberar(id);
    }
}

/** Un sonido que llega con otro sonando espera su turno (hasta MAX_COLA); `deps.alEncolar(puesto)` avisa de su puesto. */
function esperarTurno(id, canal, sonido, deps) {
    return new Promise((resolve) => {
        const puesto = cola.encolar(id, { canal, sonido, deps, resolve });
        if (puesto === null) return resolve({ ok: false, motivo: `Hay ${cola.MAX_COLA} sonidos esperando: prueba cuando suene alguno.` });
        deps.alEncolar?.(puesto);
    });
}

/** Los ajustes de silencio del servidor, como { apagado, desde, hasta } (`deps.silencio` los sustituye en los tests). */
function silencioDe(id, deps) {
    if (deps.silencio) return deps.silencio;
    const { apagado, silencio_desde: desde, silencio_hasta: hasta } = guildSettings.getSettings(id).sonidos;
    return { apagado, desde, hasta };
}

/**
 * Reproduce un sonido. Si el bot ya está en un canal por /conectar, suena ahí (sin entrar ni salir). Si no, entra al
 * canal de quien lo pide (`canal`), lo toca y se sale. En horario de silencio no suena (#330). Con otro sonido sonando,
 * espera en la cola (#327). `deps` es para los tests.
 * @param {string} guildId
 * @param {object|null} canal el canal de voz de quien pide el sonido, o null
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
async function reproducir(guildId, canal, sonido, deps = {}) {
    const id = String(guildId);
    const silencio = silencioAhora(silencioDe(id, deps), deps.ahora);
    if (silencio.silencio) return { ok: false, motivo: avisoSilencio(silencio) };
    if (deps.sinCola && ocupados.has(id)) return { ok: false, motivo: "Ya está sonando otro sonido en el servidor. Espera a que acabe." };
    const presente = deps.presencia !== undefined ? deps.presencia : presencia.actual(id);
    const motivo = motivoNoSePuede(id, canal, presente, deps);
    if (motivo) return { ok: false, motivo };
    if (ocupados.has(id)) return esperarTurno(id, canal, sonido, deps);
    ocupados.add(id);
    return ejecutar(id, canal, sonido, deps);
}

/** Un reproductor de mentira para los tests (emite "idle" cuando se le pide tocar). */
class ReproductorFalso extends EventEmitter {
    play() {
        setImmediate(() => this.emit(AudioPlayerStatus.Idle));
    }
}

module.exports = {
    MAX_SONIDOS,
    sonando,

    validarNombre,
    listar,
    obtener,
    rutaDe,
    guardar,
    renombrar,
    reemplazarArchivo,
    borrar,
    borrarPorNombre,
    reproducir,
    ReproductorFalso,
};
