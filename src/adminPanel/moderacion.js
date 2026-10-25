// ⚙️ Config Global → ⚠️ Moderación (#542): los ajustes (rol de staff, canal de log, caducidad y umbrales), quién tiene strikes
// vigentes, y consultar el historial de una persona para retirar un strike o limpiarlos todos (con confirmación). Todo cambio
// se audita (familia `moderacion`). Avisar se hace con /avisar; aquí solo se consulta y se corrige.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const moderacion = require("../systems/moderacion");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { modalConCampos, usuarioElegido, rolElegido, canalElegido } = require("./common");
const { paginaDeLista } = require("../paneles/menuPaginado");

const PREFIJO = "paneladmin_mod_";
const COLOR = 0xe67e22;
const MAX_HISTORIAL = 15;
const ICONO = { vigente: "🟠", caducado: "⚪", retirado: "✖️" };

const corto = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const fecha = (ms) => `<t:${Math.floor(ms / 1000)}:d>`;
const auditar = (interaction, action, details) =>
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });

/** La pantalla: ajustes y quién tiene strikes vigentes. */
function buildHome(guildId, aviso = "") {
    const a = moderacion.ajustes(guildId);
    const con = moderacion.conStrikes(guildId);
    const embed = new EmbedBuilder()
        .setTitle("⚠️ Moderación")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "El staff avisa con `/avisar`: al avisado le llega un DM y suma un strike. Al cruzar un umbral se avisa a los " +
                "admins con la medida sugerida, pero **el bot no sanciona solo**.",
        )
        .addFields(
            {
                name: "Ajustes",
                value:
                    `Rol de staff: ${a.staffRol ? `<@&${a.staffRol}>` : "ninguno (solo Moderar miembros y admins)"}\n` +
                    `Canal de log: ${a.canalLog ? `<#${a.canalLog}>` : "ninguno"}\n` +
                    `Caducidad: **${a.caducidadDias}** días por strike`,
                inline: true,
            },
            { name: "Umbrales", value: a.umbrales.map((u) => `**${u.n}** → ${u.texto}`).join("\n"), inline: true },
            {
                name: "Con strikes vigentes",
                value: con.length ? con.map((c) => `<@${c.userId}> · **${c.n}**`).join("\n") : "Nadie.",
            },
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIJO}consultar`).setLabel("🔎 Consultar a alguien").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIJO}ajustes`).setLabel("📏 Umbrales y caducidad").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIJO}staff`).setLabel("🛡️ Staff y canal").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("⚙️ Config Global").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila], allowedMentions: { parse: [] } };
}

/** El historial de una persona, con el menú para retirar uno y el botón de limpiar. */
function buildPersona(guildId, userId, aviso = "") {
    const lista = moderacion.historial(guildId, userId);
    const vigentes = lista.filter((s) => s.situacion === "vigente").length;
    const medida = moderacion.medidaPara(guildId, vigentes);
    const lineas = lista
        .slice(0, MAX_HISTORIAL)
        .map((s) => `${ICONO[s.situacion]} **#${s.id}** · ${fecha(s.creado)} · por <@${s.staffId}> · ${corto(s.motivo, 120)}`);
    if (lista.length > MAX_HISTORIAL) lineas.push(`…y ${lista.length - MAX_HISTORIAL} más antiguos.`);
    const embed = new EmbedBuilder()
        .setTitle("🔎 Strikes")
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                `<@${userId}>: **${vigentes}** vigentes${medida ? ` · umbral alcanzado: ${medida.texto}` : ""}.\n` +
                "🟠 vigente · ⚪ caducado · ✖️ retirado\n\n" +
                (lineas.length ? lineas.join("\n") : "Sin avisos."),
        );
    const retirables = paginaDeLista(lista.filter((s) => s.estado === "vigente")).items;
    const filas = [];
    if (retirables.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${PREFIJO}retirar_${userId}`)
                    .setPlaceholder("Retirar un strike")
                    .addOptions(retirables.map((s) => ({ label: corto(`#${s.id} · ${s.motivo}`, 100), value: String(s.id) }))),
            ),
        );
    }
    filas.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${PREFIJO}limpiar_${userId}`)
                .setLabel("🧹 Limpiar todos")
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!retirables.length),
            new ButtonBuilder().setCustomId(`${PREFIJO}home`).setLabel("⚠️ Moderación").setStyle(ButtonStyle.Secondary),
        ),
    );
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

function buildConfirmarLimpiar(userId) {
    return {
        content: `¿Retirar **todos** los strikes de <@${userId}>? Quedan en el historial como retirados.`,
        embeds: [],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${PREFIJO}limpiarsi_${userId}`).setLabel("✅ Sí, limpiar").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`${PREFIJO}ver_${userId}`).setLabel("✖️ Cancelar").setStyle(ButtonStyle.Secondary),
            ),
        ],
        allowedMentions: { parse: [] },
    };
}

function modalAjustes(guildId) {
    const a = moderacion.ajustes(guildId);
    const umbral = (clave) => String(a.umbrales.find((u) => u.clave === clave).n);
    return modalConCampos(`${PREFIJO}ajustes_modal`, "Umbrales y caducidad", [
        { id: "caducidad", label: "Días que cuenta cada strike", value: String(a.caducidadDias), maxLength: 4 },
        { id: "aviso", label: "Strikes para un aviso serio", value: umbral("aviso"), maxLength: 3 },
        { id: "mute", label: "Strikes para sugerir silenciar 24 h", value: umbral("mute"), maxLength: 3 },
        { id: "expulsion", label: "Strikes para sugerir expulsión", value: umbral("expulsion"), maxLength: 3 },
        { id: "ban", label: "Strikes para sugerir ban", value: umbral("ban"), maxLength: 3 },
    ]);
}

function modalStaff(guildId) {
    const a = moderacion.ajustes(guildId);
    return modalConCampos(`${PREFIJO}staff_modal`, "Staff y canal de log", [
        { id: "rol", label: "Rol de staff (vacío = ninguno)", tipo: "rol", required: false, valor: a.staffRol },
        { id: "canal", label: "Canal de log (vacío = ninguno)", tipo: "canal", required: false, valor: a.canalLog },
    ]);
}

const modalConsultar = () =>
    modalConCampos(`${PREFIJO}consultar_modal`, "Consultar strikes", [{ id: "usuario", label: "Persona", tipo: "usuario" }]);

/** Responde en el mismo mensaje si llega de él; si no, en privado. */
const pintar = (interaction, payload) =>
    interaction.isFromMessage?.() === false
        ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
        : interaction.update(payload);

async function guardarAjustes(interaction) {
    const campo = (id) => interaction.fields.getTextInputValue(id);
    const r = moderacion.validarAjustes({
        caducidad: campo("caducidad"),
        aviso: campo("aviso"),
        mute: campo("mute"),
        expulsion: campo("expulsion"),
        ban: campo("ban"),
    });
    if (!r.ok) return pintar(interaction, buildHome(interaction.guildId, `❌ ${r.motivo}`));
    const antes = guildSettings.getSettings(interaction.guildId).moderacion;
    for (const [clave, valor] of Object.entries(r.valores)) guildSettings.setSetting(interaction.guildId, `moderacion.${clave}`, valor);
    auditar(interaction, "moderacion.ajustes", {
        antes: Object.fromEntries(Object.keys(r.valores).map((k) => [k, antes[k]])),
        despues: r.valores,
    });
    return pintar(interaction, buildHome(interaction.guildId, "✅ Umbrales y caducidad guardados."));
}

async function guardarStaff(interaction) {
    const rol = rolElegido(interaction.fields, "rol");
    const canal = canalElegido(interaction.fields, "canal");
    guildSettings.setSetting(interaction.guildId, "moderacion.staff_rol", rol);
    guildSettings.setSetting(interaction.guildId, "moderacion.canal_log", canal);
    auditar(interaction, "moderacion.staff", { staffRol: rol || null, canalLog: canal || null });
    return pintar(interaction, buildHome(interaction.guildId, "✅ Staff y canal de log guardados."));
}

/** Botones de ⚠️ Moderación. Devuelve false si no es suyo. */
async function handleModeracionButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith(PREFIJO)) return false;
    const accion = id.slice(PREFIJO.length);
    const guildId = interaction.guildId;
    const m = /^(ver|limpiar|limpiarsi)_(\w+)$/.exec(accion);
    if (accion === "home") await interaction.update(buildHome(guildId));
    else if (accion === "consultar") await interaction.showModal(modalConsultar());
    else if (accion === "ajustes") await interaction.showModal(modalAjustes(guildId));
    else if (accion === "staff") await interaction.showModal(modalStaff(guildId));
    else if (m?.[1] === "ver") await interaction.update(buildPersona(guildId, m[2]));
    else if (m?.[1] === "limpiar") await interaction.update(buildConfirmarLimpiar(m[2]));
    else if (m?.[1] === "limpiarsi") {
        const n = moderacion.limpiar(guildId, m[2], interaction.user.id);
        if (n) auditar(interaction, "moderacion.limpiar", { userId: m[2], retirados: n });
        await interaction.update(buildPersona(guildId, m[2], n ? `🧹 Retirados ${n} strikes.` : "No quedaba ninguno."));
    } else return false;
    return true;
}

/** Formularios de ⚠️ Moderación. */
async function handleModeracionModal(interaction) {
    const id = interaction.customId;
    if (id === `${PREFIJO}ajustes_modal`) await guardarAjustes(interaction);
    else if (id === `${PREFIJO}staff_modal`) await guardarStaff(interaction);
    else if (id === `${PREFIJO}consultar_modal`) {
        const userId = usuarioElegido(interaction.fields, "usuario");
        await pintar(
            interaction,
            userId ? buildPersona(interaction.guildId, userId) : buildHome(interaction.guildId, "❌ Elige a alguien."),
        );
    } else return false;
    return true;
}

/** El menú para retirar un strike. */
async function handleModeracionSelect(interaction) {
    const m = new RegExp(`^${PREFIJO}retirar_(\\w+)$`).exec(interaction.customId);
    if (!m) return false;
    const s = moderacion.retirar(interaction.guildId, interaction.values[0], interaction.user.id);
    if (s) auditar(interaction, "moderacion.retirar", { id: s.id, userId: s.userId, motivo: s.motivo });
    await interaction.update(
        buildPersona(interaction.guildId, m[1], s ? `✖️ Retirado el strike #${s.id}.` : "Ese strike ya estaba retirado."),
    );
    return true;
}

module.exports = { PREFIJO, buildHome, buildPersona, handleModeracionButton, handleModeracionModal, handleModeracionSelect };
