const { EmbedBuilder, MessageFlags } = require("discord.js");
const { registrarUsuario } = require("../../systems/casinoTransactions");
const rasca = require("../../systems/casino/rasca");
const casino = require("../../paneles/casino");

// El cartón en tres filas, para que se lea como un rasca de verdad.
function tablero(carton) {
    const filas = [];
    for (let f = 0; f < rasca.FILAS; f++) {
        filas.push(carton.slice(f * rasca.COLUMNAS, (f + 1) * rasca.COLUMNAS).join(" "));
    }
    return filas.join("\n");
}

function embed(r) {
    const premio = r.resultado
        ? `🎉 **Tres ${r.resultado.simbolo} ${r.resultado.nombre}**: ganas **${r.gananciaTotal.toLocaleString("es")}** 🪙` +
          (r.neto > 0 ? ` (neto +${r.neto.toLocaleString("es")})` : "")
        : "😢 No ha salido ningún trío. Otra vez será.";
    const titulo = r.resultado ? `🎟️ Rasca y gana — ¡${r.resultado.nombre} ×${r.resultado.multiplicador}!` : "🎟️ Rasca y gana — Sin premio";
    const color = !r.resultado ? 0x95a5a6 : r.resultado.multiplicador >= 15 ? 0xf1c40f : 0x2ecc71;

    return new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(`**Tu cartón**\n${tablero(r.carton)}\n\n${premio}\n💳 Saldo actual: **${r.saldo.toLocaleString("es")}** monedas`)
        .setColor(color)
        .setFooter({ text: `El Duende Casino • Rasca y gana • Apuesta ${r.apuesta.toLocaleString("es")}` });
}

module.exports = {
    async run(client, interaction) {
        const userId = interaction.user.id;
        const apuesta = interaction.options.getInteger("apuesta");

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        const partida = rasca.jugar(userId, interaction.guildId, apuesta);
        if (!partida.exito) {
            await interaction.reply({ content: partida.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.reply({
            embeds: [embed(partida)],
            components: [casino.filaFinJuego("rasca", apuesta, { userId })],
        });
    },
};
