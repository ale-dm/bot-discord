// bot.js
const { Client, Intents } = require('discord.js');
const { callApi } = require('./api');  // Importamos la función callApi desde api.js

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Comando para activar la API
    if (message.content.startsWith('!api')) {
        // Obtiene el texto después del comando
        const userInput = message.content.slice(5).trim(); // Elimina "!api " del inicio
        
        if (!userInput) {
            return message.reply('Por favor, ingresa un texto para enviar a la API.');
        }

        try {
            // Llamamos a la función callApi que está en api.js
            const apiResponse = await callApi(userInput);

            // Enviamos la respuesta de la API al canal
            message.channel.send(`Respuesta de la API: ${apiResponse}`);

        } catch (error) {
            // Manejo de errores en caso de que falle la API
            message.channel.send('Hubo un error al hacer la solicitud a la API.');
        }
    }
});

client.login('TU_TOKEN');
