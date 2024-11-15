const { REST, Routes } = require('discord.js');
require('dotenv').config(); // Cargar el archivo .env

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const commands = [
    {
        name: 'ping',
        description: 'Responde con Pong!',
    },
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Registrando comandos slash...');
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('¡Comandos registrados exitosamente!');
    } catch (error) {
        console.error(error);
    }
})();
