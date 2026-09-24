const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { registrarUsuario, descontarApuesta, procesarGanancia, procesarPerdida, obtenerSaldo } = require("../../systems/casinoTransactions");

const OPCIONES = {
    piedra: { emoji: "🪨", gana_a: "tijera" },
    papel: { emoji: "📄", gana_a: "piedra" },
    tijera: { emoji: "✂️", gana_a: "papel" },
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ppt")
        .setDescription("Piedra, papel o tijera contra El Duende, apostando monedas")
        .addStringOption((option) =>
            option
                .setName("jugada")
                .setDescription("Tu jugada")
                .setRequired(true)
                .addChoices(
                    { name: "🪨 Piedra", value: "piedra" },
                    { name: "📄 Papel", value: "papel" },
                    { name: "✂️ Tijera", value: "tijera" },
                ),
        )
        .addIntegerOption((option) => option.setName("cantidad").setDescription("Monedas a apostar").setRequired(true).setMinValue(1)),

    async run(client, interaction) {
        const userId = interaction.user.id;
        const jugadaUsuario = interaction.options.getString("jugada");
        const cantidad = interaction.options.getInteger("cantidad");

        registrarUsuario(userId, interaction.user.username, interaction.user.tag);

        const resultadoApuesta = descontarApuesta(userId, cantidad, interaction.guildId);
        if (!resultadoApuesta.exito) {
            await interaction.reply({ content: resultadoApuesta.mensaje, ephemeral: true });
            return;
        }

        const claves = Object.keys(OPCIONES);
        const jugadaDuende = claves[Math.floor(Math.random() * claves.length)];

        let tipo;
        if (jugadaUsuario === jugadaDuende) {
            tipo = "empate";
        } else if (OPCIONES[jugadaUsuario].gana_a === jugadaDuende) {
            tipo = "victoria";
        } else {
            tipo = "derrota";
        }

        const descripcion = `PPT: ${jugadaUsuario} vs ${jugadaDuende} (${tipo}), apuesta ${cantidad}`;
        let ganancia = 0;
        let exito;
        if (tipo === "victoria") {
            ganancia = cantidad * 2;
            exito = procesarGanancia(userId, "ppt", cantidad, ganancia, descripcion, {
                jugadaUsuario,
                jugadaDuende,
                guildId: interaction.guildId,
            });
        } else if (tipo === "empate") {
            ganancia = cantidad;
            exito = procesarGanancia(userId, "ppt", cantidad, ganancia, descripcion, {
                jugadaUsuario,
                jugadaDuende,
                guildId: interaction.guildId,
            });
        } else {
            exito = procesarPerdida(userId, "ppt", cantidad, descripcion, { jugadaUsuario, jugadaDuende, guildId: interaction.guildId });
        }

        if (!exito) {
            await interaction.reply({ content: "❌ Hubo un error procesando la partida. Contacta a un administrador.", ephemeral: true });
            return;
        }

        const saldoActual = obtenerSaldo(userId);
        const colorPorTipo = { victoria: 0x2ecc71, derrota: 0xe74c3c, empate: 0xf1c40f };
        const tituloPorTipo = { victoria: "🎉 ¡Ganaste!", derrota: "💀 Perdiste", empate: "🤝 Empate" };

        const embed = new EmbedBuilder()
            .setTitle(tituloPorTipo[tipo])
            .setColor(colorPorTipo[tipo])
            .setDescription(
                `${OPCIONES[jugadaUsuario].emoji} **Tú:** ${jugadaUsuario}\n` +
                    `${OPCIONES[jugadaDuende].emoji} **El Duende:** ${jugadaDuende}\n\n` +
                    `*"${frase(tipo)}"*\n\n` +
                    (tipo === "victoria"
                        ? `💰 Ganaste **${ganancia - cantidad}** monedas.`
                        : tipo === "empate"
                          ? "💰 Recuperas tu apuesta."
                          : `💰 Perdiste **${cantidad}** monedas.`) +
                    `\n💳 Saldo actual: **${saldoActual}** monedas`,
            )
            .setFooter({ text: "El Duende Casino • /ppt" });

        await interaction.reply({ embeds: [embed] });
    },
};
