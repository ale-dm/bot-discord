// 👑 Los poderes del presidente en Discord: mover, desconectar, silenciar y ensordecer en voz, y crear y borrar canales en su
// categoría. Antes de cada acción se comprueban las reglas de systems/elecciones/poderes.js (nunca sobre admins, staff, bots
// ni roles más altos, y una espera por persona). Cada acción se audita y se apunta en el canal de log de moderación. Al acabar
// el mandato se quita el rol, se borran sus canales y se revierten sus silencios; esos, también al vencer (cron cada minuto).
const { ChannelType } = require("discord.js");
const { poderes, presidencia: repoP, ajustes: reglasAjustes } = require("../../systems/elecciones");
const moderacion = require("../../systems/moderacion");
const adminAudit = require("../../systems/adminAudit");
const { rolAsignable } = require("../rolesAutoroles");
const { createLogger } = require("../../core/logger");

const log = createLogger("Presidencia");
const ACCION_VOZ = {
    silencio: (voz, valor, motivo) => voz.setMute(valor, motivo),
    sordera: (voz, valor, motivo) => voz.setDeaf(valor, motivo),
};
const error = (mensaje) => ({ ok: false, mensaje });

/** Lo que las reglas necesitan saber de un miembro. */
function datosMiembro(member, guildId) {
    if (!member) return null;
    return {
        id: member.id,
        esBot: Boolean(member.user?.bot),
        esAdmin: Boolean(member.permissions?.has?.("Administrator")),
        esStaff: moderacion.puedeAvisar(member, guildId),
        posicion: member.roles?.highest?.position ?? 0,
    };
}

async function logModeracion(guild, texto) {
    const canalId = moderacion.ajustes(guild.id).canalLog;
    if (!canalId) return;
    const canal = await guild.channels.fetch(canalId).catch(() => null);
    await canal?.send?.({ content: texto, allowedMentions: { parse: [] } }).catch((e) => log.debug(`Log no enviado: ${e.message}`));
}

/** Apunta la acción (espera, auditoría y canal de log). */
async function apuntar(ctx, accion, objetivoId, texto) {
    poderes.registrar(ctx.eleccion, accion, objetivoId, ctx.ahora);
    adminAudit.logAdminAction({
        guildId: ctx.guild.id,
        actorId: ctx.eleccion.presidenteId,
        action: `elecciones.presidente_${accion}`,
        details: { eleccionId: ctx.eleccion.id, objetivoId: objetivoId || null },
    });
    await logModeracion(ctx.guild, `👑 Presidente <@${ctx.eleccion.presidenteId}>: ${texto}`);
}

/**
 * Comprueba que el presidente puede actuar ya sobre `objetivo` (y, con `enVoz`, que esté en un canal de voz).
 * @param {{ guild, eleccion, presidente, ahora }} ctx `presidente`: su GuildMember
 */
function comprobar(ctx, objetivo, { enVoz = true, conEspera = true } = {}) {
    const v = poderes.validarObjetivo(datosMiembro(objetivo, ctx.guild.id), datosMiembro(ctx.presidente, ctx.guild.id));
    if (!v.ok) return v;
    if (enVoz && !objetivo.voice?.channelId) return error("🔈 Esa persona no está en ningún canal de voz.");
    const falta = conEspera ? poderes.espera(ctx.eleccion, objetivo.id, ctx.ahora) : 0;
    if (falta) return error(`⏳ Ya has actuado sobre esa persona hace poco: espera ${Math.ceil(falta / 60000)} min.`);
    return { ok: true };
}

async function mover(ctx, objetivo, canal) {
    const c = comprobar(ctx, objetivo);
    if (!c.ok) return c;
    if (!canal?.isVoiceBased?.()) return error("❌ Elige un canal de voz.");
    if (canal.id === objetivo.voice.channelId) return error("📍 Ya está en ese canal.");
    await objetivo.voice.setChannel(canal, `Presidente ${ctx.presidente.id}: mover`);
    await apuntar(ctx, "mover", objetivo.id, `ha movido a <@${objetivo.id}> a <#${canal.id}>.`);
    return { ok: true, mensaje: `🚚 Has movido a <@${objetivo.id}> a <#${canal.id}>.` };
}

async function desconectar(ctx, objetivo) {
    const c = comprobar(ctx, objetivo);
    if (!c.ok) return c;
    await objetivo.voice.disconnect(`Presidente ${ctx.presidente.id}: desconectar`);
    await apuntar(ctx, "desconectar", objetivo.id, `ha desconectado de voz a <@${objetivo.id}>.`);
    return { ok: true, mensaje: `👋 Has sacado a <@${objetivo.id}> del canal de voz.` };
}

/** Silencia (`silencio`) o ensordece (`sordera`) durante `minutos`; el cron lo revierte al acabar. */
async function sancionar(ctx, objetivo, tipo, minutos) {
    const c = comprobar(ctx, objetivo);
    if (!c.ok) return c;
    const s = poderes.sancionar(ctx.eleccion, objetivo.id, tipo, minutos, ctx.ahora);
    if (!s.ok) return s;
    try {
        await ACCION_VOZ[tipo](objetivo.voice, true, `Presidente ${ctx.presidente.id}: ${tipo} ${minutos} min`);
    } catch (e) {
        repoP.marcarRevertida(s.id, ctx.ahora);
        throw e;
    }
    const nombre = poderes.TIPOS_SANCION[tipo];
    await apuntar(ctx, tipo, objetivo.id, `${nombre} a <@${objetivo.id}> durante ${minutos} min.`);
    return { ok: true, mensaje: `${nombre} para <@${objetivo.id}> durante **${minutos}** min (hasta <t:${Math.floor(s.fin / 1000)}:t>).` };
}

/** Quita antes de tiempo los silencios y sorderas que el presidente puso a esa persona. */
async function liberar(ctx, objetivo) {
    let quitadas = 0;
    for (const tipo of Object.keys(ACCION_VOZ)) {
        const s = repoP.sancionActiva(ctx.guild.id, objetivo.id, tipo);
        if (!s) continue;
        if (objetivo.voice?.channelId) await ACCION_VOZ[tipo](objetivo.voice, false, `Presidente ${ctx.presidente.id}: liberar`);
        else continue; // fuera de voz no se puede: el cron lo quitará cuando vuelva
        repoP.marcarRevertida(s.id, ctx.ahora);
        quitadas++;
    }
    if (!quitadas) return error("🤷 No tiene ningún silencio ni sordera tuyos que se puedan quitar ahora (tiene que estar en voz).");
    await apuntar(ctx, "liberar", null, `ha levantado el castigo de <@${objetivo.id}>.`);
    return { ok: true, mensaje: `🕊️ Has levantado el castigo de <@${objetivo.id}>.` };
}

async function crearCanal(ctx, nombre, tipo) {
    const p = poderes.puedeCrearCanal(ctx.eleccion);
    if (!p.ok) return p;
    const n = poderes.validarNombreCanal(nombre);
    if (!n.ok) return n;
    const canal = await ctx.guild.channels.create({
        name: n.nombre,
        type: tipo === "voz" ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: p.categoria,
        reason: `Canal del presidente ${ctx.presidente.id}`,
    });
    repoP.registrarCanal({ eleccionId: ctx.eleccion.id, guildId: ctx.guild.id, channelId: canal.id, ahora: ctx.ahora });
    await apuntar(ctx, "crear_canal", null, `ha creado el canal <#${canal.id}>.`);
    return { ok: true, mensaje: `📁 Canal creado: <#${canal.id}>. Se borrará al acabar tu mandato.` };
}

async function borrarCanal(ctx, canalId) {
    const fila = repoP.canalActivo(ctx.eleccion.id, canalId);
    if (!fila) return error("❌ Solo puedes borrar los canales que has creado tú durante el mandato.");
    const canal = await ctx.guild.channels.fetch(canalId).catch(() => null);
    if (canal) await canal.delete(`Lo borra el presidente ${ctx.presidente.id}`);
    repoP.marcarCanalBorrado(fila.id, ctx.ahora);
    await apuntar(ctx, "borrar_canal", null, `ha borrado un canal suyo.`);
    return { ok: true, mensaje: "🗑️ Canal borrado." };
}

/** Cron: revierte los silencios y sorderas vencidos. Fuera de voz no se puede: se reintenta cuando vuelva. */
async function revertirSanciones(client, ahora = Date.now()) {
    let revertidas = 0;
    for (const s of repoP.sancionesVencidas(ahora)) {
        const guild = client.guilds?.cache?.get(s.guildId);
        if (!guild) continue;
        try {
            const member = await guild.members.fetch(s.userId).catch(() => null);
            if (member && !member.voice?.channelId) continue;
            if (member) await ACCION_VOZ[s.tipo](member.voice, false, "Fin del castigo del presidente");
            repoP.marcarRevertida(s.id, ahora);
            revertidas++;
        } catch (e) {
            log.warn(`No pude revertir la sanción #${s.id} en ${s.guildId}: ${e.message}`);
        }
    }
    return revertidas;
}

/** Al acabar el mandato (o destituir): quita el rol, borra sus canales y revierte sus castigos. */
async function finMandato(client, eleccion, ahora = Date.now()) {
    const guild = client.guilds?.cache?.get(eleccion.guildId);
    if (!guild) return;
    const roleId = reglasAjustes.ajustes(eleccion.guildId).rolPresidente;
    const member = eleccion.presidenteId ? await guild.members.fetch(eleccion.presidenteId).catch(() => null) : null;
    if (roleId && member?.roles?.cache?.has(roleId)) {
        const comprobacion = rolAsignable(guild, roleId);
        if (comprobacion.ok) await member.roles.remove(comprobacion.role, "Fin del mandato").catch((e) => log.warn(e.message));
        else log.warn(`No puedo quitar el rol de presidente en ${guild.id}: ${comprobacion.motivo}`);
    }
    for (const c of repoP.canalesActivos(eleccion.id)) {
        const canal = await guild.channels.fetch(c.channelId).catch(() => null);
        if (canal)
            await canal.delete("Fin del mandato del presidente").catch((e) => log.warn(`No pude borrar ${c.channelId}: ${e.message}`));
        repoP.marcarCanalBorrado(c.id, ahora);
    }
    repoP.vencerSancionesDe(eleccion.id, ahora);
    await revertirSanciones(client, ahora);
}

module.exports = { datosMiembro, mover, desconectar, sancionar, liberar, crearCanal, borrarCanal, revertirSanciones, finMandato };
