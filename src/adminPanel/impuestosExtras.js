// Panel admin → Config Global → Impuestos, parte 2: 📊 tramos de una regla (#392), 🎯 meta comunitaria del bote (#415) y 💼 sueldo
// diario por rol (#416). Lo llama adminPanel/impuestos.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const tramos = require("../systems/impuestos/tramos");
const meta = require("../systems/impuestos/meta");
const impuestos = require("../systems/impuestos");
const sueldos = require("../systems/sueldos");
const patrimonio = require("../systems/patrimonio");
const adminAudit = require("../systems/adminAudit");
const { simpleModal, modalConCampos, rolElegido, rolesElegidos } = require("./common");
const { fmtNumero } = require("../core/formato");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
const valor = (interaction, id) => interaction.fields.getTextInputValue(id).trim();
const auditar = (interaction, action, details) =>
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });
const numero = (texto) => Number(String(texto).replace(/[\s.]/g, "").replace(",", "."));

/** "desde 10.000 🪙: 20 %" por cada tramo de una regla (vacío si no tiene). */
function textoTramos(reglaId) {
    return tramos
        .tramosDe(reglaId)
        .map((t) => `desde ${fmtNumero(t.desde)} 🪙: ${t.porcentaje} %`)
        .join(" · ");
}

/** La línea de la meta del bote para la pantalla de impuestos. */
function textoMeta(guildId) {
    const m = meta.obtener(guildId);
    if (!m) return "🎯 Meta del bote: ninguna.";
    const estado = m.cumplida_en ? "✅ cumplida" : `${fmtNumero(impuestos.boteTotal(guildId))} / ${fmtNumero(m.meta)} 🪙`;
    return `🎯 Meta del bote: **${fmtNumero(m.meta)}** 🪙 → ${fmtNumero(m.recompensa)} 🪙 por persona (${estado}).`;
}

function buildSueldos(guildId, aviso = "") {
    const lineas = sueldos.listar(guildId).map((s) => `• <@&${s.roleId}> — **${fmtNumero(s.cantidad)}** 🪙 al día`);
    const embed = new EmbedBuilder()
        .setTitle("💼 Sueldo diario por rol")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Cada día (hora de Madrid) quien tenga el rol cobra su sueldo en efectivo, con el impuesto de ingresos. Con varios roles con " +
                "sueldo, cobra la suma.\n\n" +
                (lineas.join("\n") || "No hay ningún sueldo."),
        )
        .setColor(0x27ae60);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_impuestos_sueldo_fijar").setLabel("✏️ Fijar sueldo").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_impuestos_home").setLabel("◀ Impuestos").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

const FORMULARIOS = {
    paneladmin_impuestos_exentos: () =>
        modalConCampos("paneladmin_impuestos_exentos_modal", "Roles exentos del patrimonio", [
            {
                id: "roles",
                label: "Roles exentos (ninguno = quitar todos)",
                tipo: "rol",
                multiple: true,
                valores: patrimonio.configuracion().rolesExentos,
                required: false,
            },
        ]),
    paneladmin_impuestos_tramo: () =>
        simpleModal("paneladmin_impuestos_tramo_modal", "Tramo de una regla", [
            { id: "regla", label: "ID de la regla de ingreso" },
            { id: "desde", label: "El tramo empieza en (monedas)", placeholder: "10000" },
            { id: "porcentaje", label: "Porcentaje (vacío = quitar el tramo)", required: false },
        ]),
    paneladmin_impuestos_meta: () =>
        simpleModal("paneladmin_impuestos_meta_modal", "Meta comunitaria del bote", [
            { id: "meta", label: "Meta: monedas en el bote (0 = quitarla)", placeholder: "100000" },
            { id: "recompensa", label: "Recompensa por persona", placeholder: "500", required: false },
        ]),
    paneladmin_impuestos_sueldo_fijar: () =>
        modalConCampos("paneladmin_impuestos_sueldo_modal", "Sueldo diario de un rol", [
            { id: "rol", label: "Rol", tipo: "rol" },
            { id: "cantidad", label: "Monedas al día (0 = quitar)", placeholder: "200" },
        ]),
};

async function boton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_impuestos_sueldos") {
        await interaction.update(buildSueldos(interaction.guildId));
        return true;
    }
    if (FORMULARIOS[id]) {
        await interaction.showModal(FORMULARIOS[id]());
        return true;
    }
    return false;
}

async function guardarTramo(interaction) {
    const reglaId = parseInt(valor(interaction, "regla"), 10);
    const desde = numero(valor(interaction, "desde"));
    const pct = valor(interaction, "porcentaje");
    if (!pct) {
        const ok = tramos.quitarTramo(interaction.guildId, reglaId, desde);
        if (ok) auditar(interaction, "impuestos.tramo.quitar", { reglaId, desde });
        return interaction.reply(privado(ok ? "✅ Tramo quitado." : "❌ Esa regla no tiene un tramo que empiece ahí."));
    }
    const r = tramos.ponerTramo(interaction.guildId, reglaId, desde, numero(pct));
    if (r.ok) auditar(interaction, "impuestos.tramo.poner", { reglaId, desde, porcentaje: numero(pct) });
    return interaction.reply(privado(r.mensaje));
}

async function guardarMeta(interaction) {
    const m = numero(valor(interaction, "meta"));
    if (m === 0) {
        meta.quitar(interaction.guildId);
        auditar(interaction, "impuestos.meta.quitar", {});
        return interaction.reply(privado("✅ Meta quitada."));
    }
    const r = meta.fijar(interaction.guildId, m, numero(valor(interaction, "recompensa") || "0"));
    if (r.ok) auditar(interaction, "impuestos.meta.fijar", { meta: m });
    return interaction.reply(privado(r.mensaje));
}

async function guardarSueldo(interaction) {
    const roleId = rolElegido(interaction.fields, "rol");
    if (!roleId) return interaction.reply(privado("❌ Elige un rol."));
    const r = sueldos.fijar(interaction.guildId, roleId, numero(valor(interaction, "cantidad")));
    if (r.ok) auditar(interaction, "sueldo.fijar", { roleId, cantidad: numero(valor(interaction, "cantidad")) });
    if (!r.ok) return interaction.reply(privado(r.mensaje));
    return interaction.isFromMessage?.()
        ? interaction.update(buildSueldos(interaction.guildId, r.mensaje))
        : interaction.reply(privado(r.mensaje));
}

/** Guarda los roles exentos del impuesto de patrimonio (#397): siguen cobrando el interés. */
async function guardarExentos(interaction) {
    const rolesExentos = rolesElegidos(interaction.fields, "roles");
    const r = patrimonio.guardarConfiguracion({ ...patrimonio.configuracion(), rolesExentos });
    if (!r.ok) return interaction.reply(privado(`❌ ${r.mensaje}`));
    auditar(interaction, "impuestos.patrimonio.exentos", { rolesExentos });
    return interaction.reply(
        privado(
            rolesExentos.length ? `✅ Exentos del impuesto: ${rolesExentos.map((x) => `<@&${x}>`).join(" ")}.` : "✅ Ningún rol exento.",
        ),
    );
}

async function modal(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_impuestos_exentos_modal") return (await guardarExentos(interaction), true);
    if (id === "paneladmin_impuestos_tramo_modal") return (await guardarTramo(interaction), true);
    if (id === "paneladmin_impuestos_meta_modal") return (await guardarMeta(interaction), true);
    if (id === "paneladmin_impuestos_sueldo_modal") return (await guardarSueldo(interaction), true);
    return false;
}

const filaBotones = () => [
    new ButtonBuilder().setCustomId("paneladmin_impuestos_tramo").setLabel("📊 Tramos").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("paneladmin_impuestos_meta").setLabel("🎯 Meta del bote").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("paneladmin_impuestos_sueldos").setLabel("💼 Sueldos por rol").setStyle(ButtonStyle.Secondary),
];

module.exports = { textoTramos, textoMeta, filaBotones, boton, modal };
