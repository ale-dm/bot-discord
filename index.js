// Importar discord.js
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] }); // Crear una nueva instancia del cliente
require('dotenv').config(); // Cargar el archivo .env


// Evento cuando el bot está listo
client.once('ready', () => {
    console.log(`¡Conectado como ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply('¡Pong!');
    }
});

// Evento para manejar mensajes
client.on('messageCreate', message => {
    // Evitar que el bot responda a sus propios mensajes
    if (message.author.bot) return;

    // Comando básico
    if (message.content === '!ping') {
        message.channel.send('¡Pong!');
    }
});

// Iniciar sesión con el token del archivo .env
client.login(process.env.TOKEN);
