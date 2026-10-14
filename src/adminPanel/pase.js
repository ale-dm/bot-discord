// 🛡️ Pase de batalla en /paneladmin (#353): activar o desactivar el pase, cambiar el tope diario de cada categoría y lo que cuesta cada nivel,
// elegir el canal donde se anuncian las subidas de nivel (#344) y los objetos que dan algunos niveles (#364). Todo se aplica al momento (la
// XP por nivel también a la temporada en curso: los niveles ya cobrados se mantienen). Sin ajustes guardados, el pase se comporta como siempre.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const catalogo = require("../repositorios/catalogo");
const adminAudit = require("../systems/adminAudit");
const guildSettings = require("../systems/guildSettings");
const { CATEGORIAS, ETIQUETAS, NIVEL_MAX, XP_NIVEL_BASE, XP_NIVEL_PASO } = require("../systems/pase/constantes");
const { ajustes } = require("../systems/pase/ajustes");
const { fmtNumero } = require("../core/formato");
const { modalConCampos } = require("./common");

const TOPE_MAX = 100000;
const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });

/** Los objetos por nivel con su nombre actual: "5: Candado · 10: Trampa". */
function textoObjetos(objetos) {
    const lineas = Object.entries(objetos)
        .sort(([a], [b]) => a - b)
        .map(([nivel, id]) => `${nivel}: ${catalogo.objetoPorId(Number(id))?.nombre ?? "(objeto borrado)"}`);
    return lineas.length ? lineas.join(" · ") : "ninguno";
}

function buildPaseHome(guildId) {
    const cfg = ajustes(guildId);
    const topes = Object.entries(CATEGORIAS).map(([c, { tope: porDefecto }]) => {
        const cambiado = cfg.topes[c] !== porDefecto;
        return `${ETIQUETAS[c]}: **${fmtNumero(cfg.topes[c])}** XP/día${cambiado ? ` (por defecto ${fmtNumero(porDefecto)})` : ""}`;
    });
    const embed = new EmbedBuilder()
        .setTitle("🛡️ Pase de batalla")
        .setColor(0x2ecc71)
        .setDescription(
            `Estado: ${cfg.activo ? "🟢 **activo**" : "🔴 **desactivado** (nadie suma XP y /pase no responde)"}\n\n` +
                `**Topes diarios**\n${topes.join("\n")}\n\n` +
                `**XP por nivel**: ${fmtNumero(cfg.xpBase)} el primero y ${fmtNumero(cfg.xpPaso)} más cada vez` +
                `${cfg.xpBase !== XP_NIVEL_BASE || cfg.xpPaso !== XP_NIVEL_PASO ? ` (por defecto ${XP_NIVEL_BASE} y ${XP_NIVEL_PASO})` : ""}\n` +
                `**Anuncios de nivel**: ${cfg.canalNivel ? `<#${cfg.canalNivel}>` : "no se anuncian"}\n` +
                `**Objetos por nivel**: ${textoObjetos(cfg.objetos)}`,
        );
    const botones = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("paneladmin_pase_activo")
            .setLabel(cfg.activo ? "⏸️ Desactivar" : "▶️ Activar")
            .setStyle(cfg.activo ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId("paneladmin_pase_topes").setLabel("📊 Cambiar un tope").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_pase_curva").setLabel("📈 XP por nivel").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_pase_objetos").setLabel("🎒 Objetos").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("paneladmin_home").setLabel("◀ Panel principal").setStyle(ButtonStyle.Secondary),
    );
    const canal = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId("paneladmin_pase_canal_select")
            .setPlaceholder("Canal de anuncios de nivel (quitar la selección: no anunciar)")
            .setMinValues(0)
            .setMaxValues(1)
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
    return { content: "", embeds: [embed], components: [botones, canal] };
}

const modalTope = (categoria, guildId) =>
    modalConCampos(`paneladmin_pase_modal_tope_${categoria}`, `Tope diario: ${ETIQUETAS[categoria].slice(2)}`.slice(0, 45), [
        { id: "tope", label: `XP al día, 0 a ${TOPE_MAX}`.slice(0, 45), value: String(ajustes(guildId).topes[categoria]) },
    ]);

function modalCurva(guildId) {
    const cfg = ajustes(guildId);
    return modalConCampos("paneladmin_pase_modal_curva", "XP por nivel", [
        { id: "base", label: "XP del primer nivel (1 a 10000)", value: String(cfg.xpBase) },
        { id: "paso", label: "XP más en cada nivel (0 a 1000)", value: String(cfg.xpPaso) },
    ]);
}

function modalObjetos(guildId) {
    const cfg = ajustes(guildId);
    const actual = Object.entries(cfg.objetos)
        .map(([nivel, id]) => `${nivel}:${catalogo.objetoPorId(Number(id))?.nombre ?? ""}`)
        .join(", ");
    return modalConCampos("paneladmin_pase_modal_objetos", "Objetos por nivel", [
        {
            id: "objetos",
            label: "nivel:objeto, nivel:objeto (vacío = ninguno)",
            value: actual,
            required: false,
            paragraph: true,
            maxLength: 400,
        },
    ]);
}

/**
 * Lee «5:Candado, 10:Trampa para ladrones» y devuelve { nivel: id del objeto } o un error si un nivel no existe (1 a NIVEL_MAX), un objeto no
 * está en el catálogo o una línea no tiene el formato.
 * @returns {{ ok: true, objetos: object } | { ok: false, mensaje: string }}
 */
function leerObjetos(texto) {
    const objetos = {};
    for (const trozo of String(texto || "")
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean)) {
        const m = /^(\d{1,2})\s*:\s*(.+)$/.exec(trozo);
        if (!m) return { ok: false, mensaje: `❌ «${trozo}» no tiene el formato nivel:objeto (por ejemplo 10:Candado).` };
        const nivel = Number(m[1]);
        if (nivel < 1 || nivel > NIVEL_MAX) return { ok: false, mensaje: `❌ El nivel ${nivel} no existe: del 1 al ${NIVEL_MAX}.` };
        const fila = catalogo.objetoPorNombre(m[2].trim());
        if (!fila) return { ok: false, mensaje: `❌ No hay ningún objeto que se llame «${m[2].trim()}» en el catálogo.` };
        objetos[nivel] = fila.id;
    }
    return { ok: true, objetos };
}

const auditar = (interaction, accion, detalles) =>
    adminAudit.logAdminAction({ guildId: interaction.guildId, actorId: interaction.user.id, action: accion, details: detalles });

/** Los botones del panel del pase. Devuelve true si era de aquí. */
async function handlePaseButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    if (id === "paneladmin_pase_home") await interaction.update(buildPaseHome(guildId));
    else if (id === "paneladmin_pase_activo") {
        const activo = !ajustes(guildId).activo;
        guildSettings.setSetting(guildId, "pase.activo", activo);
        auditar(interaction, "pase.activo", { activo });
        await interaction.update(buildPaseHome(guildId));
    } else if (id === "paneladmin_pase_topes") {
        const menu = new StringSelectMenuBuilder()
            .setCustomId("paneladmin_pase_tope_sel")
            .setPlaceholder("¿El tope de qué categoría?")
            .addOptions(Object.keys(CATEGORIAS).map((c) => ({ label: ETIQUETAS[c], value: c })));
        await interaction.reply({ ...efimero("Elige la categoría:"), components: [new ActionRowBuilder().addComponents(menu)] });
    } else if (id === "paneladmin_pase_curva") await interaction.showModal(modalCurva(guildId));
    else if (id === "paneladmin_pase_objetos") await interaction.showModal(modalObjetos(guildId));
    else return false;
    return true;
}

/** El menú de categoría de los topes → el formulario de ese tope. */
async function handlePaseStringSelect(interaction) {
    if (interaction.customId !== "paneladmin_pase_tope_sel") return false;
    const categoria = interaction.values[0];
    if (!CATEGORIAS[categoria]) await interaction.reply(efimero("❌ Esa categoría no existe."));
    else await interaction.showModal(modalTope(categoria, interaction.guildId));
    return true;
}

/** El selector del canal de anuncios (sin ninguno elegido, no se anuncia). */
async function handlePaseChannelSelect(interaction) {
    if (interaction.customId !== "paneladmin_pase_canal_select") return false;
    const canalId = interaction.values[0] || "";
    guildSettings.setSetting(interaction.guildId, "pase.canal_nivel", canalId);
    auditar(interaction, "pase.canal", { canalId });
    await interaction.update(buildPaseHome(interaction.guildId));
    return true;
}

/** Responde con la pantalla actualizada si el formulario viene de ella, o con un aviso privado. */
const responder = (interaction, mensaje) =>
    interaction.isFromMessage?.() ? interaction.update(buildPaseHome(interaction.guildId)) : interaction.reply(efimero(mensaje));

/** Un entero (solo dígitos) entre min y max, o null si no lo es (un campo vacío tampoco). */
const enteroEntre = (texto, min, max) => {
    const t = String(texto).trim();
    const n = Number(t);
    return /^\d+$/.test(t) && n >= min && n <= max ? n : null;
};

/** Los formularios del pase: un tope, la curva de niveles y los objetos. Devuelve true si era de aquí. */
async function handlePaseModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guildId;
    const tope = /^paneladmin_pase_modal_tope_(\w+)$/.exec(id);
    if (tope && CATEGORIAS[tope[1]]) {
        const valor = enteroEntre(interaction.fields.getTextInputValue("tope"), 0, TOPE_MAX);
        if (valor === null) {
            await interaction.reply(efimero(`❌ El tope es un número entero de 0 a ${TOPE_MAX}.`));
            return true;
        }
        guildSettings.setSetting(guildId, `pase.tope_${tope[1]}`, valor);
        auditar(interaction, "pase.tope", { categoria: tope[1], valor });
        await responder(interaction, `✅ Tope de ${ETIQUETAS[tope[1]]}: ${valor} XP al día.`);
        return true;
    }
    if (id === "paneladmin_pase_modal_curva") {
        const base = enteroEntre(interaction.fields.getTextInputValue("base"), 1, 10000);
        const paso = enteroEntre(interaction.fields.getTextInputValue("paso"), 0, 1000);
        if (base === null || paso === null) {
            await interaction.reply(efimero("❌ La XP del primer nivel va de 1 a 10000 y la que se suma en cada nivel, de 0 a 1000."));
            return true;
        }
        guildSettings.setManySettings(guildId, { "pase.xp_nivel_base": base, "pase.xp_nivel_paso": paso });
        auditar(interaction, "pase.curva", { base, paso });
        await responder(interaction, `✅ Cada nivel cuesta ${base} XP el primero y ${paso} más cada vez.`);
        return true;
    }
    if (id === "paneladmin_pase_modal_objetos") {
        const r = leerObjetos(interaction.fields.getTextInputValue("objetos"));
        if (!r.ok) {
            await interaction.reply(efimero(r.mensaje));
            return true;
        }
        guildSettings.setSetting(guildId, "pase.objetos", Object.keys(r.objetos).length ? JSON.stringify(r.objetos) : "");
        auditar(interaction, "pase.objetos", { objetos: r.objetos });
        await responder(interaction, "✅ Objetos por nivel actualizados.");
        return true;
    }
    return false;
}

module.exports = { buildPaseHome, leerObjetos, handlePaseButton, handlePaseStringSelect, handlePaseChannelSelect, handlePaseModal };
