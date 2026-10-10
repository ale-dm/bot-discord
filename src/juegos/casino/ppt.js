const { EmbedBuilder, MessageFlags } = require("discord.js");
const { registrarUsuario, descontarApuesta, obtenerSaldo } = require("../../systems/casinoTransactions");
const { jugadaDuende, resolverJugada, liquidarJugada } = require("../../systems/casino/ppt");
const casino = require("../../paneles/casino");

const EMOJI = {
    piedra: "🪨",
    papel: "📄",
    tijera: "✂️",
};

const FRASES_DUENDE = {
    victoria: ["Vaya, hoy tenías el brazo afilado.", "Suerte de novato. No te acostumbres.", "Está bien, esta la ganas tú."],
    derrota: ["Como siempre, gano yo. Es lo que hay.", "Ni lo has visto venir.", "Jugar contra un duende tiene estas cosas."],
    empate: ["Empate. Los dos pensamos igual de mal.", "Nadie gana, nadie llora.", "Vaya par de indecisos."],
};

function frase(tipo) {
    const arr = FRASES_DUENDE[tipo];
    return arr[Math.floor(Math.random() * arr.length)];
}

// Lo que se ve del resultado: el color, el título y lo que se ganó o se perdió.
function embedResultado(tipo, { jugadaUsuario, jugadaDelDuende, cantidad, ganancia, saldoActual }) {
    const colorPorTipo = { victoria: 0x2ecc71, derrota: 0xe74c3c, empate: 0xf1c40f };
    const tituloPorTipo = { victoria: "🎉 ¡Ganaste!", derrota: "💀 Perdiste", empate: "🤝 Empate" };

    return new EmbedBuilder()
        .setTitle(tituloPorTipo[tipo])
        .setColor(colorPorTipo[tipo])
        .setDescription(
            `${EMOJI[jugadaUsuario]} **Tú:** ${jugadaUsuario}\n` +
                `${EMOJI[jugadaDelDuende]} **El Duende:** ${jugadaDelDuende}\n\n` +
                `*"${frase(tipo)}"*\n\n` +
                (tipo === "victoria"
                    ? `💰 Ganaste **${ganancia - cantidad}** monedas.`
                    : tipo === "empate"
                      ? "💰 Recuperas tu apuesta."
                      : `💰 Perdiste **${cantidad}** monedas.`) +
                `\n💳 Saldo actual: **${saldoActual}** monedas`,
        )
        .setFooter({ text: "El Duende Casino • Piedra, papel o tijera" });
}

module.exports = {
    async run(client, interaction) {
        const userId = interaction.user.id;
        const jugadaUsuario = interaction.options.getString("jugada");
        const cantidad = interaction.options.getInteger("cantidad");

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        const resultadoApuesta = descontarApuesta(userId, cantidad, interaction.guildId);
        if (!resultadoApuesta.exito) {
            await interaction.reply({ content: resultadoApuesta.mensaje, flags: MessageFlags.Ephemeral });
            return;
        }

        const jugadaDelDuende = jugadaDuende();
        const tipo = resolverJugada(jugadaUsuario, jugadaDelDuende);
        const { exito, ganancia } = liquidarJugada(userId, interaction.guildId, cantidad, tipo, jugadaUsuario, jugadaDelDuende);
        if (!exito) {
            await interaction.reply({
                content: "❌ Hubo un error procesando la partida. Contacta a un administrador.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const saldoActual = obtenerSaldo(userId);
        const embed = embedResultado(tipo, { jugadaUsuario, jugadaDelDuende, cantidad, ganancia, saldoActual });

        // Repetir vuelve a pedir la jugada con el mismo importe.
        await interaction.reply({ embeds: [embed], components: [casino.filaFinJuego("ppt", cantidad)] });
    },
};
