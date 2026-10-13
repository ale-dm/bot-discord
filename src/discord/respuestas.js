// Respuestas efímeras (solo las ve quien las pidió). Acepta un texto o un payload (content, embeds, components...).
const { MessageFlags } = require("discord.js");

function efimero(payload) {
    const datos = typeof payload === "string" ? { content: payload } : payload;
    return { ...datos, flags: MessageFlags.Ephemeral };
}

module.exports = { efimero };
