// 🔨 Pantallas de /subastas (#519): las subastas abiertas, en las que pujas y las tuyas; la ficha de una subasta con pujar y
// cancelar; elegir el objeto que se subasta, y los formularios de pujar y de crear. Solo payloads; las reglas están en
// systems/subastas.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const subastas = require("../systems/subastas");
const { fmtNumero } = require("../core/formato");
const { paginaDeLista, filaPaginas } = require("./menuPaginado");

const COLOR = 0xc0392b;
const POR_PAGINA = 5;
const VISTAS = { activas: "🔨 Abiertas", pujas: "🙋 Mis pujas", mias: "📦 Mis subastas" };
const ESTADO = { abierta: "🟢 abierta", cerrada: "✅ vendida", desierta: "⚪ sin pujas", cancelada: "✖️ cancelada" };

const ts = (ms, estilo = "R") => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const recorte = (t, n) => (String(t || "").length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ""));
const boton = (id, etiqueta, estilo = ButtonStyle.Secondary, desactivado = false) =>
    new ButtonBuilder().setCustomId(id).setLabel(etiqueta).setStyle(estilo).setDisabled(desactivado);

function itemsDe(userId, vista) {
    if (vista === "pujas") return subastas.conPujasDe(userId);
    if (vista === "mias") return subastas.deVendedor(userId);
    return subastas.abiertas();
}

function linea(s, vista) {
    const mayor = subastas.pujaMayor(s.id);
    const precio = mayor ? `puja **${fmtNumero(mayor.cantidad)}** 🪙` : `salida **${fmtNumero(s.precio_inicial)}** 🪙`;
    if (vista === "mias" && s.estado !== "abierta") {
        const final = s.precio_final ? ` por **${fmtNumero(s.precio_final)}** 🪙` : "";
        return `**#${s.id}** ${s.nombre} · ${ESTADO[s.estado]}${final}`;
    }
    const extra = vista === "pujas" ? (s.ganando ? " · 🏆 vas ganando" : " · ⚠️ te han superado") : "";
    return `**#${s.id}** ${s.nombre} · ${precio} · cierra ${ts(s.cierra)}${extra}`;
}

/** La lista de una vista, cinco por página, con un botón para abrir cada subasta. */
function pantallaSubastas(userId, vista = "activas", pagina = 0, aviso = "") {
    const v = VISTAS[vista] ? vista : "activas";
    const items = itemsDe(userId, v);
    const total = Math.max(1, Math.ceil(items.length / POR_PAGINA));
    const p = Math.max(0, Math.min(total - 1, Number(pagina) || 0));
    const trozo = items.slice(p * POR_PAGINA, (p + 1) * POR_PAGINA);
    const vacia = {
        activas: "No hay subastas abiertas. ¡Subasta algo con ➕ Subastar!",
        pujas: "No has pujado en ninguna subasta abierta.",
        mias: "No has subastado nada todavía.",
    };
    const embed = new EmbedBuilder()
        .setTitle(`🔨 Subastas · ${VISTAS[v]}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (trozo.length ? trozo.map((s) => linea(s, v)).join("\n") : vacia[v]) +
                (total > 1 ? `\n\nPágina ${p + 1} de ${total}` : ""),
        )
        .setFooter({
            text: `Se puja con efectivo; si te superan, te lo devuelven al momento. Comisión del ${subastas.COMISION_PCT} % al vendedor.`,
        });
    const estilo = (x) => (x === v ? ButtonStyle.Primary : ButtonStyle.Secondary);
    const filas = [
        new ActionRowBuilder().addComponents(
            boton("subastas_vista_activas", "🔨 Abiertas", estilo("activas")),
            boton("subastas_vista_pujas", "🙋 Mis pujas", estilo("pujas")),
            boton("subastas_vista_mias", "📦 Mis subastas", estilo("mias")),
            boton("subastas_nueva", "➕ Subastar", ButtonStyle.Success),
        ),
    ];
    if (trozo.length)
        filas.push(
            new ActionRowBuilder().addComponents(trozo.map((s) => boton(`subastas_ver_${s.id}`, `#${s.id} ${recorte(s.nombre, 20)}`))),
        );
    if (total > 1) {
        filas.push(
            new ActionRowBuilder().addComponents(
                boton(`subastas_pag_${v}_${p - 1}`, "◀", ButtonStyle.Secondary, p === 0),
                boton(`subastas_pag_${v}_${p + 1}`, "▶", ButtonStyle.Secondary, p >= total - 1),
            ),
        );
    }
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

/** La ficha de una subasta. */
function pantallaSubasta(userId, subastaId, aviso = "") {
    const s = subastas.obtener(subastaId);
    if (!s) return pantallaSubastas(userId, "activas", 0, "❌ Esa subasta no existe.");
    const mayor = subastas.pujaMayor(s.id);
    const abierta = s.estado === "abierta" && s.cierra > Date.now();
    const esMia = s.vendedor === String(userId);
    const embed = new EmbedBuilder()
        .setTitle(`🔨 #${s.id} · ${s.nombre}`)
        .setColor(COLOR)
        .setDescription(
            (aviso ? `${aviso}\n\n` : "") +
                (s.descripcion ? `*${s.descripcion}*\n\n` : "") +
                `Vende <@${s.vendedor}> · ${ESTADO[s.estado]}\n` +
                `Salida **${fmtNumero(s.precio_inicial)}** 🪙 · incremento mínimo **${fmtNumero(s.incremento)}** 🪙\n` +
                (mayor ? `💰 Puja más alta: **${fmtNumero(mayor.cantidad)}** 🪙 de <@${mayor.userId}>\n` : "💰 Sin pujas todavía\n") +
                (abierta
                    ? `⏰ Cierra ${ts(s.cierra, "f")} (${ts(s.cierra)}) · puja mínima **${fmtNumero(subastas.minimaPuja(s))}** 🪙\n` +
                      "-# Una puja en los 2 últimos minutos alarga el cierre 2 minutos (como mucho 30)."
                    : s.ganador
                      ? `🏆 Ganó <@${s.ganador}> por **${fmtNumero(s.precio_final)}** 🪙`
                      : ""),
        );
    if (s.imagen && /^https?:\/\//.test(s.imagen)) embed.setThumbnail(s.imagen);
    const botones = [];
    if (abierta && !esMia) botones.push(boton(`subastas_pujar_${s.id}`, "💰 Pujar", ButtonStyle.Success));
    if (abierta && esMia && !mayor) botones.push(boton(`subastas_cancelar_${s.id}`, "✖️ Cancelar", ButtonStyle.Danger));
    botones.push(
        boton(`subastas_ver_${s.id}`, "🔄 Actualizar"),
        boton(esMia ? "subastas_vista_mias" : "subastas_vista_activas", "⬅️ Volver"),
    );
    return { content: "", embeds: [embed], components: [new ActionRowBuilder().addComponents(botones)], allowedMentions: { parse: [] } };
}

/** Elegir qué objeto del inventario subastar. */
function pantallaElegirObjeto(objetos, pagina = 0) {
    const embed = new EmbedBuilder()
        .setTitle("➕ Subastar un objeto")
        .setColor(COLOR)
        .setDescription(
            objetos.length
                ? `Elige el objeto. Queda retenido hasta que acabe la subasta (24 o 48 horas). Puedes tener ${subastas.MAX_ABIERTAS} subastas abiertas.`
                : "No tienes objetos que se puedan subastar (los de protección contra robos no salen del inventario).",
        );
    const filas = [];
    const p = paginaDeLista(objetos, pagina);
    if (p.items.length) {
        filas.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("subastas_sel_objeto")
                    .setPlaceholder("Elige el objeto")
                    .addOptions(
                        p.items.map((o) => ({
                            label: recorte(`${o.nombre}${o.cantidad > 1 ? ` (x${o.cantidad})` : ""}`, 100),
                            value: String(o.id),
                            description: recorte(o.descripcion || o.rareza || "Objeto", 100),
                        })),
                    ),
            ),
        );
    }
    const paginas = filaPaginas("subastas_objetos_", p);
    if (paginas) filas.push(paginas);
    filas.push(new ActionRowBuilder().addComponents(boton("subastas_vista_mias", "⬅️ Volver")));
    return { content: "", embeds: [embed], components: filas, allowedMentions: { parse: [] } };
}

const campo = (id, etiqueta, valor, max = 9) =>
    new ActionRowBuilder().addComponents(
        new TextInputBuilder()
            .setCustomId(id)
            .setLabel(etiqueta)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(max)
            .setValue(valor),
    );

/** El formulario de pujar, con la puja mínima ya escrita. */
function modalPuja(s) {
    return new ModalBuilder()
        .setCustomId(`subastas_modal_puja_${s.id}`)
        .setTitle(recorte(`💰 Pujar por ${s.nombre}`, 45))
        .addComponents(campo("cantidad", `Cuánto pujas (mínimo ${fmtNumero(subastas.minimaPuja(s))})`, String(subastas.minimaPuja(s))));
}

/** El formulario de crear la subasta de un objeto. */
function modalCrear(objeto) {
    return new ModalBuilder()
        .setCustomId(`subastas_modal_crear_${objeto.id}`)
        .setTitle(recorte(`🔨 Subastar ${objeto.nombre}`, 45))
        .addComponents(
            campo("precio", "Precio de salida", "100"),
            campo("incremento", "Incremento mínimo entre pujas", "10"),
            campo("horas", "Duración en horas: 24 o 48", "24", 2),
        );
}

module.exports = { pantallaSubastas, pantallaSubasta, pantallaElegirObjeto, modalPuja, modalCrear };
