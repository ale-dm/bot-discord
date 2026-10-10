// Panel de casino de /perfil: resumen, estadísticas, historial, ranking y los selectores de apuesta
// de cada juego. Solo construye mensajes; las partidas las juega cada comando de casino.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../core/db");
const { filaPestanas } = require("./pestanasJuegos");
const { lineaDinero } = require("./economia");
const eventos = require("../systems/eventos");
const { EMOJI, NOMBRE, getSaldo, backBtn, filaMontos, filaSacar } = require("./casinoComun");
const ruleta = require("./casinoRuleta");

// ─── Datos ───────────────────────────────────────────────────────────────────
// Con `juego`, solo las partidas de ese juego (la tragaperras antiguas se guardaban como "slots").
function filtroJuego(juego) {
    if (!juego) return { sql: "", params: [] };
    return juego === "tragaperras"
        ? { sql: " AND juego IN ('tragaperras', 'slots')", params: [] }
        : { sql: " AND juego = ?", params: [juego] };
}

function getUserStats(userId, juego = null) {
    const f = filtroJuego(juego);
    return (
        db
            .prepare(
                `
        SELECT COUNT(*)                                              AS total,
               COALESCE(SUM(apuesta),   0)                           AS apostado,
               COALESCE(SUM(resultado), 0)                           AS ganancia,
               COALESCE(MAX(resultado), 0)                           AS mejor,
               COUNT(CASE WHEN resultado > 0 THEN 1 END)             AS wins,
               COUNT(CASE WHEN resultado < 0 THEN 1 END)             AS losses
        FROM casino WHERE userId = ?${f.sql}
    `,
            )
            .get(userId, ...f.params) || { total: 0, apostado: 0, ganancia: 0, mejor: 0, wins: 0, losses: 0 }
    );
}

function getFavoriteGame(userId) {
    const row = db
        .prepare("SELECT juego, COUNT(*) AS cnt FROM casino WHERE userId = ? GROUP BY juego ORDER BY cnt DESC LIMIT 1")
        .get(userId);
    if (!row) return null;
    const norm = row.juego === "slots" ? "tragaperras" : row.juego;
    return `${EMOJI[norm] || "🎲"} ${norm.charAt(0).toUpperCase() + norm.slice(1)} (${row.cnt})`;
}

function getLastGames(userId, n = 5) {
    return db.prepare("SELECT juego, resultado, apuesta FROM casino WHERE userId = ? ORDER BY fecha DESC LIMIT ?").all(userId, n);
}

// ─── Botones comunes ─────────────────────────────────────────────────────────
function backToPerfilBtn(userId) {
    return new ButtonBuilder().setCustomId(`perfil_ver_${userId}_${userId}`).setLabel("◄ Perfil").setStyle(ButtonStyle.Secondary);
}

// ─── Pantallas ───────────────────────────────────────────────────────────────
// Las estadísticas del resumen: el total, el juego favorito y el ROI (o el aviso de que aún no hay partidas).
function lineasEstadisticasHome(stats, fav) {
    if (stats.total === 0) return ["", "_Sin partidas todavía. ¡Elige un juego y empieza!_"];

    const winRate = ((stats.wins / stats.total) * 100).toFixed(1);
    const roi = stats.apostado > 0 ? ((stats.ganancia / stats.apostado) * 100).toFixed(1) : "0.0";
    const netSign = stats.ganancia >= 0 ? "+" : "";
    const roiSign = parseFloat(roi) >= 0 ? "+" : "";

    const lineas = [
        "",
        "**── Tus estadísticas ──**",
        `🎮 **${stats.total}** partidas  ·  ✅ **${stats.wins}** victorias  ·  📊 WR **${winRate}%**`,
        `💸 Ganancia neta: **${netSign}${stats.ganancia.toLocaleString("es")}**  ·  ROI: **${roiSign}${roi}%**`,
        `🏆 Mejor jugada: **+${stats.mejor.toLocaleString("es")}**`,
    ];
    if (fav) lineas.push(`🎲 Juego favorito: ${fav}`);
    return lineas;
}

// Las últimas cinco partidas, en una sola línea.
function lineasUltimasHome(last) {
    if (!last.length) return [];
    const lines = last.map((r) => {
        const e = EMOJI[r.juego] || "🎲";
        const icon = r.resultado > 0 ? "✅" : r.resultado < 0 ? "❌" : "🟡";
        const val = r.resultado >= 0 ? `+${r.resultado}` : `${r.resultado}`;
        return `${e} ${icon} **${val}**`;
    });
    return ["", "**── Últimas jugadas ──**", lines.join("  ·  ")];
}

// Los botones del resumen: los juegos, los accesos al ranking, el historial y las stats, y volver al perfil.
function filasHome(userId) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("casino_tragaperras").setLabel("🎰 Tragaperras").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("casino_blackjack").setLabel("🃏 Blackjack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("casino_ruleta").setLabel("🎡 Ruleta").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("casino_pick_adivinar").setLabel("🔮 Adivinar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("casino_pick_ppt").setLabel("✂️ PPT").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("casino_ranking").setLabel("🏆 Ranking").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("casino_historial").setLabel("📜 Historial").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("casino_stats").setLabel("📊 Mis Stats").setStyle(ButtonStyle.Secondary),
        backToPerfilBtn(userId),
    );
    return [row1, row2];
}

/** `guildId`: para avisar si hay un 🎉 fin de semana del casino en marcha (F-EC-02). */
function buildHome(userId, guildId = null) {
    const stats = getUserStats(userId);
    const fav = getFavoriteGame(userId);
    const last = getLastGames(userId, 5);

    const parts = [];
    const evento = eventos.lineaCasino(guildId);
    if (evento) parts.push(evento, "");
    parts.push(lineaDinero(userId), ...lineasEstadisticasHome(stats, fav), ...lineasUltimasHome(last));

    const embed = new EmbedBuilder()
        .setTitle("🎰 Casino — Tu resumen")
        .setDescription(parts.join("\n"))
        .setColor(0xf39c12)
        .setFooter({ text: "El Duende Casino" })
        .setTimestamp();

    return { embeds: [embed], components: [...filasHome(userId), filaPestanas(userId, "casino")] };
}

/** Estadísticas del casino; con `juego`, solo de ese juego (lo usa el botón 📊 al acabar una partida). */
function buildStats(userId, username, juego = null) {
    const stats = getUserStats(userId, juego);
    const f = filtroJuego(juego);
    const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : "0.0";
    const roi = stats.apostado > 0 ? ((stats.ganancia / stats.apostado) * 100).toFixed(1) : "0.0";

    const byGame = db
        .prepare(
            `
        SELECT juego, COUNT(*) AS p, SUM(resultado) AS g,
               COUNT(CASE WHEN resultado > 0 THEN 1 END) AS w
        FROM casino WHERE userId = ?${f.sql} GROUP BY juego ORDER BY p DESC
    `,
        )
        .all(userId, ...f.params);

    const gameLines = byGame.map((r) => {
        const norm = r.juego === "slots" ? "tragaperras" : r.juego;
        const wr = r.p > 0 ? ((r.w / r.p) * 100).toFixed(0) : "0";
        const sign = r.g >= 0 ? "+" : "";
        return `${EMOJI[norm] || "🎲"} **${norm}**  ${r.p}p  ${sign}${r.g}  WR ${wr}%`;
    });

    const embed = new EmbedBuilder()
        .setTitle(juego ? `📊 ${EMOJI[juego] || "🎲"} ${NOMBRE[juego] || juego} · ${username}` : `📊 Estadísticas de ${username}`)
        .addFields(
            {
                name: "Resumen global",
                value:
                    `🎮 Partidas: **${stats.total}**\n` +
                    `✅ Victorias: **${stats.wins}**  ❌ Derrotas: **${stats.losses}**\n` +
                    `📊 Win Rate: **${winRate}%**\n` +
                    `💸 Ganancia neta: **${stats.ganancia >= 0 ? "+" : ""}${stats.ganancia.toLocaleString("es")}**\n` +
                    `📈 ROI: **${roi}%**\n` +
                    `🏆 Mejor jugada: **+${stats.mejor.toLocaleString("es")}**`,
                inline: false,
            },
            {
                name: "Por juego",
                value: gameLines.length ? gameLines.join("\n") : "_Sin datos_",
                inline: false,
            },
        )
        .setColor(0x3498db)
        .setTimestamp();

    const fila = new ActionRowBuilder();
    if (juego)
        fila.addComponents(new ButtonBuilder().setCustomId(`casino_pick_${juego}`).setLabel("🎲 Jugar").setStyle(ButtonStyle.Primary));
    fila.addComponents(backBtn());
    return { embeds: [embed], components: [fila] };
}

function buildHistorial(userId) {
    const rows = db
        .prepare(
            `
        SELECT juego, fecha, apuesta, resultado FROM casino
        WHERE userId = ? ORDER BY fecha DESC LIMIT 15
    `,
        )
        .all(userId);

    const lines = rows.map((r) => {
        const norm = r.juego === "slots" ? "tragaperras" : r.juego;
        const e = EMOJI[norm] || "🎲";
        const icon = r.resultado > 0 ? "✅" : r.resultado < 0 ? "❌" : "🟡";
        const val = r.resultado >= 0 ? `+${r.resultado}` : `${r.resultado}`;
        const date = new Date(r.fecha).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `${e} ${icon} **${val}** · apuesta ${r.apuesta} · \`${date}\``;
    });

    const embed = new EmbedBuilder()
        .setTitle("📜 Historial reciente")
        .setDescription(lines.length ? lines.join("\n") : "_Sin partidas todavía._")
        .setColor(0x7f8c8d)
        .setTimestamp();

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn())] };
}

function buildRanking() {
    const ranking = db
        .prepare(
            `
        SELECT u.nombre, COUNT(c.id) AS partidas, SUM(c.resultado) AS gananciaTotal,
               COUNT(CASE WHEN c.resultado > 0 THEN 1 END) AS victorias
        FROM casino c
        JOIN usuarios u ON c.userId = u.id
        GROUP BY c.userId, u.nombre HAVING partidas >= 5
        ORDER BY gananciaTotal DESC LIMIT 10
    `,
        )
        .all();

    const medals = ["🥇", "🥈", "🥉"];
    const lines = ranking.length
        ? ranking.map((p, i) => {
              const wr = p.partidas > 0 ? ((p.victorias / p.partidas) * 100).toFixed(1) : "0.0";
              const sign = p.gananciaTotal >= 0 ? "+" : "";
              return `${medals[i] || `**${i + 1}.**`} **${p.nombre}** — ${sign}${p.gananciaTotal.toLocaleString("es")} · WR ${wr}%`;
          })
        : ["_No hay suficientes datos todavía (mín. 5 partidas)._"];

    const embed = new EmbedBuilder()
        .setTitle("🏆 Ranking del Casino")
        .setDescription("*Top 10 por ganancia neta — mín. 5 partidas*\n\n" + lines.join("\n"))
        .setColor(0xffd700)
        .setTimestamp();

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(backBtn())] };
}

// ─── Selectores de apuesta ───────────────────────────────────────────────────
/** Importe para tragaperras, blackjack... (casino_play_{juego}_{importe}). */
function buildPickApuesta(userId, juego) {
    const emoji = EMOJI[juego] || "🎲";
    const saldo = getSaldo(userId);
    const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${NOMBRE[juego] || juego} — Elige tu apuesta`)
        .setDescription(`${lineaDinero(userId)}\n\nPulsa la cantidad que quieres apostar:`)
        .setColor(0xf39c12);
    return {
        embeds: [embed],
        components: [filaMontos(saldo, (m) => `casino_play_${juego}_${m}`), filaSacar(userId, `casino_pick_${juego}`, backBtn())],
    };
}

/** Piedra, papel o tijera: elegir jugada con el importe ya elegido (casino_play_ppt_{importe}_{jugada}). */
function buildPickJugadaPpt(userId, apuesta) {
    const jugadas = [
        { value: "piedra", label: "🪨 Piedra" },
        { value: "papel", label: "📄 Papel" },
        { value: "tijera", label: "✂️ Tijera" },
    ];
    const embed = new EmbedBuilder()
        .setTitle("✂️ Piedra, papel o tijera")
        .setDescription(`Apuesta: **${apuesta.toLocaleString("es")}** 🪙\n${lineaDinero(userId)}\n\n¿Qué sacas?`)
        .setColor(0xf39c12);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                jugadas.map((j) =>
                    new ButtonBuilder()
                        .setCustomId(`casino_play_ppt_${apuesta}_${j.value}`)
                        .setLabel(j.label)
                        .setStyle(ButtonStyle.Primary),
                ),
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("casino_pick_ppt").setLabel("◄ Cambiar apuesta").setStyle(ButtonStyle.Secondary),
                backBtn(),
            ),
        ],
    };
}

/**
 * Fila común al acabar una partida: 🔄 Repetir (misma apuesta) · 🎲 Otra apuesta · 📊 Stats del juego · ◀ Casino.
 * `repetir` es el customId de "Repetir" cuando no basta con casino_play_{juego}_{apuesta} (la ruleta añade el
 * tipo, y en ppt se vuelve a elegir jugada). Los botones los atiende /perfil (casino_*).
 */
function filaFinJuego(juego, apuesta, { repetir, desactivada = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(repetir || `casino_play_${juego}_${apuesta}`)
            .setLabel(`🔄 Repetir (${apuesta.toLocaleString("es")})`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(desactivada),
        new ButtonBuilder()
            .setCustomId(juego === "ruleta" ? "casino_ruleta" : `casino_pick_${juego}`)
            .setLabel("🎲 Otra apuesta")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(desactivada),
        new ButtonBuilder()
            .setCustomId(`casino_stats_${juego}`)
            .setLabel("📊 Stats")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(desactivada),
        new ButtonBuilder().setCustomId("casino_home").setLabel("◀ Casino").setStyle(ButtonStyle.Secondary).setDisabled(desactivada),
    );
}

module.exports = {
    getUserStats,
    filaFinJuego,
    buildPickJugadaPpt,

    buildHome,
    buildStats,
    buildHistorial,
    buildRanking,
    buildPickApuesta,
    buildPickRuleta: ruleta.buildPickRuleta,
    buildPickDocenas: ruleta.buildPickDocenas,
    buildPickRangoNumero: ruleta.buildPickRangoNumero,
    buildPickNumeroRuleta: ruleta.buildPickNumeroRuleta,
    buildPickMontoRuleta: ruleta.buildPickMontoRuleta,
};
