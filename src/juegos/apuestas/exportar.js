// 📤 El botón «Exportar» de 📋 Mis jugadas (#356): envía en privado un CSV con todas tus apuestas. Las reglas del fichero están en
// systems/apuestas/exportar.
const { AttachmentBuilder, MessageFlags } = require("discord.js");
const { csvDeApuestas } = require("../../systems/apuestas/exportar");

// El BOM hace que Excel abra el fichero en UTF-8 (con las tildes bien).
const BOM = "﻿";

/** misapuestas_exportar_{userId}: solo quien abrió Mis jugadas puede pedirlo, y el fichero solo lleva sus apuestas. */
async function handleButton(client, interaction) {
    const userId = interaction.customId.replace("misapuestas_exportar_", "");
    if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ Solo puedes exportar tus propias apuestas.", flags: MessageFlags.Ephemeral });
        return;
    }
    const { csv, total } = csvDeApuestas(userId);
    const fichero = new AttachmentBuilder(Buffer.from(BOM + csv, "utf8"), { name: "mis-apuestas.csv" });
    await interaction.reply({
        content:
            total > 0
                ? `📤 Aquí tienes tus **${total}** apuestas en CSV.`
                : "📤 Todavía no tienes apuestas: te dejo el CSV solo con la cabecera.",
        files: [fichero],
        flags: MessageFlags.Ephemeral,
    });
}

module.exports = {
    componentHandlers: [{ types: ["button"], prefixes: ["misapuestas_exportar_"], method: "handleButton", acl: "juegos" }],
    handleButton,
};
