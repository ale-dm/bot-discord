// 🔊 Ajustes de los sonidos en /paneladmin: volumen (#328), categoría (#325) y roles (#329) de cada sonido, el horario de silencio
// (#330), el sonido de cada evento del bot (#326) y los más usados (#297). Lo básico (subir, probar, editar, borrar) está en
// adminPanel/sonidos.js, que reparte aquí lo que no es suyo.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const sonidos = require("../systems/sonidos");
const ajustes = require("../systems/sonidos/ajustes");
const silencio = require("../systems/sonidos/silencio");
const eventos = require("../systems/sonidos/eventos");
const guildSettings = require("../systems/guildSettings");
const { createLogger } = require("../core/logger");
const { modalConCampos, rolesElegidos, SI_NO_NUMERICO } = require("./common");

const log = createLogger("PanelAdmin").child("Sonidos");
const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });
const CAMBIOS_DE_SONIDO = /^paneladmin_sonidos_(volumen|categoria|roles)_(\d+)$/;
const MODAL_DE_SONIDO = /^paneladmin_sonidos_modal_(volumen|categoria|roles)_(\d+)$/;

const filaVolver = () =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_sonidos_home").setLabel("◀ Volver a sonidos").setStyle(ButtonStyle.Secondary),
    );

/** Los botones de ajustes de un sonido, para la pantalla de editar. */
const botonesDeAjustes = (sonido) => [
    new ButtonBuilder().setCustomId(`paneladmin_sonidos_volumen_${sonido.id}`).setLabel("🔉 Volumen").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`paneladmin_sonidos_categoria_${sonido.id}`).setLabel("🏷️ Categoría").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`paneladmin_sonidos_roles_${sonido.id}`).setLabel("👥 Roles").setStyle(ButtonStyle.Secondary),
];

/** Lo que ya tiene un sonido, para el texto de la pantalla de editar. */
function resumenDeSonido(sonido) {
    const roles = ajustes.rolesDe(sonido.id);
    return (
        `Volumen: **${sonido.volumen} %** · Categoría: **${sonido.categoria || ajustes.SIN_CATEGORIA}** · ` +
        `Roles: ${roles.length ? roles.map((r) => `<@&${r}>`).join(", ") : "**todos**"} · Reproducciones: **${sonido.reproducciones}**`
    );
}

const modalVolumen = (sonido) =>
    modalConCampos(`paneladmin_sonidos_modal_volumen_${sonido.id}`, "🔉 Volumen del sonido", [
        {
            id: "volumen",
            label: `Volumen (${ajustes.VOLUMEN_MIN} a ${ajustes.VOLUMEN_MAX} %)`,
            placeholder: "100 es el original",
            value: String(sonido.volumen),
            maxLength: 3,
        },
    ]);

const modalCategoria = (sonido) =>
    modalConCampos(`paneladmin_sonidos_modal_categoria_${sonido.id}`, "🏷️ Categoría del sonido", [
        {
            id: "categoria",
            label: "Categoría (vacía = sin categoría)",
            placeholder: "memes, ambiente, reacciones…",
            value: sonido.categoria || "",
            required: false,
            maxLength: ajustes.CATEGORIA_MAX,
        },
    ]);

const modalRoles = (sonido) =>
    modalConCampos(`paneladmin_sonidos_modal_roles_${sonido.id}`, "👥 Quién puede usarlo", [
        {
            tipo: "rol",
            id: "roles",
            label: "Roles (ninguno = todo el mundo)",
            multiple: true,
            required: false,
            valores: ajustes.rolesDe(sonido.id),
        },
    ]);

function modalHorario(guildId) {
    const cfg = guildSettings.getSettings(guildId).sonidos;
    return modalConCampos("paneladmin_sonidos_modal_horario", "🌙 Horario de silencio", [
        {
            id: "desde",
            label: "Silencio desde (HH:MM, hora de Madrid)",
            placeholder: "00:00",
            value: cfg.silencio_desde,
            required: false,
            maxLength: 5,
        },
        { id: "hasta", label: "Hasta (HH:MM)", placeholder: "08:00", value: cfg.silencio_hasta, required: false, maxLength: 5 },
        { tipo: "radio", id: "apagado", label: "Sonidos apagados del todo", opciones: SI_NO_NUMERICO, valor: cfg.apagado ? "1" : "0" },
    ]);
}

const modalIntervalo = (guildId) =>
    modalConCampos("paneladmin_sonidos_modal_intervalo", "⏱️ Intervalo de los eventos", [
        {
            id: "minutos",
            label: "Minutos entre dos sonidos del mismo evento",
            value: String(guildSettings.getSettings(guildId).sonidos.eventos_minutos),
            maxLength: 4,
        },
    ]);

/** El estado del silencio, en una línea. */
function lineaSilencio(cfg) {
    if (cfg.apagado) return "🌙 Sonidos **apagados** del todo.";
    const horario = silencio.validarHorario(cfg.silencio_desde, cfg.silencio_hasta);
    return horario.ok && horario.desde
        ? `🌙 En silencio de **${horario.desde}** a **${horario.hasta}** (hora de Madrid).`
        : "🌙 Sin horario de silencio.";
}

/** La pantalla de eventos: qué sonido tiene cada uno, y los botones para asignarlo o quitarlo. */
function buildEventos(guildId) {
    const tienen = new Map(eventos.asociados(guildId).map((e) => [e.evento, e.nombre]));
    const minutos = guildSettings.getSettings(guildId).sonidos.eventos_minutos;
    const embed = new EmbedBuilder()
        .setTitle("🔔 Sonidos de eventos")
        .setColor(0x9b59b6)
        .setDescription(
            "Un evento hace sonar su sonido solo si el bot está en un canal de voz por /conectar y no suena otro sonido.\n\n" +
                Object.entries(eventos.EVENTOS)
                    .map(([evento, etiqueta]) => `${etiqueta}: ${tienen.has(evento) ? `🔊 **${tienen.get(evento)}**` : "sin sonido"}`)
                    .join("\n") +
                `\n\n⏱️ Como mucho una vez cada **${minutos}** min por evento.`,
        );
    const asignar = Object.entries(eventos.EVENTOS).map(([evento, etiqueta]) =>
        new ButtonBuilder()
            .setCustomId(`paneladmin_sonidos_evento_${evento}`)
            .setLabel(`Sonido: ${etiqueta.split(" (")[0]}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary),
    );
    const quitar = Object.keys(eventos.EVENTOS).map((evento) =>
        new ButtonBuilder()
            .setCustomId(`paneladmin_sonidos_evento_quitar_${evento}`)
            .setLabel(`🗑️ Quitar: ${eventos.EVENTOS[evento].split(" (")[0]}`.slice(0, 80))
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!tienen.has(evento)),
    );
    const intervalo = new ButtonBuilder()
        .setCustomId("paneladmin_sonidos_intervalo")
        .setLabel("⏱️ Intervalo")
        .setStyle(ButtonStyle.Secondary);
    return {
        content: "",
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(...asignar, intervalo),
            new ActionRowBuilder().addComponents(...quitar),
            filaVolver(),
        ],
    };
}

/** Los sonidos más usados del servidor. */
function buildRanking(guildId) {
    const embed = new EmbedBuilder().setTitle("📊 Sonidos más usados").setColor(0x3498db).setDescription(ajustes.textoRanking(guildId, 15));
    return { content: "", embeds: [embed], components: [filaVolver()] };
}

/** Los botones de ajustes que reparte adminPanel/sonidos.js. Devuelve la respuesta o null si no era de aquí. */
async function handleAjustesButton(interaction, buildHome, buildElegirEvento) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    const cambio = CAMBIOS_DE_SONIDO.exec(id);
    if (cambio) {
        const sonido = sonidos.obtener(guildId, cambio[2]);
        if (!sonido) return interaction.update({ ...buildHome(guildId), content: "Ese sonido ya no existe." });
        const modales = { volumen: modalVolumen, categoria: modalCategoria, roles: modalRoles };
        return interaction.showModal(modales[cambio[1]](sonido));
    }
    if (id === "paneladmin_sonidos_horario") return interaction.showModal(modalHorario(guildId));
    if (id === "paneladmin_sonidos_intervalo") return interaction.showModal(modalIntervalo(guildId));
    if (id === "paneladmin_sonidos_eventos") return interaction.update(buildEventos(guildId));
    if (id === "paneladmin_sonidos_ranking") return interaction.update(buildRanking(guildId));
    const quitar = /^paneladmin_sonidos_evento_quitar_(\w+)$/.exec(id);
    if (quitar) {
        if (eventos.quitar(guildId, quitar[1])) log.info(`${interaction.user.tag} quitó el sonido del evento ${quitar[1]} en ${guildId}`);
        return interaction.update(buildEventos(guildId));
    }
    const asignar = /^paneladmin_sonidos_evento_(\w+?)(?:_p_(\d+))?$/.exec(id);
    if (asignar && eventos.EVENTOS[asignar[1]]) return interaction.update(buildElegirEvento(guildId, asignar[1], Number(asignar[2] || 0)));
    return null;
}

/** Guarda el sonido elegido para un evento. */
async function asignarEvento(interaction, evento, sonidoId) {
    const guildId = interaction.guildId;
    const sonido = sonidos.obtener(guildId, sonidoId);
    if (!sonido) return interaction.update({ ...buildEventos(guildId), content: "Ese sonido ya no existe." });
    eventos.asociar(guildId, evento, sonido.id);
    log.info(`${interaction.user.tag} puso «${sonido.nombre}» al evento ${evento} en ${guildId}`);
    return interaction.update({ ...buildEventos(guildId), content: `✅ **${sonido.nombre}** suena con «${eventos.EVENTOS[evento]}».` });
}

/** Aplica el horario de silencio y el interruptor de apagado. */
async function guardarHorario(interaction) {
    const horario = silencio.validarHorario(interaction.fields.getTextInputValue("desde"), interaction.fields.getTextInputValue("hasta"));
    if (!horario.ok) return responder(interaction, `❌ ${horario.motivo}`);
    guildSettings.setManySettings(interaction.guildId, {
        "sonidos.silencio_desde": horario.desde,
        "sonidos.silencio_hasta": horario.hasta,
        "sonidos.apagado": interaction.fields.getRadioGroup("apagado") === "1",
    });
    log.info(`${interaction.user.tag} cambió el horario de silencio de los sonidos en ${interaction.guildId}`);
    return responder(interaction, `✅ ${lineaSilencio(guildSettings.getSettings(interaction.guildId).sonidos)}`);
}

function guardarIntervalo(interaction) {
    const texto = interaction.fields.getTextInputValue("minutos").trim();
    const minutos = Number(texto);
    if (!texto || !Number.isInteger(minutos) || minutos < 0 || minutos > 1440) {
        return responder(interaction, "❌ Escribe los minutos como un número entero entre 0 y 1440 (0 = sin espera).");
    }
    guildSettings.setSetting(interaction.guildId, "sonidos.eventos_minutos", minutos);
    return responder(interaction, `✅ Un evento suena como mucho cada ${minutos} min.`);
}

/** Los formularios de ajustes. Devuelve true si era de aquí. */
async function handleAjustesModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    if (id === "paneladmin_sonidos_modal_horario") {
        await guardarHorario(interaction);
        return true;
    }
    if (id === "paneladmin_sonidos_modal_intervalo") {
        await guardarIntervalo(interaction);
        return true;
    }
    const m = MODAL_DE_SONIDO.exec(id);
    if (!m) return false;
    const sonido = sonidos.obtener(guildId, m[2]);
    if (!sonido) {
        await responder(interaction, "❌ Ese sonido ya no existe.");
        return true;
    }
    if (m[1] === "roles") {
        const roles = rolesElegidos(interaction.fields, "roles");
        ajustes.fijarRoles(sonido.id, roles);
        await responder(
            interaction,
            roles.length
                ? `✅ **${sonido.nombre}** solo para ${roles.map((r) => `<@&${r}>`).join(", ")}.`
                : `✅ **${sonido.nombre}** vuelve a ser de todos.`,
        );
        return true;
    }
    const r =
        m[1] === "volumen"
            ? ajustes.fijarVolumen(guildId, sonido.id, interaction.fields.getTextInputValue("volumen"))
            : ajustes.fijarCategoria(guildId, sonido.id, interaction.fields.getTextInputValue("categoria"));
    if (!r.ok) await responder(interaction, `❌ ${r.motivo}`);
    else if (m[1] === "volumen") await responder(interaction, `✅ **${sonido.nombre}** suena al ${r.volumen} %.`);
    else
        await responder(
            interaction,
            r.categoria ? `✅ **${sonido.nombre}** está en «${r.categoria}».` : `✅ **${sonido.nombre}** sin categoría.`,
        );
    return true;
}

/** Una respuesta privada que no tumba el manejador si el token ya caducó. */
function responder(interaction, texto) {
    return interaction.reply(efimero(texto)).catch((e) => log.warn(`No pude responder en el panel de sonidos: ${e.message}`));
}

module.exports = {
    botonesDeAjustes,
    resumenDeSonido,
    lineaSilencio,
    buildEventos,
    buildRanking,
    handleAjustesButton,
    handleAjustesModal,
    asignarEvento,
    responder,
};
