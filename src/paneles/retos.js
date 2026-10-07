// Pestaña "⚔️ Retos" de /juegos y los mensajes públicos de cada reto: lo que tienes pendiente y en juego, los pasos
// para lanzar uno (partido, duelo o porra) y cómo se ve cada reto según su estado. Solo construye mensajes; los
// botones están en juegos/retos/retos.js y las reglas en systems/retos.js.
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
const retos = require("../systems/retos");
const dinero = require("../systems/dinero");
const { DEPORTES } = require("../services/oddsApi");
const { filaPestanas } = require("./pestanasJuegos");

const fmt = (n) => Number(n || 0).toLocaleString("es");
const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const corto = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);
// Discord corta los campos en 1.024 caracteres.
const campo = (texto) => (texto.length > 1024 ? `${texto.slice(0, 1020)}…` : texto);
/** Quién es alguien en un reto: su mención o, si es el Duende (F-DU-03), "🧙 el Duende" (no es un usuario de Discord). */
const persona = (id) => (id === retos.DUENDE ? "🧙 **el Duende**" : `<@${id}>`);
const menciones = (ids, max = 15) =>
    ids
        .slice(0, max)
        .map((id) => `<@${id}>`)
        .join(", ") + (ids.length > max ? ` y ${ids.length - max} más` : "");

const COLOR = { pendiente: 0xf39c12, en_juego: 0x3498db, abierta: 0x9b59b6, cerrada: 0x8e44ad, resuelto: 0x27ae60, devuelto: 0x95a5a6 };
const VOLVER = () => new ButtonBuilder().setCustomId("juegos_retos").setLabel("◀ Retos").setStyle(ButtonStyle.Secondary);

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

/** Enlace al mensaje del reto (o su número, si no se sabe dónde está). */
function enlace(reto) {
    return reto.guildId && reto.channelId && reto.messageId
        ? `[#${reto.id}](https://discord.com/channels/${reto.guildId}/${reto.channelId}/${reto.messageId})`
        : `#${reto.id}`;
}

/** Una línea con lo esencial de un reto, para las listas de la pestaña. */
function resumenCorto(reto) {
    if (reto.tipo === "partido") {
        const p = retos.partidoDe(reto.match_id);
        const partido = p ? `${p.home_team} vs ${p.away_team}` : "partido";
        return `⚽ ${partido} · ${persona(reto.creador)} vs ${persona(reto.rival)} · ${fmt(reto.cantidad)} 🪙`;
    }
    if (reto.tipo === "duelo") {
        const j = retos.JUEGOS[reto.juego];
        return `${j.emoji} ${j.nombre} · ${persona(reto.creador)} vs ${persona(reto.rival)} · ${fmt(reto.cantidad)} 🪙`;
    }
    return `🗳️ ${corto(reto.pregunta, 50)} · ${fmt(reto.cantidad)} 🪙 · ${reto.participantes.length} dentro`;
}

/** Cómo le fue a `userId` en un reto cerrado. */
function resultadoPara(reto, userId) {
    const p = reto.participantes.find((x) => x.userId === String(userId));
    if (!p) return "";
    if (reto.estado === "devuelto") return "↩️ devuelto";
    if (p.premio > p.cantidad) return `🏆 +${fmt(p.premio - p.cantidad)}`;
    if (p.premio === p.cantidad) return "🤝 ±0";
    return `❌ −${fmt(p.cantidad)}`;
}

// ─── Pestaña ⚔️ Retos ────────────────────────────────────────────────────────

function buildRetos(userId, aviso = null) {
    const { recibidos, enviados, enJuego, cerrados } = retos.deUsuario(userId);
    const lista = (rs, vacio, extra = () => "") => campo(rs.map((r) => `${enlace(r)} ${resumenCorto(r)}${extra(r)}`).join("\n") || vacio);
    const c = dinero.cuenta(userId);
    const embed = new EmbedBuilder()
        .setTitle("⚔️ Retos")
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                "Apuesta contra otras personas. El dinero se guarda hasta que se resuelve y el ganador se lo lleva todo.\n" +
                "• ⚽ **Partido**: «te apuesto 500 a que gana el Betis»; el otro va con lo contrario.\n" +
                "• 🎲 **Duelo**: piedra, papel o tijera, dados o blackjack contra alguien.\n" +
                "• 🗳️ **Porra**: una pregunta con opciones; entra quien quiera y un admin decide qué pasó.\n\n" +
                `💵 Efectivo: **${fmt(c.efectivo)}** 🪙 · 🏦 Banco: **${fmt(c.banco)}** 🪙`,
        )
        .addFields(
            { name: `📨 Te han retado (${recibidos.length})`, value: lista(recibidos, "Nadie, de momento.") },
            { name: `⏳ Esperando respuesta (${enviados.length})`, value: lista(enviados, "Ningún reto sin contestar.") },
            { name: `⚔️ En juego (${enJuego.length})`, value: lista(enJuego, "Nada en juego.") },
            { name: "📜 Últimos", value: lista(cerrados, "Ninguno todavía.", (r) => ` · ${resultadoPara(r, userId)}`) },
        )
        .setFooter({ text: "Los botones de cada reto están en su mensaje (pulsa su número)" })
        .setColor(0xe67e22);
    const acciones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("retos_nuevo_partido").setLabel("⚽ Retar a un partido").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("retos_nuevo_duelo").setLabel("🎲 Duelo").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("retos_nuevo_porra").setLabel("🗳️ Porra").setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [acciones, filaPestanas(userId, "retos")] };
}

// ─── Pasos para lanzar un reto ───────────────────────────────────────────────

function buildElegirPartido(partidos) {
    const embed = new EmbedBuilder()
        .setTitle("⚽ Retar a un partido")
        .setDescription(
            partidos.length
                ? "Elige el partido. Después dices qué crees que pasará y a quién retas: el otro va con lo contrario, y el que acierte se lleva lo de los dos."
                : "No hay partidos próximos ahora mismo.",
        )
        .setColor(0x3498db);
    const components = [];
    if (partidos.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("retos_partido_select")
                    .setPlaceholder("Elige un partido")
                    .addOptions(
                        partidos.map((p) => ({
                            label: corto(`${p.home_team} vs ${p.away_team}`, 100),
                            description: `${DEPORTES[p.deporte]?.name || p.deporte} · ${new Date(p.start_time).toLocaleString("es-ES", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                            })}`,
                            value: p.match_id,
                        })),
                    ),
            ),
        );
    }
    components.push(new ActionRowBuilder().addComponents(VOLVER()));
    return { embeds: [embed], components };
}

function buildElegirLado(p) {
    const embed = new EmbedBuilder()
        .setTitle(`⚽ ${p.home_team} vs ${p.away_team}`)
        .setDescription(`${ts(Date.parse(p.start_time), "f")} (${ts(Date.parse(p.start_time))})\n\n¿Qué crees que pasará?`)
        .setColor(0x3498db);
    const lado = (eleccion, label, style) =>
        new ButtonBuilder().setCustomId(`retos_lado_${eleccion}_${p.match_id}`).setLabel(corto(label, 80)).setStyle(style);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                lado("home", `🏠 Gana ${p.home_team}`, ButtonStyle.Success),
                lado("draw", "🤝 Empate", ButtonStyle.Primary),
                lado("away", `🚩 Gana ${p.away_team}`, ButtonStyle.Danger),
            ),
            new ActionRowBuilder().addComponents(VOLVER()),
        ],
    };
}

function buildElegirJuego() {
    const embed = new EmbedBuilder()
        .setTitle("🎲 Duelo")
        .setDescription(
            "Elige el juego. Los dos ponéis lo mismo y el que gane se lo lleva todo.\n\n" +
                "🪨 **Piedra, papel o tijera**: cada uno elige en secreto. Si empatáis, otra ronda.\n" +
                "🎲 **Dados**: dos dados cada uno al aceptar; gana la suma más alta.\n" +
                "🃏 **Blackjack**: cada uno juega su mano sin ver la del otro; gana quien más se acerque a 21 sin pasarse.",
        )
        .setColor(0x3498db);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                Object.entries(retos.JUEGOS).map(([id, j]) =>
                    new ButtonBuilder().setCustomId(`retos_juego_${id}`).setLabel(`${j.emoji} ${j.nombre}`).setStyle(ButtonStyle.Primary),
                ),
            ),
            new ActionRowBuilder().addComponents(VOLVER()),
        ],
    };
}

/** Elegir a quién se reta. `clave`: p_{eleccion}_{matchId} (partido) o d_{juego} (duelo). */
function buildElegirRival(clave, texto) {
    const embed = new EmbedBuilder().setTitle("⚔️ ¿A quién retas?").setDescription(texto).setColor(0x3498db);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`retos_rival_${clave}`)
                    .setPlaceholder("Elige a quién retas")
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
            new ActionRowBuilder().addComponents(VOLVER()),
        ],
    };
}

function modalCantidad(customId, titulo, efectivo) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(corto(titulo, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("cantidad")
                    .setLabel(`Cuánto pone cada uno (${retos.MIN}-${fmt(retos.MAX)})`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`Tienes ${fmt(efectivo)} en efectivo`)
                    .setMaxLength(7)
                    .setRequired(true),
            ),
        );
}

function modalPorra() {
    const input = (id, label, style, extra = (b) => b) =>
        new ActionRowBuilder().addComponents(extra(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)));
    return new ModalBuilder()
        .setCustomId("retos_modal_porra")
        .setTitle("🗳️ Nueva porra")
        .addComponents(
            input("pregunta", "Pregunta", TextInputStyle.Short, (b) =>
                b.setPlaceholder("¿Llegará Jorge tarde?").setMaxLength(200).setRequired(true),
            ),
            input("opciones", `Opciones (una por línea, de 2 a ${retos.PORRA_MAX_OPCIONES})`, TextInputStyle.Paragraph, (b) =>
                b.setPlaceholder("Sí\nNo").setMaxLength(300).setRequired(false),
            ),
            input("cantidad", `Entrada para cada uno (${retos.MIN}-${fmt(retos.MAX)})`, TextInputStyle.Short, (b) =>
                b.setPlaceholder("100").setMaxLength(7).setRequired(true),
            ),
        );
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
        return `🏆 ${reto.resultado}: ${menciones(g)} ${g.length === 1 ? "se lleva" : "se reparten"} **${fmt(bote)}** 🪙.`;
    }
    return `${reto.resultado}\n🏆 Gana ${persona(g[0])} y se lleva **${fmt(premioDe(reto, g[0]))}** 🪙.`;
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
                ? `${persona(reto.creador)} apuesta **${fmt(reto.cantidad)}** 🪙 a que **${ladoTexto(p, reto.eleccion)}** en **${partido}** (${ts(Date.parse(p.start_time), "f")}).\n` +
                  `${persona(reto.rival)} va con lo contrario: **${contrarioTexto(p, reto.eleccion)}**.\n`
                : `${persona(reto.creador)} contra ${persona(reto.rival)}, **${fmt(reto.cantidad)}** 🪙 cada uno.\n`) +
                `El que acierte se lleva **${fmt(reto.cantidad * 2)}** 🪙.\n\n` +
                (reto.estado === "pendiente"
                    ? espera(reto)
                    : reto.estado === "en_juego"
                      ? "✅ Aceptado. Se resuelve solo cuando acabe el partido."
                      : lineaFinal(reto)),
        );
    return reto.estado === "pendiente" ? [botonesPendiente(reto)] : [];
}

function manoTexto(reto, userId) {
    const mano = reto.datos?.manos?.[userId] || [];
    return `${mano.map((c) => c.display).join(" ")} (**${retos.valorMano(reto, userId)}**)`;
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
            `${persona(reto.creador)} reta a ${persona(reto.rival)} por **${fmt(reto.cantidad)}** 🪙 cada uno. El que gane se lleva **${fmt(reto.cantidad * 2)}** 🪙.\n\n${estado}`,
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
            `Porra de ${persona(reto.creador)} · entrada **${fmt(reto.cantidad)}** 🪙 · bote **${fmt(bote)}** 🪙 · ${reto.participantes.length} dentro\n\n${estado}`,
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

/** Tu mano de un duelo de blackjack (mensaje privado), con Pedir y Plantarse mientras juegas. */
function vistaManoBlackjack(reto, userId) {
    const yo = String(userId);
    const valor = retos.valorMano(reto, yo);
    const terminado = reto.estado !== "en_juego";
    const plantado = terminado || reto.datos.plantados[yo];
    const embed = new EmbedBuilder()
        .setTitle("🃏 Tu mano")
        .setDescription(
            `${manoTexto(reto, yo)}${valor > 21 ? "\n💥 Te has pasado." : ""}\n\n` +
                (terminado
                    ? "El duelo ha terminado: el resultado está en el mensaje del reto."
                    : plantado
                      ? "✋ Has terminado. Falta el otro."
                      : "¿Otra carta o te plantas? El otro no ve tu mano hasta el final."),
        )
        .setColor(terminado ? COLOR[reto.estado] : 0x3498db);
    const components = plantado
        ? []
        : [
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId(`retos_bj_pedir_${reto.id}`).setLabel("🃏 Pedir").setStyle(ButtonStyle.Primary),
                  new ButtonBuilder().setCustomId(`retos_bj_plantar_${reto.id}`).setLabel("✋ Plantarse").setStyle(ButtonStyle.Secondary),
              ),
          ];
    return { embeds: [embed], components };
}

/** Menú (privado, para admins) para decir qué opción de una porra ha ganado. */
function elegirGanadoraPorra(reto) {
    return {
        content: `⚖️ **${reto.pregunta}**\n¿Qué opción ha ganado? El bote se reparte entre los que la eligieron (si nadie la eligió, se devuelve).`,
        components: [
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`retos_porra_ganadora_${reto.id}`)
                    .setPlaceholder("Opción ganadora")
                    .addOptions(
                        reto.opciones.map((opcion, n) => ({
                            label: corto(opcion, 100),
                            description: `${reto.participantes.filter((p) => p.opcion === String(n)).length} la eligieron`,
                            value: String(n),
                        })),
                    ),
            ),
        ],
    };
}

module.exports = {
    buildRetos,
    buildElegirPartido,
    buildElegirLado,
    buildElegirJuego,
    buildElegirRival,
    modalCantidad,
    modalPorra,
    mensajeReto,
    vistaManoBlackjack,
    elegirGanadoraPorra,
    ladoTexto,
    contrarioTexto,
    persona,
};
