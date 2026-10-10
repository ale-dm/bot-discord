// Mensaje público de cada reto (partido, duelo o porra) según su tipo y su estado: quién apuesta qué, la espera, la
// partida en curso y el resultado final. Solo construye mensajes.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const retos = require("../systems/retos");
const { fmtNumero } = require("../core/formato");
const { ts, corto, persona, menciones, COLOR, manoTexto } = require("./retosComun");

/** "gana el Betis", "empate"... lo que dice quien lanza un reto a un partido. */
function ladoTexto(p, eleccion) {
    if (eleccion === "home") return `gana ${p.home_team}`;
    if (eleccion === "draw") return "empate";
    return `gana ${p.away_team}`;
}

/** Lo contrario, con lo que va el rival. */
function contrarioTexto(p, eleccion) {
    if (eleccion === "home") return `empate o gana ${p.away_team}`;
    if (eleccion === "draw") return "que gane uno de los dos";
    return `empate o gana ${p.home_team}`;
}

// ─── Mensaje público de cada reto ────────────────────────────────────────────

const ganadores = (reto) => reto.participantes.filter((p) => p.premio > 0).map((p) => p.userId);
const premioDe = (reto, userId) => reto.participantes.find((p) => p.userId === userId)?.premio || 0;

function lineaFinal(reto) {
    if (reto.estado === "devuelto") return `↩️ **Devuelto**: ${reto.resultado}. Cada uno recupera lo suyo.`;
    if (reto.estado !== "resuelto") return null;
    const g = ganadores(reto);
    if (reto.tipo === "porra") {
        const bote = reto.participantes.reduce((s, p) => s + p.cantidad, 0);
        return `🏆 ${reto.resultado}: ${menciones(g)} ${g.length === 1 ? "se lleva" : "se reparten"} **${fmtNumero(bote)}** 🪙.`;
    }
    return `${reto.resultado}\n🏆 Gana ${persona(g[0])} y se lleva **${fmtNumero(premioDe(reto, g[0]))}** 🪙.`;
}

const espera = (reto) => `⏳ Esperando a ${persona(reto.rival)} · caduca ${ts(reto.expira_en)}`;

function botonesPendiente(reto) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`retos_aceptar_${reto.id}`).setLabel("✅ Aceptar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`retos_rechazar_${reto.id}`).setLabel("❌ Rechazar").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`retos_cancelar_${reto.id}`).setLabel("🚫 Cancelar (quien retó)").setStyle(ButtonStyle.Secondary),
    );
}

function mensajePartido(reto, embed) {
    const p = retos.partidoDe(reto.match_id);
    const partido = p ? `${p.home_team} vs ${p.away_team}` : "el partido";
    embed
        .setTitle("⚔️ Reto a un partido")
        .setDescription(
            (p
                ? `${persona(reto.creador)} apuesta **${fmtNumero(reto.cantidad)}** 🪙 a que **${ladoTexto(p, reto.eleccion)}** en **${partido}** (${ts(Date.parse(p.start_time), "f")}).\n` +
                  `${persona(reto.rival)} va con lo contrario: **${contrarioTexto(p, reto.eleccion)}**.\n`
                : `${persona(reto.creador)} contra ${persona(reto.rival)}, **${fmtNumero(reto.cantidad)}** 🪙 cada uno.\n`) +
                `El que acierte se lleva **${fmtNumero(reto.cantidad * 2)}** 🪙.\n\n` +
                (reto.estado === "pendiente"
                    ? espera(reto)
                    : reto.estado === "en_juego"
                      ? "✅ Aceptado. Se resuelve solo cuando acabe el partido."
                      : lineaFinal(reto)),
        );
    return reto.estado === "pendiente" ? [botonesPendiente(reto)] : [];
}

function mensajeDuelo(reto, embed) {
    const j = retos.JUEGOS[reto.juego];
    let estado;
    let components = [];
    if (reto.estado === "pendiente") {
        estado = espera(reto);
        components = [botonesPendiente(reto)];
    } else if (reto.estado === "en_juego" && reto.juego === "ppt") {
        const d = reto.datos || { ronda: 1, jugadas: {}, empates: [] };
        const quien = (id) => `${persona(id)} ${d.jugadas[id] ? "✅ ya ha elegido" : "⏳ pensando"}`;
        estado =
            `**Ronda ${d.ronda}**${d.empates.length ? ` (empates: ${d.empates.map((x) => retos.PPT[x].emoji).join(" ")})` : ""}. Elegid en secreto:\n` +
            `${quien(reto.creador)}\n${quien(reto.rival)}`;
        components = [
            new ActionRowBuilder().addComponents(
                Object.entries(retos.PPT).map(([jugada, x]) =>
                    new ButtonBuilder()
                        .setCustomId(`retos_ppt_${jugada}_${reto.id}`)
                        .setLabel(`${x.emoji} ${jugada[0].toUpperCase()}${jugada.slice(1)}`)
                        .setStyle(ButtonStyle.Primary),
                ),
            ),
        ];
    } else if (reto.estado === "en_juego" && reto.juego === "blackjack") {
        const quien = (id) => {
            const cartas = reto.datos.manos[id].length;
            return `${persona(id)} ${reto.datos.plantados[id] ? "✋ ha terminado" : "🃏 jugando"} (${cartas} cartas)`;
        };
        estado = `Cada uno juega su mano en privado con **🃏 Mi mano**:\n${quien(reto.creador)}\n${quien(reto.rival)}`;
        components = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`retos_bj_ver_${reto.id}`).setLabel("🃏 Mi mano").setStyle(ButtonStyle.Primary),
            ),
        ];
    } else {
        estado = lineaFinal(reto) || "";
        if (reto.juego === "blackjack" && reto.datos?.manos) {
            estado = `${persona(reto.creador)}: ${manoTexto(reto, reto.creador)}\n${persona(reto.rival)}: ${manoTexto(reto, reto.rival)}\n\n${estado}`;
        }
    }
    embed
        .setTitle(`⚔️ Duelo de ${j.emoji} ${j.nombre}`)
        .setDescription(
            `${persona(reto.creador)} reta a ${persona(reto.rival)} por **${fmtNumero(reto.cantidad)}** 🪙 cada uno. El que gane se lleva **${fmtNumero(reto.cantidad * 2)}** 🪙.\n\n${estado}`,
        );
    return components;
}

function mensajePorra(reto, embed) {
    const bote = reto.participantes.reduce((s, p) => s + p.cantidad, 0);
    const abierta = reto.estado === "abierta";
    const estado = abierta
        ? `Elige una opción con los botones (una vez dentro no se cambia). Un admin dirá cuál gana. Si nadie la resuelve, se devuelve ${ts(reto.expira_en)}.`
        : reto.estado === "cerrada"
          ? "🔒 Apuestas cerradas: falta que un admin diga cuál gana."
          : lineaFinal(reto);
    const ganadora = reto.estado === "resuelto" ? (reto.participantes.find((p) => p.premio > 0)?.opcion ?? null) : null;
    embed
        .setTitle(corto(`🗳️ ${reto.pregunta}`, 256))
        .setDescription(
            `Porra de ${persona(reto.creador)} · entrada **${fmtNumero(reto.cantidad)}** 🪙 · bote **${fmtNumero(bote)}** 🪙 · ${reto.participantes.length} dentro\n\n${estado}`,
        )
        .addFields(
            reto.opciones.map((opcion, n) => {
                const dentro = reto.participantes.filter((p) => p.opcion === String(n)).map((p) => p.userId);
                return {
                    name: corto(`${n + 1}. ${opcion}${ganadora === String(n) ? " ✅" : ""}`, 256),
                    value: dentro.length ? `${dentro.length} · ${menciones(dentro)}` : "Nadie",
                    inline: true,
                };
            }),
        );
    if (!["abierta", "cerrada"].includes(reto.estado)) return [];
    const gestion = new ActionRowBuilder().addComponents(
        ...(abierta
            ? [
                  new ButtonBuilder()
                      .setCustomId(`retos_porra_cerrar_${reto.id}`)
                      .setLabel("🔒 Cerrar apuestas")
                      .setStyle(ButtonStyle.Secondary),
              ]
            : []),
        new ButtonBuilder().setCustomId(`retos_porra_resolver_${reto.id}`).setLabel("⚖️ Resolver (admin)").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`retos_porra_anular_${reto.id}`).setLabel("🚫 Anular").setStyle(ButtonStyle.Danger),
    );
    if (!abierta) return [gestion];
    return [
        new ActionRowBuilder().addComponents(
            reto.opciones.map((opcion, n) =>
                new ButtonBuilder().setCustomId(`retos_porra_op_${n}_${reto.id}`).setLabel(corto(opcion, 80)).setStyle(ButtonStyle.Primary),
            ),
        ),
        gestion,
    ];
}

/** El mensaje público de un reto ({ embeds, components }), según su tipo y estado. */
function mensajeReto(reto) {
    const embed = new EmbedBuilder()
        .setColor(COLOR[reto.estado] || 0x95a5a6)
        .setFooter({ text: `Reto #${reto.id} · tus retos, en /juegos → ⚔️ Retos` });
    const components =
        reto.tipo === "partido"
            ? mensajePartido(reto, embed)
            : reto.tipo === "duelo"
              ? mensajeDuelo(reto, embed)
              : mensajePorra(reto, embed);
    return { embeds: [embed], components };
}

module.exports = { ladoTexto, contrarioTexto, mensajeReto };
