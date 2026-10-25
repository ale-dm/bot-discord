// Pestaña "📋 Mis jugadas" de /juegos: lo que tienes en juego y lo ya resuelto, con apuestas a partidos y
// quinielas juntas. Las estadísticas de apuestas van en la pestaña 📊 Stats (paneles/juegos). Los datos, en
// systems/apuestas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const jugadas = require("../systems/apuestas/misJugadas");
const cancelar = require("../systems/apuestas/cancelar");
const cancelarCombinada = require("../systems/apuestas/cancelarCombinada");
const alertasCuota = require("../systems/apuestas/alertasCuota");
const { filasCancelar, buildConfirmarCancelar, buildConfirmarCancelarCombinada } = require("./misJugadasCancelar");
const { filasCashout, buildConfirmarCashout } = require("./misJugadasCashout");
const cashout = require("../systems/apuestas/cashout");
const sistemas = require("../systems/apuestas/sistemas");
const { textoSistema } = require("./sistemas");
const mercados = require("../systems/apuestas/mercados");
const { filaPestanas } = require("./pestanasJuegos");

const EMOJI_JUEGO = { blackjack: "🃏", tragaperras: "🎰", slots: "🎰", ruleta: "🎡", adivinar: "🔮", ppt: "✂️", rasca: "🎟️" };
const fecha = (iso) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const eleccionTexto = (a) => mercados.textoEleccion(a);
const signo = (n) => `${n >= 0 ? "+" : ""}${n.toLocaleString("es")}`;
// Discord corta los campos en 1.024 caracteres.
const campo = (texto) => (texto.length > 1024 ? `${texto.slice(0, 1020)}…` : texto);

/** Tus pronósticos de una quiniela: "1✅ X❌ 2⏳ …" y los aciertos de los partidos ya jugados. */
function lineaQuiniela(detalle) {
    const marcas = detalle.lineas.map((l) => `${l.pick}${l.acierto === null ? "⏳" : l.acierto ? "✅" : "❌"}`).join(" ");
    return `${marcas}\n🎯 **${detalle.aciertos}** aciertos de ${detalle.jugados} jugados (${detalle.total} partidos)`;
}

/** La cuota de una apuesta pendiente (#375): «@2.5», o «apostado a 2.5 · ahora 2.8 ↑» si se sabe la actual y el partido no ha empezado. */
function textoCuota(a) {
    const actual = jugadas.cuotaActual(a);
    if (actual == null || Date.parse(a.start_time) <= Date.now()) return `@${a.cuota}`;
    const flecha = actual > a.cuota ? "↑" : actual < a.cuota ? "↓" : "=";
    return `apostado a ${a.cuota} · ahora ${actual} ${flecha}`;
}

function textoPartidoPendiente(a) {
    return `**${a.home_team}** vs **${a.away_team}** · ${fecha(a.start_time)}\n🎯 ${eleccionTexto(a)} · ${a.cantidad} 🪙 ${textoCuota(a)} → ${Math.round(a.cantidad * a.cuota)} 🪙`;
}

function textoPartidoResuelto(a) {
    // premio NULL: liquidada antes de que se guardara el premio (no se sabe si ganó).
    const estado = a.retirada_en
        ? `💸 Retirada (+${a.premio})`
        : a.estado === "caducado"
          ? "↩️ Reembolsada (sin resultado)"
          : a.premio > 0
            ? `🏆 Ganada (+${a.premio})`
            : a.premio === 0
              ? "❌ Perdida"
              : "✔️ Liquidada";
    return `**${a.home_team}** vs **${a.away_team}** ${estado}\n🎯 ${eleccionTexto(a)} · ${a.cantidad} 🪙 @${a.cuota}`;
}

/** Una combinada: sus partidos con la elección de cada uno, y lo que cobra o cobró. */
function textoCombinada(c) {
    const cuando = `${c.patas.length} partidos · ${c.cantidad} 🪙 @${c.cuota}`;
    const estado =
        c.estado === "abierta"
            ? `→ ${Math.round(c.cantidad * c.cuota)} 🪙`
            : c.estado === "ganada"
              ? `🏆 Ganada (+${c.premio})`
              : c.estado === "perdida"
                ? "❌ Perdida"
                : c.estado === "retirada"
                  ? `💸 Retirada (+${c.premio})`
                  : c.estado === "cancelada"
                    ? "🚫 Cancelada (devuelta entera)"
                    : "↩️ Devuelta";
    const patas = c.patas.map((p) => `• ${p.home_team} vs ${p.away_team} · ${eleccionTexto(p)}`).join("\n");
    return `**${cuando}** ${estado}\n${patas}`;
}

function textoQuinielaCerrada(q) {
    const estado = q.reembolsada ? "↩️ Devuelta" : q.premio > 0 ? `🏆 +${q.premio}` : "❌ Sin premio";
    return `**${q.jornada}** · ${q.cantidad} 🪙 · ${estado}\n${lineaQuiniela(q.detalle)}`;
}

function filaVistas(userId, vista, deporteQuiniela = "laliga") {
    const boton = (id, label) =>
        new ButtonBuilder()
            .setCustomId(`misapuestas_${id}_${userId}`)
            .setLabel(label)
            .setStyle(vista === id ? ButtonStyle.Primary : ButtonStyle.Secondary);
    return [
        new ActionRowBuilder().addComponents(
            boton("activas", "⏳ En juego"),
            boton("historial", "📋 Resueltas"),
            new ButtonBuilder().setCustomId(`quiniela_refrescar_${deporteQuiniela}`).setLabel("🧾 Quiniela").setStyle(ButtonStyle.Success),
            // 🔁 Repetir la última apuesta (#349) y 📤 exportar el historial (#356): los atienden juegos/apuestas/repetir y exportar.
            new ButtonBuilder().setCustomId(`misapuestas_repetir_${userId}`).setLabel("🔁 Repetir última").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`misapuestas_exportar_${userId}`).setLabel("📤 CSV").setStyle(ButtonStyle.Secondary),
        ),
        filaPestanas(userId, "jugadas"),
    ];
}

/** 💼 Tu cartera (F-AP-04): lo que tienes en juego, lo que puedes cobrar de los partidos y el beneficio del mes. */
function textoCartera(c) {
    const partes = [];
    if (c.partidos) partes.push(`${c.partidos} ${c.partidos === 1 ? "partido" : "partidos"}`);
    if (c.quinielas) partes.push(`${c.quinielas} ${c.quinielas === 1 ? "quiniela" : "quinielas"}`);
    return (
        `💰 En juego: **${c.enJuego.toLocaleString("es")}** 🪙${partes.length ? ` (${partes.join(" y ")})` : ""}\n` +
        (c.partidos
            ? `🏆 Posible premio: **${c.posiblePremio.toLocaleString("es")}** 🪙 si aciertas tus partidos${c.quinielas ? " (sin la quiniela, que depende del bote)" : ""}\n`
            : "") +
        `📅 Beneficio de ${c.mes}: ${c.resueltasMes ? `**${signo(c.beneficioMes)}** 🪙 en ${c.resueltasMes} ${c.resueltasMes === 1 ? "apuesta resuelta" : "apuestas resueltas"}` : "nada resuelto todavía"}`
    );
}

function vistaActivas(userId, embed) {
    const partidos = jugadas.partidosDe(userId, { pendientes: true });
    const quinielas = jugadas.quinielasDe(userId, { abiertas: true });
    const casino = jugadas.ultimasCasino(userId, 5);
    embed.setTitle("⏳ Lo que tienes en juego");
    embed.setDescription(textoCartera(jugadas.cartera(userId)));
    embed.addFields({
        name: `⚽ Partidos (${partidos.length})`,
        value: campo(partidos.map(textoPartidoPendiente).join("\n\n") || "Ninguna apuesta pendiente."),
    });
    embed.addFields({
        name: `🧾 Quinielas (${quinielas.length})`,
        value: campo(
            quinielas.map((q) => `**${q.jornada}** · ${q.cantidad} 🪙\n${lineaQuiniela(q.detalle)}`).join("\n\n") ||
                "Ninguna quiniela abierta.",
        ),
    });
    const combinadas = jugadas.combinadasDe(userId, { abiertas: true, limite: 5 });
    embed.addFields({
        name: `🧩 Combinadas (${combinadas.length})`,
        value: campo(combinadas.map(textoCombinada).join("\n\n") || "Ninguna combinada abierta."),
    });
    // 🎛️ Sistemas (#534): con cada subcombinación.
    const enSistema = sistemas.de(userId, { abiertas: true });
    if (enSistema.length)
        embed.addFields({ name: `🎛️ Sistemas (${enSistema.length})`, value: campo(enSistema.map(textoSistema).join("\n\n")) });
    const alertas = alertasCuota.activasDe(userId);
    if (alertas.length) {
        embed.addFields({
            name: `🔔 Alertas de cuota (${alertas.length}/${alertasCuota.MAX_ALERTAS})`,
            value: campo(
                alertas
                    .map(
                        (a) =>
                            `**${a.home_team}** vs **${a.away_team}** · ${a.textoEleccion} ${a.direccion === "arriba" ? "≥" : "≤"} ${a.objetivo} (ahora ${a.actual ?? "—"})`,
                    )
                    .join("\n"),
            ),
        });
    }
    if (casino.length) {
        embed.addFields({
            name: "🎰 Últimas partidas del casino",
            value: casino.map((c) => `${EMOJI_JUEGO[c.juego] || "🎲"} ${signo(c.resultado)}`).join(" · "),
        });
    }
    return quinielas[0]?.deporte;
}

function vistaResueltas(userId, embed) {
    const partidos = jugadas.partidosDe(userId, { pendientes: false, limite: 8 });
    const quinielas = jugadas.quinielasDe(userId, { abiertas: false, limite: 3 });
    embed.setTitle("📋 Tus apuestas resueltas");
    embed.addFields(
        { name: "⚽ Partidos (últimos 8)", value: campo(partidos.map(textoPartidoResuelto).join("\n\n") || "Ninguna todavía.") },
        { name: "🧾 Quinielas (últimas 3)", value: campo(quinielas.map(textoQuinielaCerrada).join("\n\n") || "Ninguna todavía.") },
    );
    const combinadas = jugadas.combinadasDe(userId, { abiertas: false, limite: 3 });
    embed.addFields({
        name: "🧩 Combinadas (últimas 3)",
        value: campo(combinadas.map(textoCombinada).join("\n\n") || "Ninguna todavía."),
    });
    const sistemasCerrados = sistemas.de(userId, { abiertas: false });
    if (sistemasCerrados.length)
        embed.addFields({ name: "🎛️ Sistemas (últimos 3)", value: campo(sistemasCerrados.map(textoSistema).join("\n\n")) });
    return quinielas[0]?.deporte;
}

/** Campos de estadísticas de apuestas (partidos y quinielas) y el beneficio total; los usa la pestaña Stats. */
function camposStatsApuestas(userId) {
    const { partidos: p, quinielas: q } = jugadas.estadisticas(userId);
    const c = jugadas.estadisticasCombinadas(userId);
    const beneficio = p.ganado - p.apostado + (q.ganado - q.apostado) + (c.ganado - c.apostado);
    const acierto = p.ganadas + p.perdidas > 0 ? ((p.ganadas / (p.ganadas + p.perdidas)) * 100).toFixed(1) : "0";
    const campos = [
        {
            name: "⚽ Apuestas a partidos",
            value:
                `• **${p.ganadas}** ganadas | **${p.perdidas}** perdidas (${acierto}% de acierto)\n` +
                `• **${p.apostado}** apostado en las resueltas → **${p.ganado}** cobrado (${signo(p.ganado - p.apostado)})` +
                (p.enJuego ? `\n• **${p.enJuego}** en juego (${p.pendientes} pendientes)` : ""),
            inline: false,
        },
        {
            name: "🧾 Quinielas",
            value:
                `• **${q.total}** jugadas · **${q.ganadas}** con premio\n` +
                `• **${q.apostado}** apostado en las cerradas → **${q.ganado}** cobrado o devuelto (${signo(q.ganado - q.apostado)})` +
                (q.enJuego ? `\n• **${q.enJuego}** en juego (${q.pendientes} abiertas)` : ""),
            inline: false,
        },
        {
            name: "🧩 Combinadas",
            value:
                `• **${c.total}** jugadas · **${c.ganadas}** ganadas | **${c.perdidas}** perdidas\n` +
                `• **${c.apostado}** apostado en las cerradas → **${c.ganado}** cobrado o devuelto (${signo(c.ganado - c.apostado)})` +
                (c.enJuego ? `\n• **${c.enJuego}** en juego (${c.pendientes} abiertas)` : ""),
            inline: false,
        },
    ];
    return { campos, beneficio };
}

/**
 * Mis jugadas: vista "activas" (en juego) o "historial" (resueltas). `content`: un aviso encima (p. ej. tras cancelar).
 * `paginaCancelar`: la página del menú de cancelar.
 */
function buildMisJugadas(userId, vista = "activas", content = "", paginaCancelar = 0) {
    const embed = new EmbedBuilder().setColor(0x3498db).setTimestamp();
    const deporte = vista === "historial" ? vistaResueltas(userId, embed) : vistaActivas(userId, embed);
    const components = filaVistas(userId, vista === "historial" ? "historial" : "activas", deporte);
    const menuCancelar = vista === "historial" ? [] : filasCancelar(userId, paginaCancelar);
    // 💸 Cash-out (#529): una fila con lo que se puede retirar ahora (no pasa de las 5 filas: 2 de vistas, 2 de cancelar).
    const menuCashout = vista === "historial" ? [] : filasCashout(userId);
    // Los menús, antes de las pestañas de /juegos (que siempre van en la última fila).
    components.splice(components.length - 1, 0, ...menuCancelar, ...menuCashout);
    return { content, embeds: [embed], components };
}

/** Botones para después de apostar: ver lo apostado o seguir. */
function filaTrasApostar(userId, { deporte = "laliga", quiniela = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`misapuestas_activas_${userId}`).setLabel("📋 Mis jugadas").setStyle(ButtonStyle.Primary),
        quiniela
            ? new ButtonBuilder()
                  .setCustomId(`quiniela_refrescar_${deporte}`)
                  .setLabel("🧾 Ver la quiniela")
                  .setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder().setCustomId(`apuestas_pagina_${deporte}_1`).setLabel("⚽ Más partidos").setStyle(ButtonStyle.Secondary),
    );
}

// Botones de «Mis jugadas» (antes /misapuestas): cambian de vista en el mismo mensaje. Stats (de mensajes antiguos)
// abre la pestaña 📊 Stats. También ↩️ cancelar una apuesta (F-AP-05): se elige en el menú, se confirma y se vuelve
// a ⏳ En juego.
async function soloSuyas(interaction, userId) {
    if (interaction.user.id === userId) return true;
    await interaction.reply({ content: "❌ Solo puedes ver tus propias apuestas.", flags: MessageFlags.Ephemeral });
    return false;
}

const componentHandlers = [
    { types: ["button"], prefixes: ["misapuestas_"], method: "handleButton", acl: "juegos" },
    { types: ["stringSelect"], prefixes: ["misapuestas_cancelarsel_"], method: "handleSelect", acl: "juegos" },
    { types: ["stringSelect"], prefixes: ["misapuestas_cashsel_"], method: "handleCashoutSelect", acl: "juegos" },
];

// misapuestas_cashsel_{userId}: lo elegido para retirar («a» o «c» y el id) → oferta bloqueada 60 s y confirmación.
async function handleCashoutSelect(client, interaction) {
    const userId = interaction.customId.split("_")[2];
    if (!(await soloSuyas(interaction, userId))) return;
    const valor = interaction.values[0];
    const o = cashout.ofrecer(userId, valor[0] === "c" ? "c" : "a", valor.slice(1));
    await interaction.update(o.ok ? buildConfirmarCashout(userId, o) : buildMisJugadas(userId, "activas", `❌ ${o.motivo}`));
}

// misapuestas_cashok_{token}_{userId}: cobra la oferta si sigue valiendo; si no, enseña la recalculada.
async function confirmarCashout(interaction, token, userId) {
    if (!(await soloSuyas(interaction, userId))) return;
    const r = cashout.confirmar(userId, token);
    if (r.ok) return interaction.update(buildMisJugadas(userId, "activas", r.mensaje));
    if (r.nueva?.ok) return interaction.update(buildConfirmarCashout(userId, r.nueva, `⚠️ ${r.motivo} Nuevo valor:`));
    return interaction.update(buildMisJugadas(userId, "activas", `❌ ${r.motivo}`));
}

// misapuestas_{vista}_{userId}: solo quien las abrió puede cambiar de vista.
// misapuestas_cancelarok_{apuestaId}_{userId}: confirma la cancelación.
async function handleButton(client, interaction) {
    const partes = interaction.customId.split("_");
    if (partes[1] === "cashok") return confirmarCashout(interaction, partes[2], partes[3]);
    if (partes[1] === "cancelarokc") {
        const [, , combinadaId, userId] = partes;
        if (!(await soloSuyas(interaction, userId))) return;
        const r = cancelarCombinada.cancelar(userId, combinadaId);
        await interaction.update(buildMisJugadas(userId, "activas", r.mensaje));
        return;
    }
    if (partes[1] === "cancelarok") {
        const [, , apuestaId, userId] = partes;
        if (!(await soloSuyas(interaction, userId))) return;
        const r = cancelar.cancelar(userId, apuestaId);
        await interaction.update(buildMisJugadas(userId, "activas", r.mensaje));
        return;
    }
    // misapuestas_cancelpag_{userId}_{página}: otra página del menú de cancelar.
    if (partes[1] === "cancelpag") {
        const [, , userId, pagina] = partes;
        if (!/^\d+$/.test(pagina) || !(await soloSuyas(interaction, userId))) return;
        await interaction.update(buildMisJugadas(userId, "activas", "", Number(pagina)));
        return;
    }
    const [, vista, userId] = partes;
    if (!(await soloSuyas(interaction, userId))) return;
    // Se pide aquí: paneles/juegos usa este módulo, y al revés daría un ciclo al cargar.
    const { buildStatsJuegos } = require("./juegos");
    await interaction.update(
        vista === "stats" ? { content: "", ...buildStatsJuegos(userId, interaction.user.username) } : buildMisJugadas(userId, vista),
    );
}

// misapuestas_cancelarsel_{userId}: la apuesta elegida para cancelar → pantalla de confirmación.
async function handleSelect(client, interaction) {
    const userId = interaction.customId.split("_")[2];
    if (!(await soloSuyas(interaction, userId))) return;
    // «n» y el id: una alerta de cuota (#345): se quita sin más, no hay dinero de por medio.
    if (interaction.values[0].startsWith("n")) {
        const quitada = alertasCuota.cancelar(userId, interaction.values[0].slice(1));
        await interaction.update(buildMisJugadas(userId, "activas", quitada ? "🔔 Alerta cancelada." : "Esa alerta ya no existe."));
        return;
    }
    // «c» y el id: una combinada (#296); si no, una apuesta suelta.
    if (interaction.values[0].startsWith("c")) {
        const c = cancelarCombinada.cancelable(userId, interaction.values[0].slice(1));
        await interaction.update(
            c
                ? buildConfirmarCancelarCombinada(userId, c)
                : buildMisJugadas(userId, "activas", "❌ Esa combinada ya no se puede cancelar: algún partido ha empezado."),
        );
        return;
    }
    const a = cancelar.cancelable(userId, interaction.values[0]);
    if (!a) {
        await interaction.update(buildMisJugadas(userId, "activas", "❌ Esa apuesta ya no se puede cancelar: el partido ha empezado."));
        return;
    }
    await interaction.update(buildConfirmarCancelar(userId, a));
}

module.exports = {
    buildMisJugadas,
    filaTrasApostar,
    lineaQuiniela,
    camposStatsApuestas,
    componentHandlers,
    handleButton,
    handleSelect,
    handleCashoutSelect,
};
