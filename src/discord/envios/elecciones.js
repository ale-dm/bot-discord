// 🗳️ Las elecciones en Discord: publicar y repintar el panel, avanzar las fases vencidas (cron cada minuto y al arrancar) y
// lo que pasa en cada cambio: el anuncio en el canal, los programas por DM al empezar las generales, el rol al nuevo presidente
// y, al acabar el mandato, quitarle el rol, borrar sus canales y revertir sus sanciones. Todo es best-effort: si falta un
// permiso o el mensaje ya no existe, se apunta en el log y se sigue.
const { fases, repo, ajustes: reglasAjustes, candidatos } = require("../../systems/elecciones");
const { mensajeEleccion } = require("../../paneles/elecciones/panel");
const { textoAnuncio, dmProgramas } = require("../../paneles/elecciones/anuncios");
const avisosDm = require("../../systems/avisosDm");
const adminAudit = require("../../systems/adminAudit");
const presidencia = require("./presidencia");
const { rolAsignable } = require("../rolesAutoroles");
const { createLogger } = require("../../core/logger");

const log = createLogger("Elecciones");
/** Pausa entre DM de programas, para no pegarse con el límite de Discord. */
const PAUSA_DM_MS = 1000;

const esperar = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function canalDe(client, eleccion) {
    if (!eleccion.channelId) return null;
    return client.channels.fetch(eleccion.channelId).catch(() => null);
}

/** Repinta el panel de la elección en su canal. */
async function repintar(client, eleccion) {
    if (!eleccion.channelId || !eleccion.messageId) return false;
    try {
        const canal = await client.channels.fetch(eleccion.channelId);
        await canal.messages.edit(eleccion.messageId, mensajeEleccion(eleccion));
        return true;
    } catch (e) {
        log.debug(`No se pudo repintar el panel de las elecciones ${eleccion.id}: ${e.message}`);
        return false;
    }
}

/** Publica el panel de la elección en su canal y apunta el mensaje. */
async function publicar(client, eleccion) {
    const canal = await canalDe(client, eleccion);
    if (!canal?.send) return { ok: false, motivo: "No encuentro el canal de las elecciones o no puedo escribir en él." };
    const mensaje = await canal.send(mensajeEleccion(eleccion));
    repo.guardarMensaje(eleccion.id, canal.id, mensaje.id);
    return { ok: true, eleccion: repo.obtener(eleccion.id) };
}

/** Abre unas elecciones en el canal configurado y publica su panel. */
async function abrirYPublicar(client, guildId, porId, ahora = Date.now()) {
    const canal = reglasAjustes.ajustes(guildId).canal;
    if (!canal) return { ok: false, motivo: "Primero elige el canal de las elecciones." };
    const r = fases.abrir({ guildId, creadaPor: porId, channelId: canal, ahora });
    if (!r.ok) return { ok: false, motivo: r.mensaje };
    const p = await publicar(client, r.eleccion).catch((e) => ({ ok: false, motivo: e.message }));
    if (!p.ok) log.warn(`Elecciones ${r.eleccion.id} abiertas sin panel: ${p.motivo}`);
    return { ok: true, eleccion: p.eleccion || r.eleccion, aviso: p.ok ? null : p.motivo };
}

async function anunciar(client, eleccion, texto) {
    if (!texto) return;
    const canal = await canalDe(client, eleccion);
    await canal?.send?.({ content: texto, allowedMentions: { parse: [] } }).catch((e) => log.debug(`Anuncio no enviado: ${e.message}`));
}

/** Manda los programas por DM a quien puede votar (y no lo tiene apagado en /avisos). @returns {Promise<number>} enviados */
async function enviarProgramas(client, eleccion, { pausaMs = PAUSA_DM_MS, ahora = Date.now() } = {}) {
    const guild = client.guilds?.cache?.get(eleccion.guildId);
    if (!guild) return 0;
    const miembros = await guild.members.fetch();
    const nombres = new Map([...miembros.values()].map((m) => [m.id, m.displayName]));
    const payload = dmProgramas(eleccion, repo.candidatos(eleccion.id, { finalistas: true }), guild.name, nombres);
    const antiguedad = reglasAjustes.ajustes(eleccion.guildId).antiguedadDias;
    let enviados = 0;
    for (const m of miembros.values()) {
        if (!candidatos.elegible({ esBot: m.user?.bot, unidoEn: m.joinedTimestamp }, antiguedad, ahora).ok) continue;
        if (await avisosDm.enviarAviso(client, m.id, "elecciones", payload, { usuario: m.user })) enviados++;
        await esperar(pausaMs);
    }
    log.info(`Programas de las elecciones ${eleccion.id} enviados por DM a ${enviados} personas`);
    return enviados;
}

/** Da el rol de presidente configurado (si lo hay). */
async function darRol(client, eleccion) {
    const guild = client.guilds?.cache?.get(eleccion.guildId);
    const roleId = reglasAjustes.ajustes(eleccion.guildId).rolPresidente;
    if (!guild || !roleId) return false;
    const comprobacion = rolAsignable(guild, roleId);
    const member = await guild.members.fetch(eleccion.presidenteId).catch(() => null);
    if (!comprobacion.ok || !member) {
        log.warn(`No puedo dar el rol de presidente en ${guild.id}: ${comprobacion.motivo || "el ganador ya no está"}`);
        return false;
    }
    await member.roles.add(comprobacion.role, `Presidente electo (elecciones #${eleccion.id})`);
    return true;
}

/** Lo que hay que hacer tras un cambio de fase. */
async function procesar(client, r, ahora = Date.now(), opciones = {}) {
    await repintar(client, r.eleccion);
    await anunciar(client, r.eleccion, textoAnuncio(r));
    if (r.a === "generales") await enviarProgramas(client, r.eleccion, { ...opciones, ahora });
    if (r.a === "mandato") await darRol(client, r.eleccion).catch((e) => log.warn(`Falló dar el rol de presidente: ${e.message}`));
    if (r.a === "cerrada") {
        await presidencia.finMandato(client, r.eleccion, ahora);
        if (reglasAjustes.ajustes(r.eleccion.guildId).autoReiniciar) {
            await abrirYPublicar(client, r.eleccion.guildId, client.user?.id || "bot", ahora);
        }
    }
}

/** Cron: avanza las elecciones cuya fase ha acabado. @returns {Promise<number>} cuántas han cambiado */
async function revisar(client, ahora = Date.now(), opciones = {}) {
    let cambios = 0;
    for (const eleccion of fases.vencidas(ahora)) {
        if (!client.guilds?.cache?.get(eleccion.guildId)) continue; // el servidor no está disponible ahora: se reintenta
        try {
            const r = fases.avanzar(eleccion, ahora);
            if (!r) continue;
            cambios++;
            log.info(`Elecciones ${eleccion.id} (${eleccion.guildId}): ${r.de} → ${r.a}`);
            await procesar(client, r, ahora, opciones);
        } catch (e) {
            log.warn(`Falló avanzar las elecciones ${eleccion.id}: ${e.message}`);
        }
    }
    return cambios;
}

/** Un admin cancela las elecciones (o destituye al presidente, si están en el mandato). */
async function cancelar(client, guildId, porId, ahora = Date.now()) {
    const destituir = repo.activa(guildId)?.estado === "mandato";
    const motivo = destituir ? "Los admins han destituido al presidente." : "Las han cancelado los admins.";
    const r = fases.cancelar(guildId, motivo, ahora);
    if (!r.ok) return { ok: false, motivo: r.mensaje };
    adminAudit.logAdminAction({
        guildId,
        actorId: porId,
        action: destituir ? "elecciones.destituir" : "elecciones.cancelar",
        details: { eleccionId: r.eleccion.id, fase: r.de, presidenteId: r.presidenteId || null },
    });
    await repintar(client, r.eleccion);
    const texto = destituir
        ? `⚖️ **Los admins han destituido a <@${r.presidenteId}>.** Se acabó su mandato.`
        : `✖️ **Elecciones canceladas.** ${motivo}`;
    await anunciar(client, r.eleccion, texto);
    if (destituir) await presidencia.finMandato(client, r.eleccion, ahora);
    return { ok: true, destituido: destituir };
}

/** Un admin cierra ya la fase en curso y se procesa al momento. */
async function adelantarFase(client, guildId, porId, ahora = Date.now()) {
    const r = fases.adelantar(guildId, ahora);
    if (!r.ok) return { ok: false, motivo: r.mensaje };
    adminAudit.logAdminAction({
        guildId,
        actorId: porId,
        action: "elecciones.adelantar",
        details: { eleccionId: r.eleccion.id, fase: r.eleccion.estado },
    });
    await revisar(client, ahora);
    return { ok: true, eleccion: repo.obtener(r.eleccion.id) };
}

module.exports = { repintar, publicar, abrirYPublicar, enviarProgramas, darRol, procesar, revisar, cancelar, adelantarFase };
