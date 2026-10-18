// Adaptador de las consecuencias visibles de ganar XP (#472): dar los roles de nivel, anunciar la subida y avisar de la
// racha que continúa. `addXp` devuelve `resultado.eventos`; quien lo llama pasa por aquí.
const { tryAssignRewards, maybeAnnounceLevelUp } = require("./roles");
const { enviarAviso } = require("../../systems/avisosDm");
const { buildStreakContinuedEmbed } = require("../mensajes/rachas");

/**
 * Pinta lo que ha cambiado al ganar XP: los roles y el anuncio de subida de nivel y el DM de racha que continúa.
 * `member` puede ser el miembro de Discord o solo su id (ajustes manuales sin caché).
 */
async function procesarResultadoXp(guild, member, resultado) {
    const efectos = resultado?.eventos;
    if (!guild || !efectos) return;
    const quien = await resolverMiembro(guild, member);
    if (efectos.subidaNivel) {
        await tryAssignRewards(guild, quien, efectos.subidaNivel.oldLevel, efectos.subidaNivel.newLevel);
        await maybeAnnounceLevelUp(guild, quien, efectos.subidaNivel.newLevel);
    }
    if (efectos.rachaActiva) {
        const embed = buildStreakContinuedEmbed(guild, efectos.rachaActiva.streakDias, efectos.rachaActiva.pct);
        await enviarAviso(guild.client, quien.id, "racha_activa", { embeds: [embed] });
    }
}

/** El miembro de Discord, si se pasa solo su id (ajustes manuales del panel): se busca en la caché y, si no, con fetch. */
async function resolverMiembro(guild, member) {
    if (member && typeof member === "object") return member;
    const id = member;
    const enCache = guild.members?.cache?.get(id);
    return enCache || (await guild.members?.fetch?.(id).catch(() => null)) || { id };
}

/** Una pasada de la XP de voz: pregunta a cada canal quién sigue conectado y pinta lo que haya cambiado. */
async function procesarVoiceTick(client) {
    for (const xp of await require("../../systems/xpSystem").voiceTick(client)) {
        await procesarResultadoXp(xp.guild, xp.member, xp.resultado);
    }
}

module.exports = { procesarResultadoXp, procesarVoiceTick };
