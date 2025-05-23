module.exports = {
    name: 'saludo',
    description: 'Envía un saludo al usuario.',
    execute(client, message, args) {
        message.reply('¡Hola! ¿Cómo estás?');
    }
    };