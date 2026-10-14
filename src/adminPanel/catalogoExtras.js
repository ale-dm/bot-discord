// Panel admin → 🛒 Catálogo, parte 2: 🏷️ ofertas temporales (#413), 💱 precios de la tienda (recompra y precio dinámico, #379 y #412)
// y 🎟️ códigos canjeables (#409). Además avisa por DM a quien sigue un objeto cuando cambia (#404). Lo llama adminPanel/catalogo.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const repo = require("../repositorios/catalogo");
const tienda = require("../systems/tienda");
const deseos = require("../systems/tiendaDeseos");
const codigos = require("../systems/codigos");
const guildSettings = require("../systems/guildSettings");
const adminAudit = require("../systems/adminAudit");
const { enviarAviso } = require("../systems/avisosDm");
const { embedDeseo } = require("../discord/mensajes/tiendaDeseos");
const { fechaMadridAMs } = require("../core/zonaMadrid");
const { simpleModal } = require("./common");

const privado = (content) => ({ content, flags: MessageFlags.Ephemeral });
const campo = (interaction, id) => {
    try {
        return interaction.fields.getTextInputValue(id).trim();
    } catch {
        return "";
    }
};
const fecha = (ms) => new Date(ms).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

/** Avisa por DM a quien sigue un objeto de la tienda si ha vuelto a tener stock o ha bajado de precio. @returns {number} DMs enviados */
async function avisarSeguidores(client, antes, despues) {
    const motivo = deseos.motivoDeAviso(antes, despues);
    if (!motivo) return 0;
    let enviados = 0;
    for (const userId of deseos.seguidores(despues.tiendaId)) {
        if (await enviarAviso(client, userId, "tienda_deseos", { embeds: [embedDeseo(despues, motivo)] })) enviados++;
    }
    return enviados;
}

// --- Pantalla de códigos ---------------------------------------------------------------------------------------------------

function buildCodigos(aviso = "") {
    const lineas = codigos.listar().map((c) => {
        const premio = [c.monedas ? `${c.monedas.toLocaleString("es")} 🪙` : null, c.objetoNombre].filter(Boolean).join(" + ");
        const estado = !c.activo
            ? "🔴 desactivado"
            : c.caduca && c.caduca <= Date.now()
              ? "⌛ caducado"
              : c.usos >= c.usos_max
                ? "🔴 agotado"
                : "🟢";
        return `\`${c.codigo}\` ${estado} — ${premio} · ${c.usos}/${c.usos_max} usos${c.caduca ? ` · hasta ${fecha(c.caduca)}` : ""}`;
    });
    const embed = new EmbedBuilder()
        .setTitle("🎟️ Códigos canjeables")
        .setDescription((aviso ? `${aviso}\n\n` : "") + (lineas.join("\n") || "No hay códigos. Crea uno con ➕."))
        .setColor(0xe67e22);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("paneladmin_cat_codigo_crear").setLabel("➕ Crear").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_cat_codigo_off").setLabel("🚫 Desactivar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("paneladmin_cat_home").setLabel("◀ Catálogo").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

// --- Botones y formularios -------------------------------------------------------------------------------------------------

function formularioPrecios(guildId) {
    const t = guildSettings.getSettings(guildId).tienda;
    return simpleModal("paneladmin_cat_precios_modal", "Precios de la tienda", [
        { id: "recompra", label: "Recompra: % del precio (0 = no recompra)", value: String(t.recompra_pct) },
        { id: "subida", label: "Subida por compra: % (0 = precio fijo)", value: String(t.subida_pct) },
        { id: "recuperacion", label: "Bajada cada hora: % del precio base", value: String(t.recuperacion_pct) },
        { id: "tope", label: "Tope sobre el precio base: %", value: String(t.tope_pct) },
    ]);
}

const FORMULARIOS = {
    paneladmin_cat_oferta: () =>
        simpleModal("paneladmin_cat_oferta_modal", "Oferta temporal", [
            { id: "id", label: "ID del objeto (a la venta)" },
            { id: "descuento", label: "Descuento en % (0 = quitar la oferta)" },
            { id: "inicio", label: "Empieza (DD/MM/AAAA HH:MM, Madrid)", placeholder: "vacío = ya", required: false },
            { id: "fin", label: "Termina (DD/MM/AAAA HH:MM, Madrid)", placeholder: "vacío = sin fin", required: false },
        ]),
    paneladmin_cat_codigo_crear: () =>
        simpleModal("paneladmin_cat_codigo_crear_modal", "Crear código", [
            { id: "codigo", label: "Código", placeholder: "BIENVENIDA" },
            { id: "monedas", label: "Monedas (0 = ninguna)", value: "0" },
            { id: "objeto", label: "ID del objeto (vacío = ninguno)", required: false },
            { id: "usos", label: "Usos máximos", value: "1" },
            { id: "caduca", label: "Caduca (DD/MM/AAAA HH:MM, Madrid)", placeholder: "vacío = no caduca", required: false },
        ]),
    paneladmin_cat_codigo_off: () =>
        simpleModal("paneladmin_cat_codigo_off_modal", "Desactivar código", [{ id: "codigo", label: "Código" }]),
};

async function boton(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_cat_codigos") {
        await interaction.update(buildCodigos());
        return true;
    }
    if (id === "paneladmin_cat_precios") {
        await interaction.showModal(formularioPrecios(interaction.guildId));
        return true;
    }
    if (FORMULARIOS[id]) {
        await interaction.showModal(FORMULARIOS[id]());
        return true;
    }
    return false;
}

function auditar(interaction, action, details) {
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action, details });
}

async function guardarOferta(interaction) {
    const objetoId = parseInt(campo(interaction, "id"), 10);
    const venta = repo.ventaDeObjeto(objetoId);
    if (!venta) return interaction.reply(privado("❌ Ese objeto no está a la venta."));
    const descuento = Number(campo(interaction, "descuento"));
    if (!Number.isInteger(descuento) || descuento < 0 || descuento > 100)
        return interaction.reply(privado("❌ El descuento es un entero entre 0 y 100."));
    const inicio = campo(interaction, "inicio") ? fechaMadridAMs(campo(interaction, "inicio")) : null;
    const fin = campo(interaction, "fin") ? fechaMadridAMs(campo(interaction, "fin")) : null;
    if ((campo(interaction, "inicio") && inicio === null) || (campo(interaction, "fin") && fin === null)) {
        return interaction.reply(privado("❌ Las fechas son DD/MM/AAAA o DD/MM/AAAA HH:MM, en hora de Madrid."));
    }
    if (descuento > 0 && fin !== null && fin <= (inicio ?? Date.now()))
        return interaction.reply(privado("❌ El final tiene que ser posterior al inicio."));
    const antes = tienda.itemTienda(venta.id);
    repo.ponerOferta(descuento, descuento ? inicio : null, descuento ? fin : null, venta.id);
    auditar(interaction, "tienda.oferta", { tiendaId: venta.id, descuento, inicio, fin });
    await avisarSeguidores(interaction.client, antes, tienda.itemTienda(venta.id));
    const resumen = descuento
        ? `🏷️ Oferta del **${descuento} %** en **${antes.nombre}** (${inicio ? `desde ${fecha(inicio)}` : "ya"}${fin ? `, hasta ${fecha(fin)}` : ", sin fecha de fin"}).`
        : `🏷️ Oferta de **${antes.nombre}** quitada.`;
    return interaction.reply(privado(resumen));
}

async function guardarPrecios(interaction) {
    const valores = ["recompra", "subida", "recuperacion", "tope"].map((c) => Number(campo(interaction, c)));
    if (valores.some((v) => !Number.isFinite(v) || v < 0 || v > 1000))
        return interaction.reply(privado("❌ Los cuatro son números entre 0 y 1000."));
    const [recompra, subida, recuperacion, tope] = valores;
    guildSettings.setManySettings(interaction.guildId, {
        "tienda.recompra_pct": recompra,
        "tienda.subida_pct": subida,
        "tienda.recuperacion_pct": recuperacion,
        "tienda.tope_pct": tope,
    });
    auditar(interaction, "tienda.precios", { recompra, subida, recuperacion, tope });
    return interaction.reply(
        privado(
            `✅ Recompra ${recompra} % · subida ${subida} % por compra (${subida ? "activa" : "apagada"}) · bajada ${recuperacion} % por hora · tope +${tope} % sobre el base.`,
        ),
    );
}

async function crearCodigo(interaction) {
    const ahora = Date.now();
    const caducaTxt = campo(interaction, "caduca");
    const caduca = caducaTxt ? fechaMadridAMs(caducaTxt) : null;
    if (caducaTxt && caduca === null) return interaction.reply(privado("❌ La fecha es DD/MM/AAAA o DD/MM/AAAA HH:MM, en hora de Madrid."));
    const objetoTxt = campo(interaction, "objeto");
    const r = codigos.crear(
        {
            codigo: campo(interaction, "codigo"),
            monedas: Number(campo(interaction, "monedas") || 0),
            objetoId: objetoTxt ? parseInt(objetoTxt, 10) : null,
            usosMax: Number(campo(interaction, "usos")),
            caduca,
        },
        ahora,
    );
    if (r.ok) auditar(interaction, "codigo.crear", { codigo: r.codigo });
    return interaction.reply(privado(r.mensaje));
}

async function modal(interaction) {
    const id = interaction.customId;
    if (id === "paneladmin_cat_oferta_modal") return (await guardarOferta(interaction), true);
    if (id === "paneladmin_cat_precios_modal") return (await guardarPrecios(interaction), true);
    if (id === "paneladmin_cat_codigo_crear_modal") return (await crearCodigo(interaction), true);
    if (id === "paneladmin_cat_codigo_off_modal") {
        const ok = codigos.desactivar(campo(interaction, "codigo"));
        if (ok) auditar(interaction, "codigo.desactivar", { codigo: campo(interaction, "codigo") });
        await interaction.reply(privado(ok ? "🚫 Código desactivado." : "❌ Ese código no existe o ya estaba desactivado."));
        return true;
    }
    return false;
}

module.exports = { avisarSeguidores, buildCodigos, boton, modal };
