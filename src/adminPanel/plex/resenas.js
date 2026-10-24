// ⭐ Reseñas de Plex en /paneladmin → 🎬 Plex (#571): activar los avisos por DM, el tope diario, el mínimo de votos de los
// rankings y borrar una reseña (también una oculta) con confirmación y auditoría. Los botones, modales y selectores de
// `paneladmin_plex_resenas…` llegan desde botones.js, modales.js y selects.js.
const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require("discord.js");
const plexResenas = require("../../systems/plexResenas");
const pedidos = require("../../systems/plexResenas/pedidos");
const guildSettings = require("../../systems/guildSettings");
const adminAudit = require("../../systems/adminAudit");
const { simpleModal, modalConCampos } = require("../common");

const PREFIJO = "paneladmin_plex_resenas";
const COLOR = 0xe5a00d;
const TTL_MS = 15 * 60 * 1000;
const MAX_OPCIONES = 25;
const RANGO = { diaria: { min: 1, max: 20 }, votos: { min: 1, max: 20 } };

// Lo que espera una confirmación (o una elección de la lista): token → objetivo. El customId solo lleva el token, que cabe
// siempre en los 100 caracteres de Discord aunque el título sea largo.
const pendientes = new Map();

function guardarPendiente(objetivo) {
    const ahora = Date.now();
    for (const [token, p] of pendientes) if (p.expira < ahora) pendientes.delete(token);
    const token = crypto.randomBytes(6).toString("hex");
    pendientes.set(token, { ...objetivo, expira: ahora + TTL_MS });
    return token;
}

function pendiente(token) {
    const p = pendientes.get(token);
    return p && p.expira >= Date.now() ? p : null;
}

const numero = (n) => n.toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const recorte = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

/** La pantalla: los avisos, los dos ajustes de los rankings y el aviso, con los contadores que cuadran con la BD. */
function buildResenasAdmin(guildId) {
    const { plex } = guildSettings.getSettings(guildId);
    const activo = Boolean(plex.resenas_activo);
    const cuenta = plexResenas.resumenAdmin(guildId);
    const embed = new EmbedBuilder()
        .setTitle("⭐ Reseñas de Plex")
        .setDescription(
            `Avisos por DM: **${activo ? "activados" : "desactivados"}**${activo ? "" : " (no se manda ninguno)"}\n` +
                `Tope diario por persona: **${Number(plex.resenas_max_dia) || pedidos.MAX_DIA}**\n` +
                `Mínimo de votos para los rankings: **${Number(plex.resenas_min_votos) || 3}**\n\n` +
                `Reseñas: **${cuenta.total}** (${cuenta.ocultas} ocultas) · media **${cuenta.media === null ? "sin reseñas" : numero(cuenta.media)}**\n` +
                `Avisos esperando respuesta: **${cuenta.pendientes}**`,
        )
        .setFooter({ text: "Los números cuentan todas las reseñas del servidor, también las ocultas." })
        .setColor(COLOR);
    const fila1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${PREFIJO}_toggle`)
            .setLabel(activo ? "🔕 Desactivar avisos" : "🔔 Activar avisos")
            .setStyle(activo ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIJO}_max_dia`).setLabel("📆 Tope diario").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIJO}_min_votos`).setLabel("🔢 Mínimo de votos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIJO}_borrar`).setLabel("🗑️ Borrar reseña").setStyle(ButtonStyle.Danger),
    );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(PREFIJO).setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_plex_home").setLabel("◀ Plex").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [fila1, nav] };
}

/** Activa o desactiva los avisos. Al activar, `desde` es ahora: lo que la gente vio antes no se le pregunta (sin backfill). */
async function alternarAvisos(interaction, guildId) {
    const antes = Boolean(guildSettings.getSettings(guildId).plex.resenas_activo);
    const ahora = !antes;
    guildSettings.setSetting(guildId, "plex.resenas_activo", ahora);
    const details = { antes, ahora };
    if (ahora) {
        const desde = Math.floor(Date.now() / 1000);
        guildSettings.setSetting(guildId, "plex.resenas_desde", desde);
        details.desde = desde;
    }
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "plex.resenas.activo", details });
    await interaction.update(buildResenasAdmin(guildId));
    return true;
}

/** Un ajuste numérico con su rango: el modal lo pide y aquí se valida y se audita. */
function modalLimite(clave, titulo, etiqueta, rango, actual) {
    return simpleModal(`${PREFIJO}_${clave}_modal`, titulo, [
        { id: "cantidad", label: `${etiqueta} (${rango.min} a ${rango.max})`, maxLength: 3, value: String(actual) },
    ]);
}

async function guardarLimite(interaction, { clave, ajuste, nombre, rango }) {
    const guildId = interaction.guildId;
    const texto = interaction.fields.getTextInputValue("cantidad").trim();
    const valor = Number(texto);
    if (!/^\d+$/.test(texto) || valor < rango.min || valor > rango.max) {
        await interaction.reply({
            content: `❌ ${nombre}: un número entero de ${rango.min} a ${rango.max}.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    const antes = Number(guildSettings.getSettings(guildId).plex[ajuste]) || null;
    guildSettings.setSetting(guildId, `plex.${ajuste}`, valor);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: `plex.resenas.${clave}`,
        details: { antes, ahora: valor },
    });
    await interaction.reply({ content: `✅ ${nombre}: **${valor}**.`, flags: MessageFlags.Ephemeral });
    return true;
}

/** El nombre con el que se ve a quien escribió la reseña en la lista de la moderación. */
function autorDe(interaction, userId) {
    return interaction.guild?.members?.cache?.get(userId)?.displayName || `ID ${userId}`;
}

/** Busca las reseñas de un título (con año si se da, también las ocultas) y deja elegir una. */
async function buscarParaBorrar(interaction) {
    const guildId = interaction.guildId;
    const titulo = interaction.fields.getTextInputValue("titulo").trim();
    const anioTexto = interaction.fields.getTextInputValue("anio").trim();
    if (anioTexto && !/^\d{4}$/.test(anioTexto)) {
        await interaction.reply({ content: "❌ El año tiene que ser de cuatro cifras, o déjalo vacío.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const filas = plexResenas.todasDelTitulo(guildId, titulo, anioTexto ? Number(anioTexto) : null);
    if (!filas.length) {
        await interaction.reply({ content: `No hay reseñas de «${titulo}» en el servidor.`, flags: MessageFlags.Ephemeral });
        return true;
    }
    const opciones = filas.slice(0, MAX_OPCIONES).map((r) => {
        const autor = autorDe(interaction, r.userId);
        return {
            label: recorte(`${autor} · ${numero(r.nota / 2)}★${r.oculto ? " · oculta" : ""}`, 100),
            description: recorte(`${r.titulo}${r.anio ? ` (${r.anio})` : ""}`, 100),
            value: guardarPendiente({ guildId, userId: r.userId, clave: r.clave, titulo: r.titulo, anio: r.anio, autor }),
        };
    });
    const aviso = filas.length > MAX_OPCIONES ? ` Se muestran ${MAX_OPCIONES} de ${filas.length}: pon el año para afinar.` : "";
    const lista = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIJO}_pick`)
        .setPlaceholder("Elige la reseña que quieres borrar")
        .addOptions(opciones);
    await interaction.reply({
        content: `Reseñas de «${titulo}»: elige una.${aviso}`,
        components: [new ActionRowBuilder().addComponents(lista)],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

/** Muestra la reseña elegida y pide confirmación; el token viaja en los botones. */
async function elegirParaBorrar(interaction, token) {
    const p = pendiente(token);
    if (!p || p.guildId !== interaction.guildId) {
        await interaction.update({ content: "Esa elección ha caducado. Vuelve a empezar desde ⭐ Reseñas.", embeds: [], components: [] });
        return true;
    }
    const r = plexResenas.todasDelTitulo(p.guildId, p.titulo, p.anio).find((f) => f.userId === p.userId && f.clave === p.clave);
    if (!r) {
        await interaction.update({ content: "Esa reseña ya no existe.", embeds: [], components: [] });
        return true;
    }
    const embed = new EmbedBuilder()
        .setTitle(`¿Borrar la reseña de ${p.autor}?`)
        .setDescription(
            `**${r.titulo}**${r.anio ? ` (${r.anio})` : ""} · ${numero(r.nota / 2)}★${r.oculto ? " · oculta" : ""}` +
                `${r.spoilers ? " · ⚠️ spoilers" : ""}\n\n${r.texto ? recorte(r.texto, 300) : "_Sin texto_"}`,
        )
        .setColor(COLOR);
    const botones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}_si_${token}`).setLabel("🗑️ Sí, borrarla").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIJO}_no`).setLabel("✖️ Cancelar").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ content: "", embeds: [embed], components: [botones] });
    return true;
}

/** Borra la reseña elegida y lo deja en la auditoría. El token solo vale una vez. */
async function confirmarBorrado(interaction, token) {
    const p = pendiente(token);
    pendientes.delete(token);
    if (!p || p.guildId !== interaction.guildId) {
        await interaction.update({ content: "Esa confirmación ha caducado.", embeds: [], components: [] });
        return true;
    }
    const borrada = plexResenas.borrar(p.guildId, p.userId, p.clave);
    if (borrada) {
        adminAudit.logAdminAction({
            guildId: p.guildId,
            actorId: interaction.user.id,
            action: "plex.resena_borrar",
            details: { clave: p.clave, autorId: p.userId, titulo: p.titulo },
        });
    }
    await interaction.update({ content: borrada ? "🗑️ Reseña borrada." : "No queda nada que borrar.", embeds: [], components: [] });
    return true;
}

/** Botones de ⭐ Reseñas. Devuelve false si el botón no es suyo. */
async function handleResenasButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    if (id === PREFIJO) {
        await interaction.update(buildResenasAdmin(guildId));
        return true;
    }
    if (id === `${PREFIJO}_toggle`) return alternarAvisos(interaction, guildId);
    if (id === `${PREFIJO}_max_dia`) {
        const actual = guildSettings.getSettings(guildId).plex.resenas_max_dia || pedidos.MAX_DIA;
        await interaction.showModal(modalLimite("max_dia", "Tope diario de reseñas", "Avisos por persona y día", RANGO.diaria, actual));
        return true;
    }
    if (id === `${PREFIJO}_min_votos`) {
        const actual = guildSettings.getSettings(guildId).plex.resenas_min_votos || 3;
        await interaction.showModal(modalLimite("min_votos", "Mínimo de votos", "Reseñas para salir en los rankings", RANGO.votos, actual));
        return true;
    }
    if (id === `${PREFIJO}_borrar`) {
        await interaction.showModal(
            modalConCampos(`${PREFIJO}_borrar_modal`, "Borrar una reseña", [
                { id: "titulo", label: "Título", maxLength: 100 },
                { id: "anio", label: "Año (si hay varios con ese nombre)", required: false, maxLength: 4 },
            ]),
        );
        return true;
    }
    if (id.startsWith(`${PREFIJO}_si_`)) return confirmarBorrado(interaction, id.slice(`${PREFIJO}_si_`.length));
    if (id === `${PREFIJO}_no`) {
        await interaction.update({ content: "Cancelado.", embeds: [], components: [] });
        return true;
    }
    return false;
}

/** Modales de ⭐ Reseñas. */
async function handleResenasModal(interaction) {
    const id = interaction.customId;
    if (id === `${PREFIJO}_max_dia_modal`) {
        return guardarLimite(interaction, { clave: "max_dia", ajuste: "resenas_max_dia", nombre: "Tope diario", rango: RANGO.diaria });
    }
    if (id === `${PREFIJO}_min_votos_modal`) {
        return guardarLimite(interaction, {
            clave: "min_votos",
            ajuste: "resenas_min_votos",
            nombre: "Mínimo de votos",
            rango: RANGO.votos,
        });
    }
    if (id === `${PREFIJO}_borrar_modal`) return buscarParaBorrar(interaction);
    return false;
}

/** El selector de la lista de reseñas a borrar. */
async function handleResenasPick(interaction) {
    if (interaction.customId !== `${PREFIJO}_pick`) return false;
    return elegirParaBorrar(interaction, interaction.values[0]);
}

module.exports = { PREFIJO, buildResenasAdmin, handleResenasButton, handleResenasModal, handleResenasPick };
