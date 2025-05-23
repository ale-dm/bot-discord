module.exports = {
    name: 'ban',
    description: 'Banea a un usuario.',
    execute(client, message, args) {
      // Aquí iría la lógica para banear a un usuario
        message.reply(`El usuario ${args[0]} ha sido baneado.`);
    }
};
