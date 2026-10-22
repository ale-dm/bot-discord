// 🎭 Panel de autoroles (#539): los roles configurados, con ✅/▫️ según los tenga quien mira, en botones
// (hasta 10) o en un desplegable (si hay más, hasta 20). El comando y sus handlers viven en
// commands/general/autoroles.js; aquí solo se monta el payload.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");

function etiquetaDe(rol) {
    return `${rol.emoji ? `${rol.emoji} ` : ""}${rol.etiqueta}`.slice(0, 80);
}

function boton(rol) {
    return new ButtonBuilder()
        .setCustomId(`autorol_btn_${rol.roleId}`)
        .setLabel(etiquetaDe(rol))
        .setStyle(rol.tiene ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function opcion(rol) {
    return {
        label: etiquetaDe(rol).slice(0, 100),
        value: rol.roleId,
        description: rol.tiene ? "Lo tienes: pulsa para quitártelo" : "Pulsa para ponértelo",
    };
}

/** `roles`: lista de systems/autoroles. `guild` y `memberId`, para marcar los que ya tiene. */
function buildAutoroles(roles, { guild = null, memberId = null, aviso = null } = {}) {
    const member = memberId ? guild?.members?.cache?.get(memberId) : null;
    const filas = roles.map((rol) => ({ ...rol, tiene: !!member?.roles?.cache?.has(rol.roleId) }));
    const lineas = filas.map((rol) => `${rol.tiene ? "✅" : "▫️"} ${etiquetaDe(rol)}${rol.grupo ? ` · *${rol.grupo}*` : ""}`);
    const embed = new EmbedBuilder()
        .setTitle("🎭 Autoroles")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (filas.length
                    ? "Pulsa un rol para ponértelo o quitártelo." +
                      (filas.some((f) => f.grupo) ? " En un grupo (por ejemplo, colores) solo puedes tener uno." : "")
                    : "Un admin todavía no ha configurado roles en este servidor."),
        )
        .setColor(0x5865f2);
    if (lineas.length) embed.addFields({ name: "Roles disponibles", value: lineas.join("\n").slice(0, 4000) });

    const components = [];
    if (filas.length && filas.length <= 10) {
        for (let i = 0; i < filas.length; i += 5) {
            components.push(new ActionRowBuilder().addComponents(...filas.slice(i, i + 5).map(boton)));
        }
    } else if (filas.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("autorol_sel")
                    .setPlaceholder("Elige un rol")
                    // La lista ya viene con el tope de systems/autoroles (20), por debajo del máximo de Discord.
                    .addOptions(filas.map(opcion)),
            ),
        );
    }
    return { content: "", embeds: [embed], components, allowedMentions: { parse: [] } };
}

module.exports = { buildAutoroles };
