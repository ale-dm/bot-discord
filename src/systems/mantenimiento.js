// 🛠️ Modo mantenimiento (#425): con `mantenimiento.activo` el bot solo atiende a los admins (comandos, botones, selectores y
// formularios, también los de mensajes ya publicados). Los demás reciben `mantenimiento.mensaje`. Las tareas programadas no
// pasan por aquí: siguen corriendo.
const guildSettings = require("./guildSettings");
const { esAdmin } = require("../core/permisos");

/** El mensaje que hay que darle a quien usa esta interacción, o null si puede seguir (sin modo activo, en DM o siendo admin). */
function mensajeSiBloquea(interaction) {
    if (!interaction?.guildId) return null;
    const cfg = guildSettings.getSettings(interaction.guildId).mantenimiento;
    if (!cfg.activo || esAdmin(interaction)) return null;
    return cfg.mensaje || "🛠️ El bot está en mantenimiento.";
}

module.exports = { mensajeSiBloquea };
