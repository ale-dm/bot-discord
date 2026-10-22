// ⭐ Panel de /favoritos (#530): los equipos que sigue una persona y sus próximos partidos con cuotas 1X2.
const { EmbedBuilder } = require("discord.js");
const favoritos = require("../systems/apuestas/favoritos");
const { DEPORTES } = require("../services/oddsApi");

const MAX_PARTIDOS = 6;
const LIMITE_CAMPO = 1024;

const recortar = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);
const cuota = (n) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Number(n).toFixed(2) : "—");

function lineaPartido(p) {
    const unix = Math.floor(Date.parse(p.start_time) / 1000);
    const deporte = DEPORTES[p.deporte] || DEPORTES.laliga;
    return (
        `${deporte.emoji} **${p.home_team} vs ${p.away_team}** · ${deporte.name}\n` +
        `<t:${unix}:f> (<t:${unix}:R>) · 1 ${cuota(p.cuota_home)} · X ${cuota(p.cuota_draw)} · 2 ${cuota(p.cuota_away)}`
    );
}

/** El embed de los equipos seguidos y sus próximos partidos. Si no sigue a nadie, explica cómo empezar. */
function buildFavoritos(userId) {
    const equipos = favoritos.seguidos(userId);
    const embed = new EmbedBuilder().setTitle("⭐ Tus equipos favoritos").setColor(0xf1c40f);
    if (!equipos.length) {
        embed.setDescription(
            "Todavía no sigues a ningún equipo.\n\n" +
                "Empieza con `/favoritos seguir equipo:Betis` (puedes seguir hasta " +
                `${favoritos.MAX_EQUIPOS}). Te avisaré por DM cuando aparezca un partido suyo, con la hora y las cuotas ` +
                "1X2. Puedes apagar ese aviso en `/avisos`.",
        );
        return { embeds: [embed] };
    }

    const partidos = favoritos.proximos(userId, { limite: MAX_PARTIDOS });
    embed.setDescription(
        `Sigues a **${equipos.length}** de ${favoritos.MAX_EQUIPOS} equipos. Cuando aparezca un partido suyo te llega un ` +
            "DM con la hora y las cuotas; se apaga en `/avisos`.",
    );
    embed.addFields({
        name: `⭐ Equipos (${equipos.length}/${favoritos.MAX_EQUIPOS})`,
        value: recortar(equipos.map((e) => `• ${e.equipo}`).join("\n"), LIMITE_CAMPO),
    });
    embed.addFields({
        name: "📅 Próximos partidos",
        value: partidos.length
            ? recortar(partidos.map(lineaPartido).join("\n\n"), LIMITE_CAMPO)
            : "Ninguno de tus equipos tiene un partido abierto ahora mismo.",
    });
    return { embeds: [embed] };
}

module.exports = { buildFavoritos };
