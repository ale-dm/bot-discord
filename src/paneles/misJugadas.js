// Pestaña "📋 Mis jugadas" de /juegos: lo que tienes en juego y lo ya resuelto, con apuestas a partidos y
// quinielas juntas. Las estadísticas de apuestas van en la pestaña 📊 Stats (paneles/juegos). Los datos, en
// systems/apuestas.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const jugadas = require("../systems/apuestas/misJugadas");
const { filaPestanas } = require("./pestanasJuegos");

const EMOJI_JUEGO = { blackjack: "🃏", tragaperras: "🎰", slots: "🎰", ruleta: "🎡", adivinar: "🔮", ppt: "✂️" };
const fecha = (iso) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const eleccionTexto = (a) => (a.eleccion === "home" ? a.home_team : a.eleccion === "draw" ? "Empate" : a.away_team);
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

function vistaActivas(userId, embed) {
    const partidos = jugadas.partidosDe(userId, { pendientes: true });
    const quinielas = jugadas.quinielasDe(userId, { abiertas: true });
    const casino = jugadas.ultimasCasino(userId, 5);
    embed.setTitle("⏳ Lo que tienes en juego");
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
    return quinielas[0]?.deporte;
}

/** Campos de estadísticas de apuestas (partidos y quinielas) y el beneficio total; los usa la pestaña Stats. */
function camposStatsApuestas(userId) {
    const { partidos: p, quinielas: q } = jugadas.estadisticas(userId);
    const beneficio = p.ganado - p.apostado + (q.ganado - q.apostado);
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
    ];
    return { campos, beneficio };
}

/** Mis jugadas: vista "activas" (en juego) o "historial" (resueltas). */
function buildMisJugadas(userId, vista = "activas") {
    const embed = new EmbedBuilder().setColor(0x3498db).setTimestamp();
    const deporte = vista === "historial" ? vistaResueltas(userId, embed) : vistaActivas(userId, embed);
    return { embeds: [embed], components: filaVistas(userId, vista === "historial" ? "historial" : "activas", deporte) };
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

module.exports = { buildMisJugadas, filaTrasApostar, lineaQuiniela, camposStatsApuestas };
