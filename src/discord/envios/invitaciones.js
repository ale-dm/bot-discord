// 📨 Las invitaciones en Discord (#522): una foto de los usos de cada invitación por servidor (al arrancar y tras cada
// entrada), para saber al entrar alguien qué invitación usó comparando con la foto anterior; y el cron (cada hora) que mira
// si los invitados pendientes han madurado, paga a quien invitó y se lo dice por DM. Hace falta que el bot pueda ver las
// invitaciones (Gestionar servidor); si no, no se apunta nada y se dice en el log una vez por servidor.
const invitaciones = require("../../systems/invitaciones");
const avisosDm = require("../../systems/avisosDm");
const db = require("../../core/db");
const { fmtNumero } = require("../../core/formato");
const { createLogger } = require("../../core/logger");

const log = createLogger("Invitaciones");
/** guildId → Map(código → usos). */
const fotos = new Map();
const sinPermiso = new Set();

/** Las invitaciones del servidor como { code, uses, inviterId }, o null si no se pueden ver. */
async function leer(guild) {
    try {
        const lista = await guild.invites.fetch();
        return [...lista.values()].map((i) => ({ code: i.code, uses: i.uses || 0, inviterId: i.inviter?.id || i.inviterId || null }));
    } catch (e) {
        if (!sinPermiso.has(guild.id)) log.warn(`No puedo ver las invitaciones de ${guild.id} (¿falta Gestionar servidor?): ${e.message}`);
        sinPermiso.add(guild.id);
        return null;
    }
}

const guardarFoto = (guildId, lista) => fotos.set(guildId, new Map(lista.map((i) => [i.code, i.uses])));

/** Al arrancar: la foto de cada servidor. */
async function cargar(client) {
    for (const guild of client.guilds?.cache?.values?.() || []) {
        const lista = await leer(guild);
        if (lista) guardarFoto(guild.id, lista);
    }
}

/** Al entrar alguien: qué invitación usó y, si es de un miembro, se apunta. */
async function alEntrar(member, ahora = Date.now()) {
    if (member.user?.bot) return null;
    const guild = member.guild;
    const lista = await leer(guild);
    if (!lista) return null;
    const antes = fotos.get(guild.id) || new Map();
    guardarFoto(guild.id, lista);
    const usada = invitaciones.invitacionUsada(antes, lista, guild.vanityURLCode || null);
    if (!usada) return null;
    const r = invitaciones.registrar(
        {
            guildId: guild.id,
            invitadoId: member.id,
            invitadorId: usada.inviterId,
            codigo: usada.code,
            cuentaCreada: member.user?.createdTimestamp,
        },
        ahora,
    );
    if (r.ok)
        log.info(
            `${member.id} entró en ${guild.id} con la invitación de ${usada.inviterId} (${r.estado}${r.motivo ? `: ${r.motivo}` : ""})`,
        );
    return r;
}

const nivelDe = (guildId, userId) =>
    db.prepare("SELECT nivel FROM xp_users WHERE guildId = ? AND userId = ?").pluck().get(String(guildId), String(userId)) || 0;

/** Cron: madura las pendientes que toca y avisa por DM. @returns {Promise<number>} cuántas han cambiado */
async function revisar(client, ahora = Date.now()) {
    let cambios = 0;
    for (const inv of invitaciones.porMadurar(ahora)) {
        const guild = client.guilds?.cache?.get(inv.guildId);
        if (!guild) continue;
        const member = await guild.members.fetch(inv.invitadoId).catch(() => null);
        const r = invitaciones.madurar(
            { guildId: inv.guildId, invitadoId: inv.invitadoId, esMiembro: Boolean(member), nivel: nivelDe(inv.guildId, inv.invitadoId) },
            ahora,
        );
        if (!r) continue;
        cambios++;
        if (r.estado !== "madurada") continue;
        const hito = r.hito ? ` ¡Y has llegado a ${r.hito.invitados} invitados: hito de **${fmtNumero(r.hito.premio)}** 🪙!` : "";
        await avisosDm.enviarAviso(client, r.invitadorId, "invitaciones", {
            content: `📨 <@${inv.invitadoId}>, a quien invitaste a **${guild.name}**, ya se ha quedado: cobras **${fmtNumero(r.pagado)}** 🪙.${hito}`,
            allowedMentions: { parse: [] },
        });
    }
    return cambios;
}

module.exports = { cargar, alEntrar, revisar, fotos };
