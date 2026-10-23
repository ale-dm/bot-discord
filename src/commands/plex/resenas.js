// ⭐ Botones, formulario y moderación de las reseñas (#566, #567 y #568). Se llaman desde commands/plex/plex.js.
const { MessageFlags } = require("discord.js");
const plexResenas = require("../../systems/plexResenas");
const pedidos = require("../../systems/plexResenas/pedidos");
const guildSettings = require("../../systems/guildSettings");
const avisosDm = require("../../systems/avisosDm");
const { logAdminAction } = require("../../systems/adminAudit");
const { formularioResena, filaEditar } = require("../../discord/mensajes/resena");
const { pantallaResenas, pantallaTitulo, esAdmin } = require("../../paneles/plexResenas");
const { pantallaPlex } = require("../../paneles/plex");
const { efimero } = require("../../discord/respuestas");

const noEsTuya = (interaction) => interaction.reply(efimero({ content: "Esta reseña no es tuya." }));

// ─── La pantalla de /plex → ⭐ Reseñas (#567) ───────────────────────────────
async function handlePantalla(client, interaction) {
    const { customId: id, guildId, user } = interaction;
    const userId = user.id;
    if (id === "plex_resenas") return interaction.update(pantallaResenas(guildId, userId));
    if (id === "plex_resenas_inicio") return interaction.update(pantallaPlex(guildId, userId));
    if (["plex_resenas_mias", "plex_resenas_ultimas", "plex_resenas_mejores"].includes(id))
        return interaction.update(pantallaResenas(guildId, userId, id.slice("plex_resenas_".length)));
    if (id === "plex_resenas_ocultar") {
        plexResenas.setOculto(guildId, userId, !plexResenas.oculto(guildId, userId));
        return interaction.update(pantallaResenas(guildId, userId));
    }
    if (id.startsWith("plex_resenas_pag_")) {
        const [, , , vista, pagina] = id.split("_");
        return interaction.update(pantallaResenas(guildId, userId, vista, Number(pagina)));
    }
    if (id.startsWith("plex_resenas_ver_"))
        return interaction.update(pantallaTitulo(guildId, userId, id.slice("plex_resenas_ver_".length)));
    if (id.startsWith("plex_resenas_puntuar_")) return abrirModal(interaction, id.slice("plex_resenas_puntuar_".length));
    if (id.startsWith("plex_resenas_borrar_")) return borrar(interaction, id.slice("plex_resenas_borrar_".length));
    if (id.startsWith("plex_resenas_reportar_")) return reportar(client, interaction, id.slice("plex_resenas_reportar_".length));
}

function abrirModal(interaction, clave) {
    const { guildId, user } = interaction;
    const mia = plexResenas.de(guildId, user.id, clave);
    const base = mia || plexResenas.titulo(guildId, clave).resenas[0];
    if (!base) return interaction.reply(efimero({ content: "❌ No encuentro ese título." }));
    return interaction.showModal(
        formularioResena({ titulo: base.titulo, anio: base.anio }, mia, null, `plex_modal_resena_titulo_${clave}`),
    );
}

async function borrar(interaction, clave) {
    const { guildId, user } = interaction;
    const mia = plexResenas.de(guildId, user.id, clave);
    if (mia) {
        plexResenas.borrar(guildId, user.id, clave);
        return interaction.update(pantallaTitulo(guildId, user.id, clave, "🗑️ Reseña borrada."));
    }
    if (!esAdmin(guildId, user.id)) return noEsTuya(interaction);
    const ajena = plexResenas.titulo(guildId, clave).resenas[0];
    if (!ajena) return interaction.update(pantallaTitulo(guildId, user.id, clave, "No queda nada que borrar."));
    plexResenas.borrar(guildId, ajena.userId, clave);
    logAdminAction({ guildId, actorId: user.id, action: "plex.resena_borrar", details: { clave, autorId: ajena.userId } });
    return interaction.update(pantallaTitulo(guildId, user.id, clave, "🗑️ Reseña borrada."));
}

async function reportar(client, interaction, clave) {
    const { guildId, user } = interaction;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = plexResenas.titulo(guildId, clave);
    const titulo = t.resenas[0]?.titulo || clave;
    const lineas = t.resenas.slice(0, 5).map((r) => `<@${r.userId}>: ${r.texto || "(sin texto)"}`);
    const contenido = `🚩 **Reseña reportada**\n**${titulo}**\n\n${lineas.join("\n")}\n\nLa ha reportado <@${user.id}>.`;
    const ids = String(guildSettings.getSettings(guildId).alertas.admin_ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (!ids.length) return interaction.editReply({ content: "⚠️ No hay admins configurados para recibir el reporte." });
    let enviados = 0;
    for (const id of ids) if (await avisosDm.sendDm(client, id, { content: contenido, allowedMentions: { parse: [] } })) enviados++;
    return interaction.editReply({
        content: enviados ? "🚩 Reportado. Lo verán los admins." : "⚠️ No se pudo avisar a los admins (¿DMs cerrados?).",
    });
}

// ─── El DM (#566) ───────────────────────────────────────────────────────────
async function handleDm(interaction) {
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

// ─── Formularios ────────────────────────────────────────────────────────────
async function guardarTitulo(interaction) {
    const clave = interaction.customId.slice("plex_modal_resena_titulo_".length);
    const { guildId, user } = interaction;
    const mia = plexResenas.de(guildId, user.id, clave);
    const base = mia || plexResenas.titulo(guildId, clave).resenas[0];
    if (!base) return interaction.reply(efimero({ content: "❌ No encuentro ese título." }));
    const r = plexResenas.guardar(guildId, user.id, {
        tipo: clave.startsWith("serie:") ? "show" : "movie",
        titulo: base.titulo,
        anio: base.anio,
        nota: Number(interaction.fields.getRadioGroup("nota")),
        texto: interaction.fields.getTextInputValue("texto") || "",
        spoilers: interaction.fields.getCheckbox("spoilers"),
        meGusta: interaction.fields.getCheckbox("megusta"),
    });
    if (!r.ok) return interaction.reply(efimero({ content: `❌ ${r.motivo}` }));
    return interaction.update(pantallaTitulo(guildId, user.id, clave, "✅ Guardada."));
}

async function handleModal(interaction) {
    if (interaction.customId.startsWith("plex_modal_resena_titulo_")) return guardarTitulo(interaction);
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

async function handleButton(client, interaction) {
    if (interaction.customId === "plex_resenas" || interaction.customId.startsWith("plex_resenas_"))
        return handlePantalla(client, interaction);
    return handleDm(interaction);
}

module.exports = { handleButton, handleModal };
