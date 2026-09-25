// Pestaña "📊 Stats" de /juegos: casino y apuestas juntos, con el beneficio total. El resto de pestañas
// están en paneles/casino (Casino), juegos/apuestas (Apuestas) y paneles/misJugadas (Mis jugadas).
const casino = require("./casino");
const { camposStatsApuestas } = require("./misJugadas");
const { filaPestanas } = require("./pestanasJuegos");

function buildStatsJuegos(userId, username) {
    // Las del casino (resumen y por juego), y debajo las de apuestas.
    const { embeds } = casino.buildStats(userId, username);
    const embed = embeds[0];
    const netoCasino = casino.getUserStats(userId).ganancia;
    const { campos, beneficio } = camposStatsApuestas(userId);
    const total = netoCasino + beneficio;
    embed
        .setTitle(`📊 Estadísticas de ${username}`)
        .spliceFields(0, 1, { ...embed.data.fields[0], name: "🎰 Casino" })
        .addFields(...campos, {
            name: "📊 Total",
            value: `Casino **${fmt(netoCasino)}** · Apuestas **${fmt(beneficio)}** → **${fmt(total)}** ${total >= 0 ? "🟢" : "🔴"}`,
            inline: false,
        })
        .setColor(total >= 0 ? 0x27ae60 : 0xe74c3c);
    return { embeds: [embed], components: [filaPestanas(userId, "stats")] };
}

const fmt = (n) => `${n >= 0 ? "+" : ""}${n.toLocaleString("es")}`;

module.exports = { buildStatsJuegos };
