// Pestaña "📋 Mis jugadas" de /juegos: lo que tienes en juego y lo ya resuelto, con apuestas a partidos y
// quinielas juntas. Las estadísticas de apuestas van en la pestaña 📊 Stats (paneles/juegos). Los datos, en
// systems/apuestas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const jugadas = require("../systems/apuestas/misJugadas");
const cancelar = require("../systems/apuestas/cancelar");
const mercados = require("../systems/apuestas/mercados");
const { filaPestanas } = require("./pestanasJuegos");

const EMOJI_JUEGO = { blackjack: "🃏", tragaperras: "🎰", slots: "🎰", ruleta: "🎡", adivinar: "🔮", ppt: "✂️" };
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

function textoPartidoPendiente(a) {
    return `**${a.home_team}** vs **${a.away_team}** · ${fecha(a.start_time)}\n🎯 ${eleccionTexto(a)} · ${a.cantidad} 🪙 @${a.cuota} → ${Math.round(a.cantidad * a.cuota)} 🪙`;
}

function textoPartidoResuelto(a) {
    // premio NULL: liquidada antes de que se guardara el premio (no se sabe si ganó).
    const estado =
        a.estado === "caducado"
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

/** ↩️ Menú para cancelar una apuesta a un partido que aún no ha empezado (F-AP-05), o null si no hay ninguna. */
function filaCancelar(userId) {
    const lista = cancelar.cancelables(userId).slice(0, 25);
    if (!lista.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`misapuestas_cancelarsel_${userId}`)
            .setPlaceholder(`↩️ Cancelar una apuesta (comisión del ${cancelar.COMISION_PCT} %)`)
            .addOptions(
                lista.map((a) => ({
                    label: `${a.home_team} vs ${a.away_team}`.slice(0, 100),
                    description: `${eleccionTexto(a)} · ${a.cantidad} 🪙 → te devuelvo ${a.devolucion} 🪙`.slice(0, 100),
                    value: String(a.id),
                })),
            ),
    );
}

/** Mis jugadas: vista "activas" (en juego) o "historial" (resueltas). `content`: un aviso encima (p. ej. tras cancelar). */
function buildMisJugadas(userId, vista = "activas", content = "") {
    const embed = new EmbedBuilder().setColor(0x3498db).setTimestamp();
    const deporte = vista === "historial" ? vistaResueltas(userId, embed) : vistaActivas(userId, embed);
    const components = filaVistas(userId, vista === "historial" ? "historial" : "activas", deporte);
    const menuCancelar = vista === "historial" ? null : filaCancelar(userId);
    // El menú, antes de las pestañas de /juegos (que siempre van en la última fila).
    if (menuCancelar) components.splice(components.length - 1, 0, menuCancelar);
    return { content, embeds: [embed], components };
}

/** ¿Seguro? Antes de cancelar una apuesta: qué se devuelve y cuánto se queda de comisión. */
function buildConfirmarCancelar(userId, a) {
    const unix = Math.floor(Date.parse(a.start_time) / 1000);
    const embed = new EmbedBuilder()
        .setTitle("↩️ ¿Cancelar esta apuesta?")
        .setDescription(
            `**${a.home_team}** vs **${a.away_team}** · empieza <t:${unix}:R>
` +
                `🎯 ${eleccionTexto(a)} · ${a.cantidad.toLocaleString("es")} 🪙 @${a.cuota}

` +
                `Te devuelvo **${a.devolucion.toLocaleString("es")}** 🪙 al efectivo: lo apostado menos **${a.comision.toLocaleString("es")}** 🪙 ` +
                `de comisión (el ${cancelar.COMISION_PCT} %).`,
        )
        .setColor(0xe67e22);
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`misapuestas_cancelarok_${a.id}_${userId}`)
            .setLabel("↩️ Sí, cancélala")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`misapuestas_activas_${userId}`).setLabel("◀ No, volver").setStyle(ButtonStyle.Secondary),
    );
    return { content: "", embeds: [embed], components: [fila] };
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

module.exports = { buildMisJugadas, buildConfirmarCancelar, filaTrasApostar, lineaQuiniela, camposStatsApuestas };
