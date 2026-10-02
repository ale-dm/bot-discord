// Fila de pestañas de /perfil, igual en todas sus pantallas: 👤 Perfil · 💰 Economía · 🎲 Juegos · 🏅 Logros ·
// 🏆 Rankings (la actual, resaltada). Todos los ids llevan quién mira (owner, en la posición [2]: solo él
// puede pulsar) y de quién es el perfil (target): así, viendo el perfil de otro, ningún botón lleva al tuyo.
// Las pestañas Logros y Rankings llevan "_tab" al final: sin eso eran iguales que botones de su propia pantalla (◀ a la
// página 1 de logros, 🙈 Ocultar secretos, ⏮️ a la página 1 del ranking) y Discord rechazaba el mensaje
// (COMPONENT_CUSTOM_ID_DUPLICATED). El "_tab" sobra al leer el id: se ignora.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const PESTANAS = [
    { id: "perfil", label: "👤 Perfil", customId: (o, t) => `perfil_ver_${o}_${t}` },
    { id: "eco", label: "💰 Economía", customId: (o, t) => `perfil_eco_${o}_${t}` },
    { id: "juegos", label: "🎲 Juegos", customId: (o, t) => `perfil_juegos_${o}_${t}` },
    { id: "logros", label: "🏅 Logros", customId: (o, t) => `perfil_logros_${o}_${t}_0_0_tab` },
    { id: "rankings", label: "🏆 Rankings", customId: (o, t) => `perfil_rank_${o}_${t}_nivel_0_tab` },
];

function filaPestanasPerfil(ownerId, targetId, actual) {
    return new ActionRowBuilder().addComponents(
        PESTANAS.map((p) =>
            new ButtonBuilder()
                .setCustomId(p.customId(ownerId, targetId))
                .setLabel(p.label)
                .setStyle(p.id === actual ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
    );
}

module.exports = { filaPestanasPerfil };
