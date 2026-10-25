// 🛡️ Guardia del Duende (#553): el bot se queda en un canal de voz indefinidamente, sin temporizador, hasta que quien la
// puso o un admin la deja. Es una presencia de systems/presencia.js con `guardia` (la misma conexión que /conectar, así
// que /sonidos, /tts y el Duende por voz la reutilizan). Aquí está su registro persistido (tabla `guardia_voz`, migración
// 076), para volver a entrar al canal tras un reinicio, y quién puede quitarla.
const db = require("../core/db");
const presencia = require("./presencia");
const { createLogger } = require("../core/logger");

const log = createLogger("Guardia");

// Al apagar el bot se cierran las conexiones de voz: eso no termina la guardia, que tiene que volver al arrancar.
let apagandoBot = false;

const registro = (guildId) => db.prepare("SELECT * FROM guardia_voz WHERE guildId = ?").get(String(guildId)) || null;
const registros = () => db.prepare("SELECT * FROM guardia_voz ORDER BY creada_en").all();
const borrarRegistro = (guildId) => db.prepare("DELETE FROM guardia_voz WHERE guildId = ?").run(String(guildId));
function guardarRegistro(guildId, canalId, porUserId, desde) {
    db.prepare("INSERT OR REPLACE INTO guardia_voz (guildId, canalId, porUserId, creada_en) VALUES (?, ?, ?, ?)").run(
        String(guildId),
        String(canalId),
        String(porUserId),
        desde,
    );
}

/** La guardia activa de un servidor ({ canalId, canalNombre, porUserId, desde }), o null si no la hay. */
function actual(guildId) {
    const p = presencia.actual(guildId);
    if (!p?.guardia) return null;
    return { canalId: p.canalId, canalNombre: p.canalNombre, porUserId: p.guardia.porUserId, desde: p.guardia.desde };
}

/** ¿Puede esta persona mover o quitar la guardia? Quien la puso o un admin. Sin guardia, cualquiera puede ponerla. */
function puedeGestionar(guildId, userId, esAdmin) {
    const g = actual(guildId);
    return !g || esAdmin || g.porUserId === String(userId);
}

/**
 * Pone la guardia en `canal` (sustituye a la presencia de /conectar o a la guardia que hubiera). Quién puede hacerlo lo
 * decide quien llama (puedeGestionar). `desde`: al recuperarla tras un reinicio, la fecha original.
 * @returns {Promise<{ ok: boolean, motivo?: string, canal?: string }>}
 */
async function poner(canal, { porUserId, desde = Date.now(), deps = {} }) {
    const guildId = canal.guild.id;
    const r = await presencia.conectar(canal, {
        guardia: { porUserId, desde },
        // Si la conexión se cae (me echan, se destruye), la guardia se acaba y su registro también; al apagar, no.
        alTerminar: () => {
            if (!apagandoBot) borrarRegistro(guildId);
        },
        deps,
    });
    if (!r.ok) return r;
    guardarRegistro(guildId, canal.id, porUserId, desde);
    log.info(`Guardia en ${canal.name} (${guildId}), puesta por ${porUserId}`);
    return { ok: true, canal: r.canal };
}

/** Deja la guardia: sale del canal y borra el registro. @returns {boolean} si había una guardia */
function dejar(guildId, porUserId) {
    if (!actual(guildId)) return false;
    presencia.desconectar(guildId);
    borrarRegistro(guildId);
    log.info(`Guardia dejada en ${guildId} por ${porUserId}`);
    return true;
}

// El canal de voz de un registro, o null si el servidor o el canal ya no existen (o ya no es de voz).
async function canalDe(client, fila) {
    const guild = client.guilds.cache.get(fila.guildId);
    if (!guild) return null;
    const canal = guild.channels.cache.get(fila.canalId) ?? (await guild.channels.fetch(fila.canalId).catch(() => null));
    if (!canal || canal.isVoiceBased?.() === false) return null;
    return canal;
}

/**
 * Al arrancar, vuelve a cada canal de guardia guardado. Si el canal ya no existe, faltan permisos o no se puede entrar,
 * se descarta el registro y queda en el log. @returns {Promise<{ recuperadas: number, descartadas: number }>}
 */
async function recuperarAlArrancar(client, { deps = {} } = {}) {
    let recuperadas = 0;
    let descartadas = 0;
    for (const fila of registros()) {
        const canal = await canalDe(client, fila);
        const r = canal
            ? await poner(canal, { porUserId: fila.porUserId, desde: fila.creada_en, deps })
            : { ok: false, motivo: "el canal ya no existe" };
        if (r.ok) {
            recuperadas++;
            continue;
        }
        descartadas++;
        borrarRegistro(fila.guildId);
        log.warn(`Descarto la guardia del canal ${fila.canalId} (${fila.guildId}): ${r.motivo}`);
    }
    if (recuperadas || descartadas) log.info(`Guardias al arrancar: ${recuperadas} recuperadas, ${descartadas} descartadas`);
    return { recuperadas, descartadas };
}

/** Se llama al apagar el bot, antes de cerrar Discord: las guardias siguen guardadas para el siguiente arranque. */
function apagando(valor = true) {
    apagandoBot = valor;
}

module.exports = { actual, puedeGestionar, poner, dejar, recuperarAlArrancar, apagando, registro };
