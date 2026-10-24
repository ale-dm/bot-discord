// 🎫 Transcripción de un ticket (#537): la conversación del hilo en texto plano, para el .txt que va al canal de logs.
// Recibe los mensajes ya leídos (del más antiguo al más nuevo) como objetos planos: { fecha, autor, autorId, texto,
// adjuntos, embeds }. Tiene un tope de tamaño: si la conversación no cabe, se corta y se dice cuántos mensajes faltan.
const { momentoMadrid } = require("../core/zonaMadrid");

/** Tope del archivo: 1 MB, de sobra para una conversación de soporte y muy por debajo del límite de Discord. */
const MAX_BYTES = 1024 * 1024;

const dos = (n) => String(n).padStart(2, "0");

/** «AAAA-MM-DD HH:MM» en hora de Madrid. */
function fechaHora(ms) {
    const m = momentoMadrid(ms);
    return `${m.dia} ${dos(m.hora)}:${dos(m.minuto)}`;
}

/** Un mensaje en una o varias líneas: la cabecera con la hora y el autor, el texto, los adjuntos y los embeds. */
function lineasMensaje(m) {
    const lineas = [`[${fechaHora(m.fecha)}] ${m.autor || "desconocido"} (${m.autorId || "?"}): ${m.texto || ""}`.trimEnd()];
    for (const url of m.adjuntos || []) lineas.push(`    📎 ${url}`);
    for (const e of m.embeds || []) if (e) lineas.push(`    [embed] ${String(e).replace(/\s+/g, " ").slice(0, 500)}`);
    return lineas.join("\n");
}

/** La cabecera: el ticket, quién lo abrió y lo cerró, y cuándo. */
function cabecera(ticket, nombres = {}) {
    const quien = (id, nombre) => (nombre ? `${nombre} (${id})` : String(id || "—"));
    return [
        `Ticket #${ticket.id} · ${ticket.categoria}`,
        `Abierto por: ${quien(ticket.autorId, nombres.autor)} el ${fechaHora(ticket.abiertoEn)}`,
        ticket.cerradoEn ? `Cerrado por: ${quien(ticket.cerradoPor, nombres.cerradoPor)} el ${fechaHora(ticket.cerradoEn)}` : "Sin cerrar",
        `Asunto: ${ticket.asunto || "—"}`,
        "=".repeat(60),
        "",
    ].join("\n");
}

/**
 * La transcripción completa. `nombres` = { autor, cerradoPor } para la cabecera.
 * @returns {{ texto: string, bytes: number, incluidos: number, total: number, recortada: boolean }}
 */
function generarTranscripcion(ticket, mensajes, { nombres = {}, maxBytes = MAX_BYTES } = {}) {
    const inicio = cabecera(ticket, nombres);
    // Se reserva sitio para la línea final del recorte.
    const reserva = 200;
    let bytes = Buffer.byteLength(inicio);
    const partes = [inicio];
    let incluidos = 0;
    for (const m of mensajes) {
        const bloque = `${lineasMensaje(m)}\n`;
        const tam = Buffer.byteLength(bloque);
        if (bytes + tam > maxBytes - reserva) break;
        partes.push(bloque);
        bytes += tam;
        incluidos++;
    }
    const recortada = incluidos < mensajes.length;
    if (recortada) partes.push(`\n… Transcripción recortada por tamaño: faltan ${mensajes.length - incluidos} mensajes.\n`);
    if (!mensajes.length) partes.push("(Sin mensajes)\n");
    const texto = partes.join("");
    return { texto, bytes: Buffer.byteLength(texto), incluidos, total: mensajes.length, recortada };
}

module.exports = { MAX_BYTES, fechaHora, lineasMensaje, generarTranscripcion };
