// Panel admin → ⚙️ Config Global → 📣 Comunidad: los canales de las felicitaciones de cumpleaños (#427), de la bienvenida con su
// texto (#435) y del buzón de sugerencias (#428), y la revisión de las sugerencias pendientes (aceptarlas o descartarlas con un
// motivo opcional; quien las envió lo recibe por DM y la decisión queda en la auditoría). El botón 🎫 Tickets lleva a adminPanel/tickets.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const sugerencias = require("../systems/sugerencias");
const bienvenida = require("../systems/bienvenida");
const { repintar, avisarResultado } = require("../paneles/sugerencia");
const { modalConCampos, simpleModal, canalElegido } = require("./common");
const { createLogger } = require("../core/logger");

const log = createLogger("PanelAdmin");

const corto = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);
const canalTexto = (id) => (id ? `<#${id}>` : "Sin canal: no se publica nada");

function filaNavegacion() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_com_home").setLabel("📣 Comunidad").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
    );
}

function buildComunidadHome(guildId, aviso = "") {
    const cfg = guildSettings.getSettings(guildId);
    const pendientes = sugerencias.pendientes(guildId, 100).length;
    const embed = new EmbedBuilder()
        .setTitle("📣 Comunidad")
        .setColor(0x1abc9c)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Los avisos generales del servidor. Cada uno solo funciona con su canal elegido; sin canal, el bot no hace nada.",
        )
        .addFields(
            { name: "🎂 Cumpleaños", value: `Felicitaciones diarias en:\n${canalTexto(cfg.avisos.cumple_channel_id)}`, inline: true },
            {
                name: "👋 Bienvenida",
                value: `${canalTexto(cfg.bienvenida.canal_id)}\nTexto: ${cfg.bienvenida.texto ? `«${corto(cfg.bienvenida.texto, 120)}»` : "el de por defecto"}`,
                inline: true,
            },
            { name: "💡 Sugerencias", value: `${canalTexto(cfg.sugerencias.canal_id)}\nPendientes: **${pendientes}**`, inline: true },
            { name: "🎫 Tickets", value: cfg.tickets.canal_id ? `Hilos en <#${cfg.tickets.canal_id}>` : "Sin configurar", inline: true },
        )
        .setTimestamp();
    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_com_cumple").setLabel("🎂 Cumpleaños").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_com_bienvenida").setLabel("👋 Bienvenida").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_com_buzon").setLabel("💡 Canal del buzón").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_tic_home").setLabel("🎫 Tickets").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("paneladmin_com_revisar")
            .setLabel(`📋 Revisar sugerencias (${pendientes})`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(pendientes === 0),
    );
    return {
        content: "",
        embeds: [embed],
        components: [
            acciones,
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

/** Las sugerencias pendientes, con un desplegable para elegir una. */
function buildRevisar(guildId, aviso = "") {
    const lista = sugerencias.pendientes(guildId, 25);
    const embed = new EmbedBuilder()
        .setTitle("📋 Sugerencias pendientes")
        .setColor(0xf1c40f)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (lista.length
                    ? lista.map((s) => `**#${s.id}** · <@${s.userId}> · ${corto(s.texto.replace(/\s+/g, " "), 90)}`).join("\n")
                    : "No queda ninguna pendiente."),
        );
    const componentes = [];
    if (lista.length) {
        componentes.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("paneladmin_com_sug_sel")
                    .setPlaceholder("Elige una sugerencia")
                    .addOptions(
                        lista.map((s) => ({
                            label: `#${s.id}`.concat(" · ", corto(s.texto.replace(/\s+/g, " "), 80)),
                            value: String(s.id),
                        })),
                    ),
            ),
        );
    }
    componentes.push(filaNavegacion());
    return { content: "", embeds: [embed], components: componentes };
}

/** Una sugerencia con sus votos y los botones para decidir. */
function buildDetalle(s) {
    const m = sugerencias.marcador(s.id);
    const embed = new EmbedBuilder()
        .setTitle(`💡 Sugerencia #${s.id}`)
        .setColor(0xf1c40f)
        .setDescription(`${s.texto}\n\n**Enviada por** <@${s.userId}> · 👍 ${m.favor} · 👎 ${m.contra}`);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`paneladmin_com_sug_aceptada_${s.id}`).setLabel("✅ Aceptar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`paneladmin_com_sug_descartada_${s.id}`).setLabel("❌ Descartar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_com_revisar").setLabel("📋 Volver a la lista").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

const auditar = (interaction, action, details) =>
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });

/** Los ajustes que son solo un canal: su clave, su formulario y lo que se dice al guardarlos. */
const AJUSTES_CANAL = {
    cumple: {
        clave: "avisos.cumple_channel_id",
        titulo: "Cumpleaños",
        etiqueta: "Canal de felicitaciones",
        accion: "comunidad.cumple",
        con: (c) => `✅ Las felicitaciones saldrán en <#${c}>.`,
        sin: "🔕 Ya no se felicita.",
        actual: (cfg) => cfg.avisos.cumple_channel_id,
    },
    buzon: {
        clave: "sugerencias.canal_id",
        titulo: "Buzón de sugerencias",
        etiqueta: "Canal de las sugerencias",
        accion: "comunidad.buzon",
        con: (c) => `✅ Las sugerencias irán a <#${c}>.`,
        sin: "🔕 El buzón queda sin canal.",
        actual: (cfg) => cfg.sugerencias.canal_id,
    },
};

/** Abre el formulario de un ajuste de canal o el de la bienvenida (canal y texto). */
async function abrirFormulario(interaction, ajuste) {
    const cfg = guildSettings.getSettings(interaction.guildId);
    const canal = (id, etiqueta, valor) => ({ id, label: etiqueta, tipo: "canal", required: false, valor: valor || "" });
    if (ajuste === "bienvenida") {
        await interaction.showModal(
            modalConCampos("paneladmin_com_bienvenida_modal", "Bienvenida", [
                canal("canal", "Canal de bienvenida", cfg.bienvenida.canal_id),
                {
                    id: "texto",
                    label: "Texto ({usuario} y {miembros})",
                    paragraph: true,
                    required: false,
                    maxLength: bienvenida.MAX_TEXTO,
                    placeholder: "Vacío = el texto por defecto",
                    value: cfg.bienvenida.texto || "",
                },
            ]),
        );
        return;
    }
    const a = AJUSTES_CANAL[ajuste];
    await interaction.showModal(modalConCampos(`paneladmin_com_${ajuste}_modal`, a.titulo, [canal("canal", a.etiqueta, a.actual(cfg))]));
}

async function handleComunidadButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    if (id === "paneladmin_com_home") {
        await interaction.update(buildComunidadHome(guildId));
        return true;
    }
    const ajuste = id.replace(/^paneladmin_com_/, "");
    if (ajuste === "bienvenida" || AJUSTES_CANAL[ajuste]) {
        await abrirFormulario(interaction, ajuste);
        return true;
    }
    if (id === "paneladmin_com_revisar") {
        await interaction.update(buildRevisar(guildId));
        return true;
    }
    // paneladmin_com_sug_{aceptada|descartada}_{id}: el formulario del motivo (opcional).
    const m = /^paneladmin_com_sug_(aceptada|descartada)_(\d+)$/.exec(id);
    if (!m) return false;
    const s = sugerencias.obtener(m[2]);
    if (!s || s.estado !== "pendiente") {
        await interaction.update(buildRevisar(guildId, "Esa sugerencia ya está resuelta."));
        return true;
    }
    await interaction.showModal(
        simpleModal(`paneladmin_com_sugmodal_${m[1]}_${m[2]}`, m[1] === "aceptada" ? "Aceptar sugerencia" : "Descartar sugerencia", [
            { id: "motivo", label: "Motivo (opcional)", paragraph: true, required: false, maxLength: sugerencias.MAX_MOTIVO },
        ]),
    );
    return true;
}

async function handleComunidadStringSelect(interaction) {
    if (interaction.customId !== "paneladmin_com_sug_sel") return false;
    const s = sugerencias.obtener(interaction.values[0]);
    if (!s || s.estado !== "pendiente") {
        await interaction.update(buildRevisar(interaction.guildId, "Esa sugerencia ya está resuelta."));
        return true;
    }
    await interaction.update(buildDetalle(s));
    return true;
}

/** Tras guardar un ajuste: repinta la pantalla si el formulario salió de ella, o la manda aparte. */
async function responder(interaction, payload) {
    if (interaction.isFromMessage?.()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Guarda el canal de un ajuste, lo deja en la auditoría y repinta el panel. */
async function guardarCanal(interaction, a) {
    const canal = canalElegido(interaction.fields, "canal");
    guildSettings.setSetting(interaction.guildId, a.clave, canal);
    auditar(interaction, a.accion, { canal: canal || null });
    await responder(interaction, buildComunidadHome(interaction.guildId, canal ? a.con(canal) : a.sin));
}

/** La decisión de un admin sobre una sugerencia: se guarda, se repinta su mensaje, se avisa al autor y queda en la auditoría. */
async function decidirSugerencia(interaction, estado, id) {
    const r = sugerencias.resolver(id, estado, interaction.user.id, interaction.fields.getTextInputValue("motivo"));
    if (!r.ok) return responder(interaction, buildRevisar(interaction.guildId, r.mensaje));
    const s = r.sugerencia;
    auditar(interaction, `sugerencia.${estado === "aceptada" ? "aceptar" : "descartar"}`, { id: s.id, autor: s.userId, motivo: s.motivo });
    log.info(`Sugerencia ${s.id} ${estado} por ${interaction.user.tag}`);
    await repintar(interaction.client, s);
    const avisado = await avisarResultado(interaction.client, s);
    const aviso = `${estado === "aceptada" ? "✅" : "❌"} Sugerencia #${s.id} ${estado}${avisado ? " y avisada por DM" : " (sin DM: lo tiene cerrado o apagado)"}.`;
    return responder(interaction, buildRevisar(interaction.guildId, aviso));
}

async function handleComunidadModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    for (const [ajuste, a] of Object.entries(AJUSTES_CANAL)) {
        if (id !== `paneladmin_com_${ajuste}_modal`) continue;
        await guardarCanal(interaction, a);
        return true;
    }
    if (id === "paneladmin_com_bienvenida_modal") {
        const canal = canalElegido(interaction.fields, "canal");
        const texto = interaction.fields.getTextInputValue("texto").trim();
        guildSettings.setManySettings(guildId, { "bienvenida.canal_id": canal, "bienvenida.texto": texto });
        auditar(interaction, "comunidad.bienvenida", { canal: canal || null, texto: texto || null });
        await responder(
            interaction,
            buildComunidadHome(guildId, canal ? `✅ Bienvenida en <#${canal}>.` : "🔕 Ya no se da la bienvenida."),
        );
        return true;
    }
    const m = /^paneladmin_com_sugmodal_(aceptada|descartada)_(\d+)$/.exec(id);
    if (!m) return false;
    await decidirSugerencia(interaction, m[1], m[2]);
    return true;
}

module.exports = {
    buildComunidadHome,
    buildRevisar,
    buildDetalle,
    handleComunidadButton,
    handleComunidadStringSelect,
    handleComunidadModal,
};
