// Pestaña 💰 Economía de /perfil: 💵 efectivo (lo que gastas) y 🏦 banco (el sitio seguro), lo ganado y
// perdido en el casino, la cartera cripto y los objetos; en tu perfil, con Ingresar, Sacar, Transferir,
// Movimientos (historial con filtro por tipo) y 🎁 Diario (systems/diario), y el 🧙 préstamo del Duende si hay uno (con
// su botón para devolverlo: systems/prestamos). En el de otro se ve todo, pero sin acciones.
// También el botón "💵 Sacar del banco" que ponen el casino, la tienda y la cripto cuando no te llega el
// efectivo. Los datos, en systems/dinero; los botones dinero_* los atiende src/perfil/dinero.
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
const db = require("../core/db");
const dinero = require("../systems/dinero");
const { filaPestanasPerfil } = require("./pestanasPerfil");

const POR_PAGINA = 10;
const fmt = (n) => Number(n || 0).toLocaleString("es");
const signo = (n) => `${n > 0 ? "+" : ""}${fmt(n)}`;

function botonVolver(viewerId, targetId) {
    return new ButtonBuilder().setCustomId(`perfil_eco_${viewerId}_${targetId}`).setLabel("◀ Economía").setStyle(ButtonStyle.Secondary);
}

/**
 * Botón "💵 Sacar del banco" para pantallas donde no te llega el efectivo. `volver` es el customId de la
 * pantalla a la que se vuelve después de sacar (se repinta con el efectivo nuevo): ver src/perfil/dinero.
 */
function botonSacar(volver) {
    return new ButtonBuilder().setCustomId(`dinero_sacar_${volver}`).setLabel("💵 Sacar del banco").setStyle(ButtonStyle.Success);
}

/** "💵 Efectivo: X · 🏦 Banco: Y" para las pantallas donde se gasta. */
function lineaDinero(userId) {
    const c = dinero.cuenta(userId);
    return `💵 Efectivo: **${fmt(c.efectivo)}** 🪙 · 🏦 Banco: **${fmt(c.banco)}** 🪙`;
}

// Ganado y perdido en el casino, de la tabla `casino` (resultado neto de cada partida).
function resumenCasino(userId) {
    return db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN resultado > 0 THEN resultado ELSE 0 END), 0) AS ganado,
                    COALESCE(SUM(CASE WHEN resultado < 0 THEN -resultado ELSE 0 END), 0) AS perdido
             FROM casino WHERE userId = ?`,
        )
        .get(userId);
}

/**
 * La pestaña Economía. `viewerId` mira, `targetId` es de quien es; si son la misma persona, con acciones.
 * @returns {Promise<object>} payload
 */
async function buildEconomia({ viewerId, targetId = viewerId, nombre, guildId = null, aviso = null }) {
    const propio = viewerId === targetId;
    const c = dinero.cuenta(targetId);
    const { ganado, perdido } = resumenCasino(targetId);
    let cartera = { lineas: [], total: 0 };
    try {
        cartera = await require("../systems/cripto/mercado").valorarCartera(targetId, guildId);
    } catch {
        // Sin precios de CoinGecko, la cartera sale sin valorar.
    }
    const objetos = db.prepare("SELECT COUNT(*) AS n FROM inventario WHERE userId = ?").get(targetId).n;

    const embed = new EmbedBuilder()
        .setTitle(`💰 Economía · ${nombre}`)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "💵 El **efectivo** es lo que se gasta: casino, apuestas, tienda, cripto y transferencias. " +
                "🏦 El **banco** es el sitio seguro: ahí no se gasta, hay que sacarlo antes. " +
                "🥷 El **dinero negro** es lo robado con `/robar`: se gasta igual en tienda/casino/apuestas, " +
                "pero no se puede meter en el banco ni cuenta como patrimonio hasta blanquearse.",
        )
        .addFields(
            { name: "💵 Efectivo", value: `**${fmt(c.efectivo)}** 🪙`, inline: true },
            { name: "🏦 Banco", value: `**${fmt(c.banco)}** 🪙`, inline: true },
            { name: "💰 Total", value: `**${fmt(c.total)}** 🪙`, inline: true },
            { name: "🥷 Dinero negro", value: `**${fmt(c.negro)}** 🪙`, inline: true },
            { name: "📈 Ganado en casino", value: `+${fmt(ganado)}`, inline: true },
            { name: "📉 Perdido en casino", value: `-${fmt(perdido)}`, inline: true },
            { name: "🎒 Objetos", value: fmt(objetos), inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();
    if (cartera.lineas.length) {
        const lineas = cartera.lineas.map(
            (l) => `${l.info?.emoji || "💰"} **${l.cantidad.toFixed(4)} ${l.cripto}** ≈ ${fmt(Math.floor(l.valor))} 🪙`,
        );
        embed.addFields({ name: "💹 Cartera cripto", value: `${lineas.join("\n")}\nTotal ≈ **${fmt(Math.floor(cartera.total))}** 🪙` });
    }
    // 🧙 Préstamo del Duende (F-DU-03), si tiene uno sin devolver.
    const prestamo = require("../systems/prestamos").abierto(targetId);
    if (prestamo) {
        const vence = Math.floor(prestamo.vence_en / 1000);
        embed.addFields({
            name: "🧙 Préstamo del Duende",
            value:
                prestamo.estado === "deuda"
                    ? `Debe **${fmt(prestamo.falta)}** 🪙: venció <t:${vence}:R> y se va cobrando de lo que gane. Hasta saldarlo, ni otro préstamo ni apuestas con el Duende.`
                    : `Devuelve **${fmt(prestamo.falta)}** 🪙 antes del <t:${vence}:f> (<t:${vence}:R>). Si no, se cobra solo.`,
        });
    }
    const diario = propio ? require("../systems/diario").estado(guildId, targetId) : null;
    if (diario?.activo) {
        embed.addFields({
            name: "🎁 Recompensa diaria",
            value: diario.disponible
                ? `Disponible: **${fmt(diario.cantidad)}** 🪙${diario.racha ? ` (racha de ${diario.racha} días)` : ""}`
                : `Cobrada hoy. Mañana: **${fmt(diario.cantidad)}** 🪙 si mantienes la racha.`,
        });
    }

    const movimientos = new ButtonBuilder()
        .setCustomId(`dinero_mov_todo_0_${targetId}`)
        .setLabel("📜 Movimientos")
        .setStyle(ButtonStyle.Secondary);
    const botonDiario = diario?.activo
        ? [
              new ButtonBuilder()
                  .setCustomId("dinero_diario")
                  .setLabel(diario.disponible ? "🎁 Diario" : "🎁 Mañana")
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(!diario.disponible),
          ]
        : [];
    const acciones = propio
        ? new ActionRowBuilder().addComponents(
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
              movimientos,
              ...botonDiario,
          )
        : new ActionRowBuilder().addComponents(movimientos);
    // En su fila: la de acciones ya puede tener 5 botones.
    const devolver =
        propio && prestamo
            ? [
                  new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                          .setCustomId("dinero_prestamo_devolver")
                          .setLabel(`🧙 Devolver ${fmt(prestamo.falta)} al Duende`)
                          .setStyle(ButtonStyle.Success),
                  ),
              ]
            : [];
    const negocios = propio
        ? [
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId("dinero_negocios").setLabel("🏪 Negocios").setStyle(ButtonStyle.Secondary),
              ),
          ]
        : [];
    return {
        content: "",
        embeds: [embed],
        components: [acciones, ...devolver, ...negocios, filaPestanasPerfil(viewerId, targetId, "eco")],
    };
}

/** Historial de movimientos de `targetId` con filtro por tipo (`todo` = sin filtro) y páginas. */
function buildMovimientos(viewerId, targetId, tipo = "todo", pagina = 0) {
    const filtro = tipo === "todo" ? null : tipo;
    const { total, filas } = dinero.movimientos(targetId, { tipo: filtro, limite: POR_PAGINA, offset: pagina * POR_PAGINA });
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const lineas = filas.map((m) => {
        const cuando = new Date(m.fecha).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const icono = (dinero.TIPOS[m.tipo] || "📦").split(" ")[0];
        return `${icono} \`${cuando}\` ${m.descripcion} · **${signo(m.cantidad)}**`;
    });
    const embed = new EmbedBuilder()
        .setTitle(`📜 Movimientos${filtro ? ` · ${dinero.TIPOS[filtro]}` : ""}${viewerId === targetId ? "" : ` de <@${targetId}>`}`)
        .setDescription(lineas.join("\n").slice(0, 4000) || "No hay movimientos.")
        .setFooter({ text: `Página ${pagina + 1} de ${paginas} · ${total} movimientos` })
        .setColor(0x95a5a6);
    const selector = new StringSelectMenuBuilder()
        .setCustomId(`dinero_filtro_${targetId}`)
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
            .setCustomId(`dinero_mov_${tipo}_${pagina - 1}_${targetId}`)
            .setLabel("◀")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina <= 0),
        new ButtonBuilder()
            .setCustomId(`dinero_mov_${tipo}_${pagina + 1}_${targetId}`)
            .setLabel("▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pagina >= paginas - 1),
        botonVolver(viewerId, targetId),
    );
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(selector), nav] };
}

/** Líneas del ranking de riqueza (efectivo + banco), para la pestaña Rankings. */
function lineasRicos(limite = 10) {
    const medallas = ["🥇", "🥈", "🥉"];
    return dinero
        .masRicos(limite)
        .map(
            (r, i) =>
                `${medallas[i] || `**${i + 1}.**`} <@${r.userId}> — **${fmt(r.total)}** 🪙 (💵 ${fmt(r.efectivo)} · 🏦 ${fmt(r.banco)})`,
        );
}

function buildElegirDestinatario(viewerId) {
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
            new ActionRowBuilder().addComponents(botonVolver(viewerId, viewerId)),
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

module.exports = {
    botonSacar,
    lineaDinero,
    resumenCasino,
    buildEconomia,
    buildMovimientos,
    lineasRicos,
    buildElegirDestinatario,
    modalCantidad,
};
