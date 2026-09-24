const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const RESPUESTAS = [
    // Sí
    { texto: "Sí, sin duda.", tipo: "si" },
    { texto: "Por supuesto que sí.", tipo: "si" },
    { texto: "Las estrellas dicen que sí.", tipo: "si" },
    { texto: "Obvio. ¿Hacía falta preguntar?", tipo: "si" },
    { texto: "Sí, y te va a sorprender.", tipo: "si" },
    // No
    { texto: "No. Ni lo intentes.", tipo: "no" },
    { texto: "Rotundamente no.", tipo: "no" },
    { texto: "Mis fuentes dicen que no.", tipo: "no" },
    { texto: "No, y sabes por qué.", tipo: "no" },
    { texto: "Ni en tus mejores sueños.", tipo: "no" },
    // Duda / evasiva, con tono de duende trastero
    { texto: "Pregúntame en otro momento, ahora ando liado.", tipo: "duda" },
    { texto: "Eso ni yo lo sé, y eso que soy mágico.", tipo: "duda" },
    { texto: "Mmm... mejor no te digo nada.", tipo: "duda" },
    { texto: "La bola está en huelga hoy.", tipo: "duda" },
    { texto: "Concéntrate y vuelve a preguntar.", tipo: "duda" },
];

const COLOR_POR_TIPO = {
    si: 0x2ecc71,
    no: 0xe74c3c,
    duda: 0xf1c40f,
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bola8")
        .setDescription("Pregúntale algo a la bola 8 mágica del Duende")
        .addStringOption((option) => option.setName("pregunta").setDescription("Lo que quieres preguntar").setRequired(true)),

    async run(client, interaction) {
        const pregunta = interaction.options.getString("pregunta").trim();
        const respuesta = RESPUESTAS[Math.floor(Math.random() * RESPUESTAS.length)];

        const embed = new EmbedBuilder()
            .setTitle("🔮 La Bola 8 del Duende")
            .setColor(COLOR_POR_TIPO[respuesta.tipo])
            .addFields({ name: "❓ Pregunta", value: pregunta.slice(0, 1000) }, { name: "🎱 Respuesta", value: `**${respuesta.texto}**` })
            .setFooter({ text: `Preguntado por ${interaction.user.username}` });

        await interaction.reply({ embeds: [embed] });
    },
};
