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

/** La frase con la que quien retó pica al rival (#440), como línea propia; vacía si no puso ninguna. */
const frase = (reto) => (reto.provocacion ? `💬 ${persona(reto.creador)}: «${reto.provocacion}»\n\n` : "");

/** Con quién es el reto: su mención, o «cualquiera» si es abierto (#438) y nadie lo ha aceptado aún. */
const rivalTexto = (reto) => (reto.rival ? persona(reto.rival) : "**cualquiera**");

/** Lo que hay en juego ahora: lo de los dos (con lo doblado, #444) o, si el reto aún no se ha aceptado, el doble de la entrada. */
const boteDe = (reto) => (reto.participantes.length > 1 ? reto.participantes.reduce((s, p) => s + p.cantidad, 0) : reto.cantidad * 2);

const espera = (reto) =>
    reto.contraoferta
        ? `💬 ${persona(reto.rival)} propone **${fmtNumero(reto.contraoferta)}** 🪙 cada uno en vez de ${fmtNumero(reto.cantidad)}. ` +
          `${persona(reto.creador)}: acepta la contraoferta o cancela el reto · caduca ${ts(reto.expira_en)}`
        : `⏳ Esperando a ${rivalTexto(reto)}${reto.rival ? "" : " (entra el primero que acepte)"} · caduca ${ts(reto.expira_en)}`;

function botonesPendiente(reto) {
    const boton = (prefijo, label, estilo) =>
        new ButtonBuilder().setCustomId(`retos_${prefijo}_${reto.id}`).setLabel(label).setStyle(estilo);
    const cancelar = boton("cancelar", "🚫 Cancelar (quien retó)", ButtonStyle.Secondary);
    // Reto abierto (#438): lo acepta cualquiera, y no hay a quién rechazar ni bloquear.
    if (!reto.rival) return new ActionRowBuilder().addComponents(boton("aceptar", "✅ Aceptar", ButtonStyle.Success), cancelar);
    // Con contraoferta (#442): quien retó la acepta o cancela; el rival ya no puede aceptar el importe original.
    if (reto.contraoferta) {
        return new ActionRowBuilder().addComponents(
            boton("acepcontra", "✅ Aceptar contraoferta (quien retó)", ButtonStyle.Success),
            boton("rechazar", "❌ Rechazar", ButtonStyle.Danger),
            cancelar,
        );
    }
    return new ActionRowBuilder().addComponents(
        boton("aceptar", "✅ Aceptar", ButtonStyle.Success),
        boton("contra", "💬 Contraoferta", ButtonStyle.Primary),
        boton("rechazar", "❌ Rechazar", ButtonStyle.Danger),
        cancelar,
        boton("bloquear", "🚫 Bloquear", ButtonStyle.Secondary),
    );
}

/** El botón de rendirse de un duelo en juego (#446). */
const botonRendirse = (reto) =>
    new ButtonBuilder().setCustomId(`retos_rendirse_${reto.id}`).setLabel("🏳️ Rendirse").setStyle(ButtonStyle.Danger);

/** El marcador de un duelo al mejor de tres (#436): la partida, el marcador y lo que pasó en las anteriores. Vacío en un duelo a una partida. */
function lineasSerie(reto) {
    if (reto.serie !== 3) return "";
    if (!reto.datos?.marcador) return "🏁 **Al mejor de 3**: gana quien llegue antes a dos victorias.\n\n";
    const m = reto.datos.marcador;
    const terminado = ["resuelto", "devuelto"].includes(reto.estado);
    const previas = (reto.datos.historial || []).map(
        (h) => `${h.partida}. ${h.ganador ? `gana ${persona(h.ganador)}` : "empate, se repite"} · ${h.texto}`,
    );
    return (
        `🏁 **Al mejor de 3**${terminado ? "" : ` · partida ${reto.datos.partida}`} · ${persona(reto.creador)} **${m[reto.creador]}** – **${m[reto.rival]}** ${persona(reto.rival)}` +
        (previas.length ? `\n${previas.join("\n")}` : "") +
        "\n\n"
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
                frase(reto) +
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
    const serie = lineasSerie(reto);
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
            new ActionRowBuilder().addComponents([
                ...Object.entries(retos.PPT).map(([jugada, x]) =>
                    new ButtonBuilder()
                        .setCustomId(`retos_ppt_${jugada}_${reto.id}`)
                        .setLabel(`${x.emoji} ${jugada[0].toUpperCase()}${jugada.slice(1)}`)
                        .setStyle(ButtonStyle.Primary),
                ),
                botonRendirse(reto),
            ]),
        ];
    } else if (reto.estado === "en_juego" && reto.juego === "blackjack") {
        const quien = (id) => {
            const cartas = reto.datos.manos[id].length;
            return `${persona(id)} ${reto.datos.plantados[id] ? "✋ ha terminado" : "🃏 jugando"} (${cartas} cartas${reto.datos.doblados?.[id] ? ", doblada" : ""})`;
        };
        estado = `Cada uno juega su mano en privado con **🃏 Mi mano**:\n${quien(reto.creador)}\n${quien(reto.rival)}`;
        components = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`retos_bj_ver_${reto.id}`).setLabel("🃏 Mi mano").setStyle(ButtonStyle.Primary),
                botonRendirse(reto),
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
            `${persona(reto.creador)} reta a ${rivalTexto(reto)} por **${fmtNumero(reto.cantidad)}** 🪙 cada uno. El que gane se lleva **${fmtNumero(boteDe(reto))}** 🪙${reto.serie === 3 ? " (el bote de toda la serie)" : ""}.\n\n${frase(reto)}${serie}${estado}`,
        );
    return components;
}

function mensajePorra(reto, embed) {
    const bote = reto.participantes.reduce((s, p) => s + p.cantidad, 0);
    const abierta = reto.estado === "abierta";
    const estado = abierta
        ? `Elige una opción con los botones (una vez dentro no se cambia). ${reto.cierra_en ? `Las entradas se cierran solas ${ts(reto.cierra_en)}. ` : ""}Un admin dirá cuál gana. Si nadie la resuelve, se devuelve ${ts(reto.expira_en)}.`
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
