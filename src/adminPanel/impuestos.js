// Panel admin → Config Global → Impuestos: ver y gestionar las reglas de impuesto del motor
// (F-EC-06a) y el bote acumulado del servidor. Ver systems/impuestos.js.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const impuestos = require("../systems/impuestos");
const dinero = require("../systems/dinero");
const adminAudit = require("../systems/adminAudit");
const { simpleModal, fmt } = require("./common");

function lineaRegla(r) {
    const ambito =
        r.base === "compra"
            ? "compra"
            : r.tipoMovimiento
              ? `ingreso: ${dinero.TIPOS[r.tipoMovimiento] || r.tipoMovimiento}`
              : "ingreso: general";
    const destino = r.destino === "bote" ? "→ bote" : "→ desaparece";
    return `• \`#${r.id}\` ${r.activo ? "🟢" : "🔴"} ${ambito} — **${r.porcentaje}%** ${destino}`;
}

function buildImpuestosHome(guildId) {
    impuestos.asegurarReglaPorDefecto(guildId); // para no mostrar "ninguna regla" cuando ya hay una de hecho (la de por defecto)
    const reglas = impuestos.listarReglas(guildId);
    const lines = reglas.length ? reglas.map(lineaRegla).join("\n") : "No hay ninguna regla todavía.";
    const embed = new EmbedBuilder()
        .setTitle("🏛️ Motor de impuestos")
        .setDescription(
            "Reglas de impuesto del servidor: sobre **ingresos** (general, o limitada a un tipo concreto) o sobre **compras** " +
                "en la tienda. Si hay una regla general de ingreso y otra específica para el mismo tipo, gana la específica.\n\n" +
                lines +
                `\n\n💰 Bote acumulado: **${fmt(impuestos.boteTotal(guildId))}**`,
        )
        .setColor(0x1abc9c)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_impuestos_add").setLabel("➕ Añadir regla").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_impuestos_toggle").setLabel("🔁 Activar/desactivar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("paneladmin_impuestos_remove").setLabel("🗑️ Quitar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_impuestos_home").setLabel("🔄 Refrescar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cfg_home").setLabel("◀ Config Global").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}

async function handleImpuestosButton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_impuestos_home") {
        await interaction.update(buildImpuestosHome(interaction.guildId));
        return true;
    }
    if (id === "paneladmin_impuestos_add") {
        await interaction.showModal(
            simpleModal("paneladmin_impuestos_add_modal", "Añadir regla de impuesto", [
                { id: "base", label: "Base: ingreso o compra", placeholder: "ingreso" },
                { id: "tipo", label: "Tipo concreto (vacío = general; solo para ingreso)", placeholder: "casino", required: false },
                { id: "porcentaje", label: "Porcentaje (0-100)", placeholder: "5" },
                { id: "destino", label: "Destino: bote o sumidero", placeholder: "bote", value: "bote", required: false },
            ]),
        );
        return true;
    }
    if (id === "paneladmin_impuestos_remove") {
        await interaction.showModal(
            simpleModal("paneladmin_impuestos_remove_modal", "Quitar regla", [
                { id: "id", label: "ID de la regla (el número tras el #)", placeholder: "3" },
            ]),
        );
        return true;
    }
    if (id === "paneladmin_impuestos_toggle") {
        await interaction.showModal(
            simpleModal("paneladmin_impuestos_toggle_modal", "Activar/desactivar regla", [
                { id: "id", label: "ID de la regla", placeholder: "3" },
                { id: "activo", label: "¿Activa? (sí/no)", placeholder: "si" },
            ]),
        );
        return true;
    }
    return false;
}

async function handleImpuestosModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;

    if (id === "paneladmin_impuestos_add_modal") {
        const base = interaction.fields.getTextInputValue("base").trim().toLowerCase();
        if (!["ingreso", "compra"].includes(base)) {
            await interaction.reply({ content: "❌ La base tiene que ser `ingreso` o `compra`.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const tipoRaw = interaction.fields.getTextInputValue("tipo").trim();
        const tipoMovimiento = base === "ingreso" && tipoRaw ? tipoRaw : null;
        if (tipoMovimiento && !dinero.TIPOS[tipoMovimiento]) {
            await interaction.reply({
                content: `❌ "${tipoMovimiento}" no es un tipo de movimiento válido. Tipos: ${Object.keys(dinero.TIPOS).join(", ")}.`,
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        const porcentaje = Number(interaction.fields.getTextInputValue("porcentaje").trim());
        if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
            await interaction.reply({ content: "❌ El porcentaje tiene que ser un número entre 0 y 100.", flags: MessageFlags.Ephemeral });
            return true;
        }
        const destinoRaw = interaction.fields.getTextInputValue("destino").trim().toLowerCase();
        const destino = destinoRaw === "sumidero" ? "sumidero" : "bote";
        const regla = impuestos.anadirRegla(guildId, { base, tipoMovimiento, porcentaje, destino });
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "impuestos.add", details: regla });
        await interaction.reply({ content: `✅ Regla #${regla.id} añadida.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_impuestos_remove_modal") {
        const idRegla = Number(interaction.fields.getTextInputValue("id").trim());
        const ok = impuestos.quitarRegla(guildId, idRegla);
        if (!ok) {
            await interaction.reply({ content: `❌ No hay ninguna regla #${idRegla} en este servidor.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "impuestos.remove", details: { id: idRegla } });
        await interaction.reply({ content: `✅ Regla #${idRegla} borrada.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === "paneladmin_impuestos_toggle_modal") {
        const idRegla = Number(interaction.fields.getTextInputValue("id").trim());
        const activo = /^(s|si|sí|y|yes|1)$/i.test(interaction.fields.getTextInputValue("activo").trim());
        const ok = impuestos.activarRegla(guildId, idRegla, activo);
        if (!ok) {
            await interaction.reply({ content: `❌ No hay ninguna regla #${idRegla} en este servidor.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        adminAudit.logAdminAction({ guildId, actorId: interaction.user.id, action: "impuestos.toggle", details: { id: idRegla, activo } });
        await interaction.reply({ content: `✅ Regla #${idRegla} ${activo ? "activada" : "desactivada"}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

module.exports = { buildImpuestosHome, handleImpuestosButton, handleImpuestosModal };
