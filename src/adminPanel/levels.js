// Panel admin → Niveles. Cada pantalla está en adminPanel/niveles/ (configuración, recompensas,
// usuarios y canales ignorados); aquí solo se reparte cada interacción a la que le toca.
const xp = require("../systems/xpSystem");
const { levelsHomeRows, buildXpHome } = require("./views");
const pantallas = ["config", "recompensas", "usuarios", "ignorados"].map((p) => require(`./niveles/${p}`));

// Prueba los manejadores `tipo` de cada pantalla hasta que uno la atienda.
async function repartir(tipo, interaction) {
    for (const p of pantallas) {
        if (p[tipo] && (await p[tipo](interaction))) return true;
    }
    return false;
}

async function handleLevelsButton(interaction) {
    if (interaction.customId === "paneladmin_levels_home") {
        xp.ensureGuildDefaults(interaction.guildId);
        await interaction.update({ embeds: [buildXpHome(interaction.guildId)], components: levelsHomeRows() });
        return true;
    }
    return repartir("boton", interaction);
}

const handleLevelsModal = (interaction) => repartir("modal", interaction);
const handleRoleSelect = (interaction) => repartir("selectRol", interaction);
const handleStringSelect = (interaction) => repartir("selectTexto", interaction);
const handleChannelSelect = (interaction) => repartir("selectCanal", interaction);

module.exports = { handleLevelsButton, handleLevelsModal, handleRoleSelect, handleStringSelect, handleChannelSelect };
