// Pestaña 💰 Economía de /perfil: 💵 efectivo (lo que gastas) y 🏦 banco (el sitio seguro), lo ganado y
// perdido en el casino, la cartera cripto y los objetos; en tu perfil, con Ingresar, Sacar, Transferir,
// Movimientos (historial con filtro por tipo) y el 🧙 préstamo del Duende si hay uno (con
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
} = require("discord.js");
const repo = require("../repositorios/dinero");
const dinero = require("../systems/dinero");
const { filaPestanasPerfil } = require("./pestanasPerfil");
const { fmtNumero } = require("../core/formato");
const { filasImporte } = require("./importes");
const patrimonio = require("../systems/patrimonio");
const patrimonioDiario = require("../systems/patrimonioDiario");
const privacidad = require("../systems/privacidadEconomia");

const POR_PAGINA = 10;
const signo = (n) => `${n > 0 ? "+" : ""}${fmtNumero(n)}`;

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
    return `💵 Efectivo: **${fmtNumero(c.efectivo)}** 🪙 · 🏦 Banco: **${fmtNumero(c.banco)}** 🪙`;
}

/**
 * Ganado y perdido en el casino (resultado neto de cada partida). Se lee una fila de `casino_resumen`, que mantienen
 * triggers sobre la tabla `casino` (migración 048): no se suman todas las jugadas en cada render (#484).
 */
function resumenCasino(userId) {
    return repo.resumenCasino(userId) || { ganado: 0, perdido: 0 };
}

/** La cartera cripto valorada (con una caché de 30 s, #487). Si el mercado falla, sale sin valorar. */
async function carteraDe(targetId, guildId) {
    try {
        return await require("../systems/cripto/valoracion").obtener(guildId, targetId, () =>
            require("../systems/cripto/mercado").valorarCartera(targetId, guildId),
        );
    } catch {
        // Si el mercado falla, la cartera sale sin valorar.
        return { lineas: [], total: 0 };
    }
}

/** Los campos de patrimonio de 💰 Economía: 🏦 lo cobrado (#350), ⏳ el próximo cobro y su estimación (#347, solo propio) y 📈 la evolución (#388). */
function camposPatrimonio(targetId, propio) {
    const campos = [];
    const r = patrimonio.resumen(targetId);
    const linea = (p) => `interés **${signo(p.interes)}** · impuesto **${signo(-p.impuesto)}** · neto **${signo(p.neto)}**`;
    campos.push({
        name: "🏦 Patrimonio",
        value: r ? `Desde siempre: ${linea(r.total)}\nÚltimo mes: ${linea(r.mes)}` : "Sin cobros de patrimonio todavía",
    });
    if (propio) {
        const p = patrimonio.prevision(targetId);
        campos.push({
            name: "⏳ Próximo cobro de patrimonio",
            value: p.proximo
                ? `<t:${Math.floor(p.proximo / 1000)}:R> · si fuera ahora: interés **+${fmtNumero(p.interes)}** · impuesto **-${fmtNumero(p.impuesto)}**`
                : "El conteo empieza en el próximo chequeo horario.",
        });
    }
    const e = patrimonioDiario.evolucion(targetId);
    campos.push({
        name: "📈 Últimos 30 días",
        value: e ? `\`${e.barras}\`\nCambio neto (${e.dias} días): **${signo(e.neto)}** 🪙` : "Todavía sin historial",
    });
    return campos;
}

function embedEconomia({ nombre, aviso, c, ganado, perdido, objetos, cartera, prestamo, propio = false, targetId = null }) {
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
            { name: "💵 Efectivo", value: `**${fmtNumero(c.efectivo)}** 🪙`, inline: true },
            { name: "🏦 Banco", value: `**${fmtNumero(c.banco)}** 🪙`, inline: true },
            { name: "💰 Total", value: `**${fmtNumero(c.total)}** 🪙`, inline: true },
            { name: "🥷 Dinero negro", value: `**${fmtNumero(c.negro)}** 🪙`, inline: true },
            { name: "📈 Ganado en casino", value: `+${fmtNumero(ganado)}`, inline: true },
            { name: "📉 Perdido en casino", value: `-${fmtNumero(perdido)}`, inline: true },
            { name: "🎒 Objetos", value: fmtNumero(objetos), inline: true },
        )
        .setColor(0xf1c40f)
        .setTimestamp();
    if (targetId) embed.addFields(...camposPatrimonio(targetId, propio));
    if (cartera.lineas.length) {
        const lineas = cartera.lineas.map(
            (l) => `${l.info?.emoji || "💰"} **${l.cantidad.toFixed(4)} ${l.cripto}** ≈ ${fmtNumero(Math.floor(l.valor))} 🪙`,
        );
        embed.addFields({
            name: "💹 Cartera cripto",
            value: `${lineas.join("\n")}\nTotal ≈ **${fmtNumero(Math.floor(cartera.total))}** 🪙`,
        });
    }
    // 🧙 Préstamo del Duende (F-DU-03), si tiene uno sin devolver.
    if (prestamo) {
        const vence = Math.floor(prestamo.vence_en / 1000);
        embed.addFields({
            name: "🧙 Préstamo del Duende",
            value:
                prestamo.estado === "deuda"
                    ? `Debe **${fmtNumero(prestamo.falta)}** 🪙: venció <t:${vence}:R> y se va cobrando de lo que gane. Hasta saldarlo, ni otro préstamo ni apuestas con el Duende.`
                    : `Devuelve **${fmtNumero(prestamo.falta)}** 🪙 antes del <t:${vence}:f> (<t:${vence}:R>). Si no, se cobra solo.`,
        });
    }
    return embed;
}

// Las filas de botones: acciones de dinero (solo en la propia cuenta), movimientos, y el préstamo, los negocios y el límite
// de pérdidas en su fila: la de acciones ya puede tener 5 botones.
function filasEconomia({ viewerId, targetId, propio, c, prestamo }) {
    const movimientos = new ButtonBuilder()
        .setCustomId(`dinero_mov_todo_0_${targetId}`)
        .setLabel("📜 Movimientos")
        .setStyle(ButtonStyle.Secondary);
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
          )
        : new ActionRowBuilder().addComponents(movimientos);
    const devolver =
        propio && prestamo
            ? [
                  new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                          .setCustomId("dinero_prestamo_devolver")
                          .setLabel(`🧙 Devolver ${fmtNumero(prestamo.falta)} al Duende`)
                          .setStyle(ButtonStyle.Success),
                  ),
              ]
            : [];
    const negocios = propio
        ? [
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId("dinero_negocios").setLabel("🏪 Negocios").setStyle(ButtonStyle.Secondary),
                  new ButtonBuilder().setCustomId("dinero_limite").setLabel("🛡️ Límite de pérdidas").setStyle(ButtonStyle.Secondary),
                  // 🛡️ Seguro antirrobo (#526): comprar o renovar la protección contra /robar.
                  new ButtonBuilder().setCustomId("dinero_seguro").setLabel("🛡️ Seguro antirrobo").setStyle(ButtonStyle.Secondary),
                  // 📈 Depósito a plazo (#518): guardar dinero del banco con interés.
                  new ButtonBuilder().setCustomId("dinero_deposito").setLabel("📈 Depósito").setStyle(ButtonStyle.Secondary),
                  // 🙈 Ocultar mi economía a los demás (#377): el botón dice lo que hará.
                  new ButtonBuilder()
                      .setCustomId(`dinero_privada_${privacidad.oculta(viewerId) ? 0 : 1}`)
                      .setLabel(privacidad.oculta(viewerId) ? "👁️ Enseñar mi economía" : "🙈 Ocultar mi economía")
                      .setStyle(ButtonStyle.Secondary),
              ),
          ]
        : [];
    return [acciones, ...devolver, ...negocios, filaPestanasPerfil(viewerId, targetId, "eco")];
}

/** Lo que ve otra persona si la economía está oculta (#377). */
function pantallaOculta(viewerId, targetId, nombre) {
    const embed = new EmbedBuilder()
        .setTitle(`💰 Economía · ${nombre}`)
        .setDescription(`<@${targetId}> ha ocultado su economía. 🙈`)
        .setColor(0x95a5a6);
    return { content: "", embeds: [embed], components: [filaPestanasPerfil(viewerId, targetId, "eco")] };
}

/**
 * La pestaña Economía. `viewerId` mira, `targetId` es de quien es; si son la misma persona, con acciones.
 * @returns {Promise<object>} payload
 */
async function buildEconomia({ viewerId, targetId = viewerId, nombre, guildId = null, aviso = null }) {
    const propio = viewerId === targetId;
    if (!privacidad.puedeVer(viewerId, targetId)) return pantallaOculta(viewerId, targetId, nombre);
    const c = dinero.cuenta(targetId);
    const { ganado, perdido } = resumenCasino(targetId);
    const cartera = await carteraDe(targetId, guildId);
    const objetos = repo.objetosEnInventario(targetId);
    const prestamo = require("../systems/prestamos").abierto(targetId);

    const embed = embedEconomia({ nombre, aviso, c, ganado, perdido, objetos, cartera, prestamo, propio, targetId });
    const components = filasEconomia({ viewerId, targetId, propio, c, prestamo });
    return { content: "", embeds: [embed], components };
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
            // Discord admite 25 opciones por selector: "todo" + los tipos, sin el cajón "otro" (sus movimientos salen en Todo).
            // Si algún día hay más tipos reales, esto necesita paginación.
            [
                ["todo", "📋 Todo"],
                ...Object.entries(dinero.TIPOS)
                    .filter(([clave]) => clave !== "otro")
                    .slice(0, 24),
            ].map(([value, label]) => ({
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
    // 📤 Exportar a CSV (#411): solo los movimientos propios, con el filtro activo.
    if (viewerId === targetId) {
        nav.addComponents(
            new ButtonBuilder().setCustomId(`dinero_exportar_${tipo}`).setLabel("📤 Exportar").setStyle(ButtonStyle.Secondary),
        );
    }
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(selector), nav] };
}

/** Líneas del ranking de riqueza (efectivo + banco), para la pestaña Rankings. */
function lineasRicos(limite = 10) {
    const medallas = ["🥇", "🥈", "🥉"];
    return dinero
        .masRicos(limite)
        .map(
            (r, i) =>
                `${medallas[i] || `**${i + 1}.**`} <@${r.userId}> — **${fmtNumero(r.total)}** 🪙 (💵 ${fmtNumero(r.efectivo)} · 🏦 ${fmtNumero(r.banco)})`,
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
            ...filasImporte({
                textoEtiqueta: `Otra cantidad (tienes ${fmtNumero(disponible)})`,
                placeholder: String(disponible),
                maxLength: 9,
                todo: disponible,
            }),
        );
}

module.exports = {
    resumenCasino,
    botonSacar,
    lineaDinero,

    buildEconomia,
    buildMovimientos,
    lineasRicos,
    buildElegirDestinatario,
    modalCantidad,
};
