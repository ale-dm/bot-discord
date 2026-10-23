// ⭐ Botones y formulario del DM de reseñas (#566). Se llaman desde commands/plex/plex.js.
const plexResenas = require("../../systems/plexResenas");
const pedidos = require("../../systems/plexResenas/pedidos");
const { formularioResena, filaEditar } = require("../../discord/mensajes/resena");
const { efimero } = require("../../discord/respuestas");

const noEsTuya = (interaction) => interaction.reply(efimero({ content: "Esta reseña no es tuya." }));

/** Los botones del DM: una estrella, «Ahora no», cambiar y borrar. */
async function handleButton(interaction) {
    const m = /^plex_resena_(nota|no|editar|borrar)_(\d+)(?:_(\d+))?$/.exec(interaction.customId);
    if (!m) return;
    const [, accion, idPedido, nota] = m;
    const pedido = pedidos.pedido(Number(idPedido));
    if (!pedido || String(pedido.userId) !== String(interaction.user.id)) return noEsTuya(interaction);

    if (accion === "no") {
        pedidos.marcar(pedido.id, "pasada");
        return interaction.update({ content: "⏭️ Vale, no te pregunto más por esta.", embeds: [], components: [] });
    }
    if (accion === "borrar") {
        plexResenas.borrar(pedido.guildId, interaction.user.id, pedido.clave);
        pedidos.marcar(pedido.id, "pasada");
        return interaction.update({ content: "🗑️ Reseña borrada.", embeds: [], components: [] });
    }
    const resena = accion === "editar" ? plexResenas.de(pedido.guildId, interaction.user.id, pedido.clave) : null;
    return interaction.showModal(formularioResena(pedido, resena, nota ? Number(nota) : null));
}

/** El formulario: guarda la nota y la opinión y deja el DM con ✏️ / 🗑️. */
async function handleModal(interaction) {
    const m = /^plex_modal_resena_(\d+)$/.exec(interaction.customId);
    if (!m) return;
    const pedido = pedidos.pedido(Number(m[1]));
    if (!pedido || String(pedido.userId) !== String(interaction.user.id)) return noEsTuya(interaction);

    const nota = Number(interaction.fields.getRadioGroup("nota"));
    const r = plexResenas.guardar(pedido.guildId, interaction.user.id, {
        tipo: "movie",
        titulo: pedido.titulo,
        anio: pedido.anio,
        nota,
        texto: interaction.fields.getTextInputValue("texto") || "",
        spoilers: interaction.fields.getCheckbox("spoilers"),
        meGusta: interaction.fields.getCheckbox("megusta"),
    });
    if (!r.ok) return interaction.reply(efimero({ content: `❌ ${r.motivo}` }));

    pedidos.marcar(pedido.id, "puntuada");
    const texto = `✅ Reseñada ${plexResenas.estrellasTexto(nota)}`;
    if (interaction.message) await interaction.message.edit({ content: texto, embeds: [], components: [filaEditar(pedido)] });
    return interaction.reply(efimero({ content: "✅ Guardada." }));
}

module.exports = { handleButton, handleModal };
