// 🎁 Cierre de sorteos (#541): el cron (cada minuto) mira los que han vencido, filtra a los participantes que
// siguen cumpliendo los requisitos, elige ganadores, reparte el premio y edita el mensaje con el resultado.
const sorteos = require("../../systems/sorteos");
const xpSystem = require("../../systems/xpSystem");
const avisosDm = require("../../systems/avisosDm");
const { buildSorteo } = require("../../paneles/sorteo");
const { createLogger } = require("../../core/logger");

const log = createLogger("Sorteos");

/** Participantes que siguen en el servidor y cumplen rol, nivel y (si es un objeto único) no lo tienen ya. */
async function elegiblesDe(guild, sorteo) {
    const lista = [];
    for (const p of sorteos.participantes(sorteo.id)) {
        const member = await guild.members.fetch(p.userId).catch(() => null);
        if (!member) continue;
        if (sorteo.rolId && !member.roles.cache.has(sorteo.rolId)) continue;
        if (sorteo.nivel > 0 && (xpSystem.getProfile(sorteo.guildId, p.userId).nivel || 0) < sorteo.nivel) continue;
        if (sorteo.premioTipo === "objeto") {
            const obj = sorteos.objetoPorId(sorteo.premioValor);
            if (obj?.unico && sorteos.tieneObjeto(p.userId, obj.id)) continue;
        }
        lista.push(p.userId);
    }
    return lista;
}

const canalDe = async (guild, id) => guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));

function textoResultado(r) {
    const lista = r.ganadores.map((g) => `<@${g.userId}>`).join(", ");
    if (r.premioTipo === "dinero") {
        return `🎉 Sorteo #${r.sorteo.id}: ${lista || "nadie"} ${r.ganadores.length === 1 ? "se lleva" : "se llevan"} **${Number(
            r.sorteo.premioValor,
        ).toLocaleString("es")}** 🪙.`;
    }
    return `🎉 Sorteo #${r.sorteo.id}: ${lista || "nadie"} ${r.ganadores.length === 1 ? "se lleva" : "se llevan"} **${r.premioNombre}**.`;
}

/** Edita el mensaje del sorteo, anuncia en el canal y avisa por DM a cada ganador. */
async function avisar(client, guild, r) {
    const s = r.sorteo;
    if (guild) {
        const channel = await canalDe(guild, s.channelId);
        if (channel) {
            if (s.messageId) {
                const msg = await channel.messages.fetch(s.messageId).catch(() => null);
                if (msg) {
                    await msg
                        .edit(
                            buildSorteo(s, {
                                participantes: sorteos.cuentaParticipantes(s.id),
                                ganadores: r.ganadores,
                                terminado: true,
                            }),
                        )
                        .catch((e) => log.debug(`No pude editar el mensaje del sorteo #${s.id}: ${e.message}`));
                }
            }
            await channel
                .send({ content: textoResultado(r), allowedMentions: { users: r.ganadores.map((g) => g.userId) } })
                .catch((e) => log.warn(`No pude anunciar el sorteo #${s.id}: ${e.message}`));
        }
    }
    for (const g of r.ganadores) {
        const premio = r.premioTipo === "dinero" ? `**${g.cantidad.toLocaleString("es")}** 🪙` : `**${r.premioNombre}**`;
        await avisosDm.sendDm(client, g.userId, { content: `🎁 Has ganado el sorteo #${s.id}: ${premio}.` });
    }
}

/** Cierra los sorteos vencidos. También corre al arrancar, así que no se pierde ninguno si el bot estaba caído. */
async function revisar(client, ahora = Date.now()) {
    for (const s of sorteos.pendientes(ahora)) {
        const guild = client.guilds.cache.get(s.guildId) || (await client.guilds.fetch(s.guildId).catch(() => null));
        const elegibles = guild ? await elegiblesDe(guild, s) : [];
        const r = sorteos.cerrar(s.id, elegibles, ahora);
        if (r) await avisar(client, guild, r);
    }
}

module.exports = { revisar, elegiblesDe, textoResultado };
