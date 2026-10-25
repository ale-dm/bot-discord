// ⏳ Roles temporales en Discord (#543): dar el rol, quitarlo antes de tiempo, quitar los vencidos (cada minuto y al arrancar)
// y cancelar las asignaciones de un rol borrado. Antes de dar o quitar se comprueba la jerarquía y que el rol no lo gestione
// una integración. Todo cambio va a la auditoría; el DM al interesado es opcional y best-effort.
const rolesTemporales = require("../../systems/rolesTemporales");
const adminAudit = require("../../systems/adminAudit");
const avisosDm = require("../../systems/avisosDm");
const { rolAsignable } = require("../rolesAutoroles");
const { createLogger } = require("../../core/logger");

const log = createLogger("RolesTemporales");
// Las que no se pudieron quitar (jerarquía, permisos): se reintentan cada minuto, pero solo se avisa una vez en el log.
const avisadas = new Set();

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;

async function avisar(client, r, texto) {
    if (!r.avisar || !client) return;
    await avisosDm.sendDm(client, r.userId, { content: texto, allowedMentions: { parse: [] } });
}

/**
 * Da el rol durante `dias`. @returns {Promise<{ ok: true, id: number, vence: number } | { ok: false, motivo: string }>}
 */
async function dar(guild, { userId, roleId, dias, porId, avisar: conDm = true }, { client = null, ahora = Date.now() } = {}) {
    if (!rolesTemporales.diasValidos(dias)) return { ok: false, motivo: `La duración va de 1 a ${rolesTemporales.DIAS_MAX} días.` };
    const comprobacion = rolAsignable(guild, roleId);
    if (!comprobacion.ok) return comprobacion;
    const member = await guild.members.fetch(String(userId)).catch(() => null);
    if (!member) return { ok: false, motivo: "Esa persona no está en el servidor." };
    if (rolesTemporales.activo(guild.id, userId, roleId))
        return { ok: false, motivo: "Ya tiene ese rol temporal: renuévalo desde la lista." };
    await member.roles.add(comprobacion.role, `Rol temporal de ${dias} días (lo da ${porId})`);
    const r = rolesTemporales.registrar({ guildId: guild.id, userId, roleId, porId, dias, avisar: conDm }, ahora);
    if (!r.ok) return r;
    adminAudit.logAdminAction({
        guildId: guild.id,
        actorId: porId,
        action: "roles.temporal_dar",
        details: { id: r.id, userId, roleId, dias, vence: r.vence },
    });
    await avisar(
        client,
        { userId, avisar: conDm },
        `⏳ Te han dado el rol **${comprobacion.role.name}** en **${guild.name}** hasta el ${ts(r.vence)}.`,
    );
    return r;
}

/** Alarga una asignación activa y lo audita. */
function renovar(guildId, id, dias, porId, ahora = Date.now()) {
    const actual = rolesTemporales.get(id);
    if (!actual || actual.guildId !== String(guildId)) return { ok: false, motivo: "Ese rol temporal no existe." };
    const r = rolesTemporales.renovar(id, dias, ahora);
    if (r.ok) {
        adminAudit.logAdminAction({
            guildId,
            actorId: porId,
            action: "roles.temporal_renovar",
            details: { id: Number(id), dias: Number(dias), antes: r.antes, vence: r.vence },
        });
    }
    return r;
}

/**
 * Quita el rol de Discord (si sigue ahí) y cierra la asignación con `estado`. Si el rol ya no existe, se cancela; si la persona
 * se fue, se cierra sin tocar nada. @returns {Promise<{ ok: boolean, motivo?: string, estado?: string }>}
 */
async function retirar(guild, r, estado, porId, ahora) {
    const role = guild.roles?.cache?.get(r.roleId);
    if (!role) {
        rolesTemporales.terminar(r.id, "cancelado", porId, ahora);
        return { ok: true, estado: "cancelado" };
    }
    const member = await guild.members.fetch(r.userId).catch(() => null);
    if (member?.roles?.cache?.has(r.roleId)) {
        const comprobacion = rolAsignable(guild, r.roleId);
        if (!comprobacion.ok) return comprobacion;
        await member.roles.remove(role, estado === "vencido" ? "Rol temporal vencido" : `Rol temporal quitado por ${porId}`);
    }
    rolesTemporales.terminar(r.id, estado, porId, ahora);
    return { ok: true, estado, nombreRol: role.name };
}

/** Quita antes de tiempo (desde el panel). */
async function quitar(guild, id, porId, { client = null, ahora = Date.now() } = {}) {
    const r = rolesTemporales.get(id);
    if (!r || r.guildId !== guild.id || r.estado !== "activo") return { ok: false, motivo: "Ese rol temporal ya no está activo." };
    const res = await retirar(guild, r, "quitado", porId, ahora);
    if (!res.ok) return res;
    adminAudit.logAdminAction({
        guildId: guild.id,
        actorId: porId,
        action: res.estado === "cancelado" ? "roles.temporal_cancelar" : "roles.temporal_quitar",
        details: { id: r.id, userId: r.userId, roleId: r.roleId },
    });
    if (res.estado === "quitado") await avisar(client, r, `⏳ Te han quitado el rol **${res.nombreRol}** en **${guild.name}**.`);
    return res;
}

/** Quita los roles vencidos. Lo llama el cron cada minuto y el arranque (los que vencieron con el bot apagado). */
async function vencer(client, ahora = Date.now()) {
    let quitados = 0;
    for (const r of rolesTemporales.vencidas(ahora)) {
        const guild = client.guilds?.cache?.get(r.guildId);
        if (!guild) continue; // el servidor no está disponible ahora: se reintenta
        try {
            const res = await retirar(guild, r, "vencido", client.user?.id || "bot", ahora);
            if (!res.ok) {
                if (!avisadas.has(r.id)) log.warn(`No puedo quitar el rol temporal #${r.id} en ${guild.id}: ${res.motivo}`);
                avisadas.add(r.id);
                continue;
            }
            avisadas.delete(r.id);
            quitados++;
            adminAudit.logAdminAction({
                guildId: r.guildId,
                actorId: client.user?.id || "bot",
                action: res.estado === "cancelado" ? "roles.temporal_cancelar" : "roles.temporal_vencer",
                details: { id: r.id, userId: r.userId, roleId: r.roleId },
            });
            if (res.estado === "vencido") await avisar(client, r, `⏳ Ha vencido tu rol **${res.nombreRol}** en **${guild.name}**.`);
        } catch (e) {
            log.warn(`Falló quitar el rol temporal #${r.id} en ${r.guildId}: ${e.message}`);
        }
    }
    if (quitados) log.info(`Roles temporales vencidos y quitados: ${quitados}`);
    return quitados;
}

/** Se ha borrado un rol: sus asignaciones activas se cancelan (con auditoría). */
function alBorrarRol(guildId, roleId, actorId = "bot") {
    let canceladas = 0;
    for (const r of rolesTemporales.activasDelRol(guildId, roleId)) {
        if (!rolesTemporales.terminar(r.id, "cancelado", actorId)) continue;
        canceladas++;
        adminAudit.logAdminAction({ guildId, actorId, action: "roles.temporal_cancelar", details: { id: r.id, userId: r.userId, roleId } });
    }
    return canceladas;
}

module.exports = { dar, renovar, quitar, vencer, alBorrarRol };
