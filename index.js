// Importar discord.js
const { Client, GatewayIntentBits } = require('discord.js');
const { callApi } = require('./api');  // Importamos la función callApi desde api.js
const { logError } = require('./logger');  // Importamos la función desde logger.js
require('dotenv').config(); // Cargar el archivo .env

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
}); // Crear una nueva instancia del cliente

const comandos = ['!simsimi', '!help', '!info'];  // Puedes añadir más comandos aquí
const estadosString = process.env.ESTADOS;
const Estado = estadosString.split(',');

// Evento cuando el bot está listo
client.once('ready', () => {
    console.log(`¡Conectado como ${client.user.tag}!`);
    actualizarActividad();
    setInterval(actualizarActividad, 5400000);  // Actualiza la actividad cada 90 minutos
});

// Función para actualizar la actividad del bot
function actualizarActividad() {
    const actividad = Estado[Math.floor(Math.random() * Estado.length)];
    client.user.setActivity(actividad, {
        type: "WATCHING",
        status: "mobile",
        platform: "samsung"
    });
}

// Evento para manejar mensajes
client.on('messageCreate', async (message) => {
    // Evitar que el bot responda a sus propios mensajes
    if (message.author.bot) return;

    const userText = message.content.trim(); // El mensaje completo del usuario

    // Comando de ping
    if (userText === '!ping') {
        message.channel.send('¡Pong!');
        return;  // No seguir con más lógica para este comando
    }

    // Comando ayuda (si lo añades más tarde)
    if (userText === '!help') {
        message.channel.send('¡Este es el bot de ayuda! Usa !simsimi para hablar con SimSimi.');
        return;
    }

    // Comando info
    if (userText === '!info') {
        message.channel.send('Este bot utiliza la API de SimSimi para responder a tus preguntas.');
        return;
    }

    // Si el mensaje no es un comando, llamamos a la API de SimSimi
    if (!comandos.some(comando => userText.startsWith(comando))) {
        try {
            const responseMessage = await callApi(userText);  // Llamar a la API con el texto
            message.channel.send(responseMessage); 
        } catch (error) {
            logError(error.message);  // Loguear el error
            message.channel.send('Hubo un error al procesar tu solicitud. Intenta de nuevo más tarde.');
        }
    }
});

// Iniciar sesión con el token del archivo .env
client.login(process.env.TOKEN);
