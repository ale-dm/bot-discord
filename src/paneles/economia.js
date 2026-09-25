// Panel 💰 Economía (/banco): tu 💵 efectivo (lo que gastas) y tu 🏦 banco (el sitio seguro), con
// Ingresar, Sacar, Transferir, Movimientos (historial con filtro por tipo) y los más ricos. También el botón
// "💵 Sacar del banco" que ponen el casino, la tienda y la cripto cuando no te llega el efectivo.
// Los datos, en systems/dinero; los botones los atiende /banco (dinero_*).
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const dinero = require("../systems/dinero");

const POR_PAGINA = 10;
const fmt = (n) => Number(n || 0).toLocaleString("es");
const signo = (n) => `${n > 0 ? "+" : ""}${fmt(n)}`;

function botonVolver() {
    return new ButtonBuilder().setCustomId("dinero_panel").setLabel("◀ Economía").setStyle(ButtonStyle.Secondary);
}

/**
 * Botón "💵 Sacar del banco" para pantallas donde no te llega el efectivo. `volver` es el customId de la
 * pantalla a la que se vuelve después de sacar (se repinta con el efectivo nuevo): ver commands/economia/banco.
 */
function botonSacar(volver) {
    return new ButtonBuilder().setCustomId(`dinero_sacar_${volver}`).setLabel("💵 Sacar del banco").setStyle(ButtonStyle.Success);
}

/** "💵 Efectivo: X · 🏦 Banco: Y" para las pantallas donde se gasta. */
function lineaDinero(userId) {
    const c = dinero.cuenta(userId);
    return `💵 Efectivo: **${fmt(c.efectivo)}** 🪙 · 🏦 Banco: **${fmt(c.banco)}** 🪙`;
}

function buildEconomia(userId, username, aviso = null) {
    const c = dinero.cuenta(userId);
    const embed = new EmbedBuilder()
        .setTitle(`💰 Economía · ${username}`)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "💵 El **efectivo** es lo que gastas: casino, apuestas, tienda, cripto y transferencias. " +
                "🏦 El **banco** es el sitio seguro: ahí no se gasta, hay que sacarlo antes.",
        )
        .addFields(
            { name: "💵 Efectivo", value: `**${fmt(c.efectivo)}** 🪙`, inline: true },
            { name: "🏦 Banco", value: `**${fmt(c.banco)}** 🪙`, inline: true },
            { name: "💰 Total", value: `**${fmt(c.total)}** 🪙`, inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("dinero_ingresar")
            .setLabel("🏦 Ingresar")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(c.efectivo <= 0),
        new ButtonBuilder()
            .setCustomId("dinero_sacar")
            .setLabel("💵 Sacar")
            .setStyle(ButtonStyle.Success)
            .setDisabled(c.banco <= 0),
        new ButtonBuilder()
            .setCustomId("dinero_transferir")
            .setLabel("💸 Transferir")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(c.efectivo <= 0),
        new ButtonBuilder().setCustomId("dinero_mov_todo_0").setLabel("📜 Movimientos").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dinero_ricos").setLabel("🏆 Más ricos").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
}

/** Historial de movimientos con filtro por tipo (`todo` = sin filtro) y páginas. */
function buildMovimientos(userId, tipo = "todo", pagina = 0) {
    const filtro = tipo === "todo" ? null : tipo;
    const { total, filas } = dinero.movimientos(userId, { tipo: filtro, limite: POR_PAGINA, offset: pagina * POR_PAGINA });
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const lineas = filas.map((m) => {
        const cuando = new Date(m.fecha).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const icono = (dinero.TIPOS[m.tipo] || "📦").split(" ")[0];
        return `${icono} \`${cuando}\` ${m.descripcion} · **${signo(m.cantidad)}**`;
    });
    const embed = new EmbedBuilder()
        .setTitle(`📜 Movimientos${filtro ? ` · ${dinero.TIPOS[filtro]}` : ""}`)
        .setDescription(lineas.join("\n").slice(0, 4000) || "No hay movimientos.")
        .setFooter({ text: `Página ${pagina + 1} de ${paginas} · ${total} movimientos` })
        .setColor(0x95a5a6);
    const selector = new StringSelectMenuBuilder()
        .setCustomId("dinero_filtro")
        .setPlaceholder("Filtrar por tipo")
        .addOptions(
            [["todo", "📋 Todo"], ...Object.entries(dinero.TIPOS)].map(([value, label]) => ({
                label,
                value,
                default: value === tipo,
            })),
        );
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`dinero_mov_${tipo}_${pagina - 1}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina <= 0),
        new ButtonBuilder()
            .setCustomId(`dinero_mov_${tipo}_${pagina + 1}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= paginas - 1),
        botonVolver(),
    );
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(selector), nav] };
}

function buildRicos() {
    const medallas = ["🥇", "🥈", "🥉"];
    const lineas = dinero
        .masRicos(10)
        .map(
            (r, i) =>
                `${medallas[i] || `**${i + 1}.**`} <@${r.userId}> — **${fmt(r.total)}** 🪙 (💵 ${fmt(r.efectivo)} · 🏦 ${fmt(r.banco)})`,
        );
    const embed = new EmbedBuilder()
        .setTitle("🏆 Los más ricos")
        .setDescription(lineas.join("\n") || "No hay datos todavía.")
        .setFooter({ text: "Efectivo + banco" })
        .setColor(0xf1c40f);
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(botonVolver())] };
}

function buildElegirDestinatario() {
    const embed = new EmbedBuilder()
        .setTitle("💸 Transferir")
        .setDescription("¿A quién? Se transfiere de tu 💵 efectivo al suyo.")
        .setColor(0x3498db);
    return {
        content: "",
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId("dinero_transferir_a")
                    .setPlaceholder("Elige a quién")
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
            new ActionRowBuilder().addComponents(botonVolver()),
        ],
    };
}

/** Formulario de una cantidad (ingresar, sacar o transferir). */
function modalCantidad(customId, titulo, disponible) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(titulo)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("cantidad")
                    .setLabel(`Cantidad (tienes ${fmt(disponible)})`.slice(0, 45))
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(String(disponible))
                    .setMinLength(1)
                    .setMaxLength(9)
                    .setRequired(true),
            ),
        );
}

module.exports = { botonSacar, lineaDinero, buildEconomia, buildMovimientos, buildRicos, buildElegirDestinatario, modalCantidad };
