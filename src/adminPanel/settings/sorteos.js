// ⚙️ Config Global → 🎁 Sorteos (#541): crear sorteos de dinero u objeto con requisitos, ver los activos y
// cancelarlos. La creación va en dos pasos (publicación y requisitos) para no pasar de los 5 campos de un modal.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const sorteos = require("../../systems/sorteos");
const adminAudit = require("../../systems/adminAudit");
const { modalConCampos, canalElegido, opcionElegida, rolesElegidos } = require("../common");
const { navRow } = require("./vistas");
const { buildSorteo } = require("../../paneles/sorteo");

// Borradores del primer paso (canal, premio y duración) hasta que el admin elige los requisitos.
const borradores = new Map();
const clave = (guildId, userId) => `${guildId}:${userId}`;

const premioDe = (s) => (s.premioTipo === "dinero" ? `${Number(s.premioValor).toLocaleString("es")} 🪙` : s.premioNombre);

function buildSorteosPanel(guildId) {
    const activos = sorteos.activos(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🎁 Sorteos")
        .setDescription(
            "Crea un sorteo y el bot publica el mensaje con el botón de entrar. Al terminar el plazo elige ganadores " +
                "entre quienes sigan cumpliendo los requisitos, reparte el premio y avisa por DM.",
        )
        .addFields({
            name: "Activos",
            value: activos.length
                ? activos
                      .slice(0, 8)
                      .map(
                          (s) =>
                              `**#${s.id}** · ${premioDe(s)} · ${sorteos.cuentaParticipantes(s.id)} participantes · <#${s.channelId}> · termina <t:${Math.floor(s.fin / 1000)}:R>`,
                      )
                      .join("\n")
                : "Ninguno.",
        })
        .setColor(0xf1c40f);
    const filaNuevo = [
        new ButtonBuilder().setCustomId("paneladmin_cfg_sorteos_new").setLabel("➕ Nuevo sorteo").setStyle(ButtonStyle.Primary),
    ];
    const filas = [new ActionRowBuilder().addComponents(...filaNuevo)];
    // Un botón de cancelar por sorteo activo, en filas de 5 (el nuevo ya ocupa el suyo).
    const botonesCancelar = activos.map((s) =>
        new ButtonBuilder()
            .setCustomId(`paneladmin_cfg_sorteos_cancel_${s.id}`)
            .setLabel(`🛑 Cancelar #${s.id}`)
            .setStyle(ButtonStyle.Danger),
    );
    for (let i = 0; i < botonesCancelar.length && filas.length < 5; i += 5) {
        filas.push(new ActionRowBuilder().addComponents(...botonesCancelar.slice(i, i + 5)));
    }
    return { embeds: [embed], components: [...filas, navRow()], allowedMentions: { parse: [] } };
}

async function abrirModalNuevo(interaction) {
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_sorteos_new_modal", "Nuevo sorteo", [
            { id: "canal", label: "Canal del sorteo", tipo: "canal" },
            {
                id: "tipo",
                label: "Tipo de premio",
                tipo: "opciones",
                opciones: [
                    { label: "Dinero", value: "dinero" },
                    { label: "Objeto del catálogo", value: "objeto" },
                ],
                valor: "dinero",
            },
            { id: "premio", label: "Premio (monedas o nombre del objeto)", maxLength: 100 },
            { id: "horas", label: "Duración (horas, 1 a 168)", value: "24" },
        ]),
    );
    return true;
}

async function guardarNuevo(interaction, id, guildId) {
    const horas = Number(interaction.fields.getTextInputValue("horas").trim());
    const premio = interaction.fields.getTextInputValue("premio").trim();
    const canal = canalElegido(interaction.fields, "canal");
    if (!canal || !premio || !Number.isInteger(horas) || horas < 1 || horas > sorteos.MAX_HORAS) {
        await interaction.reply({
            content: "❌ Elige un canal, escribe el premio y una duración de 1 a 168 horas.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    borradores.set(clave(guildId, interaction.user.id), {
        guildId,
        channelId: canal,
        tipo: opcionElegida(interaction.fields, "tipo") || "dinero",
        premio,
        horas,
    });
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("paneladmin_cfg_sorteos_draft_ok")
            .setLabel("✅ Publicar sin requisitos")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cfg_sorteos_draft_req").setLabel("🎯 Añadir requisitos").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_sorteos_draft_cancel").setLabel("❌ Cancelar").setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
        content: `🎁 **${premio}** durante **${horas} h**. ¿Quieres exigir rol o nivel, o lo publicas ya?`,
        components: [fila],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function abrirModalRequisitos(interaction, guildId) {
    if (!borradores.has(clave(guildId, interaction.user.id))) {
        await interaction.reply({ content: "❌ Ese borrador ya no existe: empieza otra vez.", flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.showModal(
        modalConCampos("paneladmin_cfg_sorteos_req_modal", "Requisitos del sorteo", [
            { id: "ganadores", label: "Ganadores (1 a 5)", value: "1" },
            { id: "nivel", label: "Nivel mínimo (0 = ninguno)", value: "0" },
            { id: "rol", label: "Rol requerido (opcional)", tipo: "rol", required: false },
        ]),
    );
    return true;
}

/** Resuelve el premio del borrador: monedas o un objeto del catálogo. */
function resolverPremio(draft) {
    if (draft.tipo === "dinero") {
        const valor = Number(draft.premio);
        if (!Number.isInteger(valor) || valor < 1) {
            return { ok: false, motivo: "El premio en dinero tiene que ser un número entero de monedas." };
        }
        return { ok: true, valor, nombre: valor.toLocaleString("es") };
    }
    const obj = sorteos.objetoPorNombre(draft.premio);
    if (!obj) return { ok: false, motivo: "No hay ningún objeto con ese nombre en el catálogo." };
    return { ok: true, valor: obj.id, nombre: obj.nombre };
}

/** Resuelve el premio, crea el sorteo y publica el mensaje. `req` = { ganadores, nivel, rolId }. */
async function publicar(interaction, guildId, req) {
    const draft = borradores.get(clave(guildId, interaction.user.id));
    if (!draft) {
        await interaction.reply({ content: "❌ Ese borrador ya no existe: empieza otra vez.", flags: MessageFlags.Ephemeral });
        return true;
    }
    const premio = resolverPremio(draft);
    if (!premio.ok) {
        await interaction.reply({ content: `❌ ${premio.motivo}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    const channel = await interaction.client.channels.fetch(draft.channelId).catch(() => null);
    if (!channel) {
        await interaction.reply({ content: "❌ No encuentro ese canal. ¿Sigue existiendo?", flags: MessageFlags.Ephemeral });
        return true;
    }
    const r = sorteos.crear({
        guildId,
        channelId: draft.channelId,
        premioTipo: draft.tipo,
        premioValor: premio.valor,
        premioNombre: premio.nombre,
        ganadores: req.ganadores,
        rolId: req.rolId,
        nivel: req.nivel,
        horas: draft.horas,
        creadorId: interaction.user.id,
    });
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.motivo}`, flags: MessageFlags.Ephemeral });
        return true;
    }
    const mensaje = await channel.send(buildSorteo(r.sorteo, { participantes: 0 }));
    sorteos.guardarMensaje(r.sorteo.id, mensaje.id);
    adminAudit.logAdminAction({
        guildId,
        actorId: interaction.user.id,
        action: "sorteos.crear",
        details: { id: r.sorteo.id, premio: `${r.sorteo.premioTipo}:${r.sorteo.premioNombre}`, ganadores: req.ganadores },
    });
    borradores.delete(clave(guildId, interaction.user.id));
    const enlace = `https://discord.com/channels/${guildId}/${draft.channelId}/${mensaje.id}`;
    await interaction.reply({ content: `✅ Sorteo #${r.sorteo.id} publicado: ${enlace}`, flags: MessageFlags.Ephemeral });
    return true;
}

async function publicarSinRequisitos(interaction, guildId) {
    return publicar(interaction, guildId, { ganadores: 1, nivel: 0, rolId: "" });
}

async function guardarRequisitos(interaction, id, guildId) {
    const ganadores = Number(interaction.fields.getTextInputValue("ganadores").trim());
    const nivel = Number(interaction.fields.getTextInputValue("nivel").trim());
    const rolId = rolesElegidos(interaction.fields, "rol")[0] || "";
    if (!Number.isInteger(ganadores) || ganadores < 1 || ganadores > sorteos.MAX_GANADORES || !Number.isInteger(nivel) || nivel < 0) {
        await interaction.reply({
            content: `❌ Ganadores de 1 a ${sorteos.MAX_GANADORES} y nivel 0 o más (enteros).`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    return publicar(interaction, guildId, { ganadores, nivel, rolId });
}

async function cancelarBorrador(interaction, guildId) {
    borradores.delete(clave(guildId, interaction.user.id));
    await interaction.update({ content: "❌ Sorteo descartado.", components: [], embeds: [] });
    return true;
}

async function cancelarSorteo(interaction, guildId, sorteoId) {
    const s = sorteos.cancelar(sorteoId);
    if (!s) {
        await interaction.reply({ content: "❌ Ese sorteo ya no está activo.", flags: MessageFlags.Ephemeral });
        return true;
    }
    adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "sorteos.cancelar", details: { id: s.id } });
    const channel = await interaction.client.channels.fetch(s.channelId).catch(() => null);
    let mensaje = null;
    if (channel && s.messageId) mensaje = await channel.messages.fetch(s.messageId).catch(() => null);
    if (mensaje) {
        try {
            await mensaje.edit(
                buildSorteo(s, { participantes: sorteos.cuentaParticipantes(s.id), aviso: "🛑 Cancelado por un admin.", terminado: true }),
            );
        } catch {
            // El mensaje pudo borrarse: el sorteo ya está cancelado y la auditoría hecha.
        }
    }
    await interaction.update(buildSorteosPanel(guildId));
    return true;
}

module.exports = {
    buildSorteosPanel,
    abrirModalNuevo,
    guardarNuevo,
    abrirModalRequisitos,
    guardarRequisitos,
    publicarSinRequisitos,
    cancelarBorrador,
    cancelarSorteo,
};
