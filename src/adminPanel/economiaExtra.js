// ⚙️ Config Global → 🛡️ Economía → 🎟️ Más economía: los ajustes de las funciones de economía nuevas (#524 y siguientes),
// cada una con su formulario: la 🎟️ lotería semanal (canal, precio del boleto y tope por persona) y los 🏆 torneos de casino
// (crear uno y cancelarlo antes de que empiece, con confirmación) y las 🏇 carreras (canal y apuesta máxima). Todo cambio se
// audita.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const loteria = require("../systems/loteria");
const torneos = require("../systems/torneos");
const carreras = require("../systems/carreras");
const enviosTorneos = require("../discord/envios/torneos");
const adminAudit = require("../systems/adminAudit");
const { fmtNumero } = require("../core/formato");
const { modalConCampos, canalElegido, opcionElegida } = require("./common");
const { guardarAuditado } = require("./settings/guardar");

const PREFIJO = "paneladmin_ecox_";
const COLOR = 0x2ecc71;

const entero = (texto, min, max) => {
    const n = Number(String(texto ?? "").trim());
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

function textoTorneo(t) {
    if (!t) return "Ninguno en marcha. Crea uno con 🏆 Crear torneo.";
    const cuando =
        t.estado === "inscripcion" ? `empieza <t:${Math.floor(t.empieza / 1000)}:R>` : `acaba <t:${Math.floor(t.termina / 1000)}:R>`;
    return `#${t.id} · ${t.juego} · inscripción ${fmtNumero(t.inscripcion)} 🪙 · bote ${fmtNumero(t.bote)} 🪙 · ${cuando}`;
}

/** La pantalla: un campo por función con sus ajustes. */
function buildHome(guildId, aviso = "") {
    const l = loteria.ajustes(guildId);
    const sorteo = loteria.abierto(guildId);
    const torneo = torneos.activo(guildId);
    const c = carreras.ajustes(guildId);
    const embed = new EmbedBuilder()
        .setTitle("🎟️ Más economía")
        .setColor(COLOR)
        .setDescription((aviso ? `${aviso}\n\n` : "") + "Ajustes de las funciones de economía nuevas. La gente las usa con sus comandos.")
        .addFields(
            {
                name: "🎟️ Lotería (`/loteria`)",
                value:
                    `Canal de los anuncios: ${l.canal ? `<#${l.canal}>` : "ninguno (se sortea igual, sin anuncio)"}\n` +
                    `Boleto: **${fmtNumero(l.precio)}** 🪙 · hasta **${l.maxBoletos}** por persona\n` +
                    `Bote ahora: **${fmtNumero(sorteo.bote)}** 🪙 · sorteo <t:${Math.floor(sorteo.sorteo_en / 1000)}:R>`,
            },
            { name: "🏆 Torneo de casino (`/torneo`)", value: textoTorneo(torneo) },
            {
                name: "🏇 Carreras (`/carreras`)",
                value: c.canal
                    ? `Cada 15 minutos en <#${c.canal}> · apuesta máxima **${fmtNumero(c.maxApuesta)}** 🪙`
                    : "Apagadas: elige un canal para que haya carreras cada 15 minutos.",
            },
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}loteria`).setLabel("✏️ Lotería").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${PREFIJO}torneo`)
            .setLabel("🏆 Crear torneo")
            .setStyle(ButtonStyle.Success)
            .setDisabled(Boolean(torneo)),
        new ButtonBuilder()
            .setCustomId(`${PREFIJO}torneo_cancelar`)
            .setLabel("✖️ Cancelar torneo")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(torneo?.estado !== "inscripcion"),
        new ButtonBuilder().setCustomId(`${PREFIJO}carreras`).setLabel("🏇 Carreras").setStyle(ButtonStyle.Primary),
    );
    const fila2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cfg_economia").setLabel("🛡️ Economía").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila, fila2], allowedMentions: { parse: [] } };
}

function modalLoteria(guildId) {
    const l = loteria.ajustes(guildId);
    return modalConCampos(`${PREFIJO}loteria_modal`, "Lotería semanal", [
        { id: "canal", label: "Canal de los anuncios (vacío = ninguno)", tipo: "canal", required: false, valor: l.canal },
        { id: "precio", label: "Precio del boleto (1 a 100.000)", value: String(l.precio), maxLength: 6 },
        { id: "max", label: "Boletos por persona y sorteo (1 a 50)", value: String(l.maxBoletos), maxLength: 2 },
    ]);
}

function modalCarreras(guildId) {
    const c = carreras.ajustes(guildId);
    return modalConCampos(`${PREFIJO}carreras_modal`, "Carreras de caballos", [
        { id: "canal", label: "Canal de las carreras (vacío = apagadas)", tipo: "canal", required: false, valor: c.canal },
        { id: "max", label: "Apuesta máxima por persona (10 a 1.000.000)", value: String(c.maxApuesta), maxLength: 7 },
    ]);
}

async function guardarCarreras(interaction) {
    const max = entero(interaction.fields.getTextInputValue("max"), carreras.MIN_APUESTA, 1_000_000);
    if (max === null) return pintar(interaction, buildHome(interaction.guildId, "❌ La apuesta máxima va de 10 a 1.000.000."));
    guardarAuditado(interaction.guildId, interaction.user.id, "settings.carreras.update", {
        "carreras.canal": canalElegido(interaction.fields, "canal"),
        "carreras.max_apuesta": max,
    });
    return pintar(interaction, buildHome(interaction.guildId, "✅ Carreras actualizadas."));
}

function modalTorneo() {
    return modalConCampos(`${PREFIJO}torneo_modal`, "Nuevo torneo de casino", [
        { id: "canal", label: "Canal donde se publica el torneo", tipo: "canal" },
        {
            id: "juego",
            label: "Juego",
            tipo: "opciones",
            opciones: [{ label: "Todos los del casino", value: "todos" }, ...torneos.JUEGOS.map((j) => ({ label: j, value: j }))],
            valor: "todos",
        },
        { id: "inscripcion", label: "Inscripción (monedas)", value: "500", maxLength: 7 },
        { id: "empieza", label: "Empieza dentro de (minutos)", value: "60", maxLength: 5 },
        { id: "horas", label: "Dura (horas, de 1 a 72)", value: "1", maxLength: 2 },
    ]);
}

async function crearTorneo(interaction) {
    const campo = (id) => Number(String(interaction.fields.getTextInputValue(id)).trim());
    const r = torneos.crear({
        guildId: interaction.guildId,
        porId: interaction.user.id,
        juego: opcionElegida(interaction.fields, "juego") || "todos",
        inscripcion: campo("inscripcion"),
        empiezaEnMin: campo("empieza"),
        horas: campo("horas"),
        channelId: canalElegido(interaction.fields, "canal") || null,
    });
    if (!r.ok) return pintar(interaction, buildHome(interaction.guildId, `❌ ${r.motivo}`));
    const { guildId, user } = interaction;
    adminAudit.logAdminAction({ guildId, actorId: user.id, action: "settings.torneo.crear", details: { id: r.torneo.id } });
    const p = await enviosTorneos.publicar(interaction.client, r.torneo).catch((e) => ({ ok: false, motivo: e.message }));
    return pintar(interaction, buildHome(guildId, `🏆 Torneo #${r.torneo.id} creado.${p.ok ? "" : ` ⚠️ ${p.motivo}`}`));
}

function confirmarCancelar() {
    return {
        content: "¿Cancelar el torneo? Se devuelve la inscripción a todos.",
        embeds: [],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${PREFIJO}torneo_cancelar_si`).setLabel("✖️ Sí, cancelar").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`${PREFIJO}home`).setLabel("↩️ No").setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

async function cancelarTorneo(interaction) {
    const { guildId, user } = interaction;
    const r = torneos.cancelar(guildId);
    if (r.ok) {
        adminAudit.logAdminAction({ guildId, actorId: user.id, action: "settings.torneo.cancelar", details: { id: r.torneo.id } });
        await enviosTorneos.repintar(interaction.client, r.torneo);
    }
    return interaction.update(buildHome(guildId, r.ok ? "✖️ Torneo cancelado y devuelto." : `❌ ${r.motivo}`));
}

const pintar = (interaction, payload) =>
    interaction.isFromMessage?.() === false
        ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
        : interaction.update(payload);

async function guardarLoteria(interaction) {
    const precio = entero(interaction.fields.getTextInputValue("precio"), 1, 100_000);
    const max = entero(interaction.fields.getTextInputValue("max"), 1, 50);
    if (precio === null || max === null) {
        return pintar(interaction, buildHome(interaction.guildId, "❌ Precio de 1 a 100.000 y de 1 a 50 boletos (números enteros)."));
    }
    guardarAuditado(interaction.guildId, interaction.user.id, "settings.loteria.update", {
        "loteria.canal": canalElegido(interaction.fields, "canal"),
        "loteria.precio": precio,
        "loteria.max_boletos": max,
    });
    return pintar(interaction, buildHome(interaction.guildId, "✅ Lotería actualizada."));
}

/** Botones de 🎟️ Más economía. Devuelve false si no es suyo. */
async function handleEconomiaExtraButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith(PREFIJO)) return false;
    const accion = id.slice(PREFIJO.length);
    if (accion === "home") await interaction.update(buildHome(interaction.guildId));
    else if (accion === "loteria") await interaction.showModal(modalLoteria(interaction.guildId));
    else if (accion === "torneo") await interaction.showModal(modalTorneo());
    else if (accion === "carreras") await interaction.showModal(modalCarreras(interaction.guildId));
    else if (accion === "torneo_cancelar") await interaction.update(confirmarCancelar());
    else if (accion === "torneo_cancelar_si") await cancelarTorneo(interaction);
    else return false;
    return true;
}

/** Formularios de 🎟️ Más economía. */
async function handleEconomiaExtraModal(interaction) {
    if (interaction.customId === `${PREFIJO}loteria_modal`) await guardarLoteria(interaction);
    else if (interaction.customId === `${PREFIJO}torneo_modal`) await crearTorneo(interaction);
    else if (interaction.customId === `${PREFIJO}carreras_modal`) await guardarCarreras(interaction);
    else return false;
    return true;
}

module.exports = { PREFIJO, buildHome, handleEconomiaExtraButton, handleEconomiaExtraModal };
