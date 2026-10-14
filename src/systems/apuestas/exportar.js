// 📤 Exportar mis apuestas a CSV (#356): todo el historial de apuestas de una persona (partidos, combinadas y quinielas) con su fecha,
// elección, importe, cuota, estado y premio o devolución, para revisarlo con calma o cuadrar cuentas. Sin Discord: lo envía
// juegos/apuestas/exportar. Usa las mismas consultas de 📋 Mis jugadas (sin el límite de filas), así que las cifras cuadran con 📊 Stats.
const jugadas = require("./misJugadas");
const mercados = require("./mercados");

const CABECERA = ["tipo", "fecha", "partido o jornada", "eleccion", "cantidad", "cuota", "estado", "premio o devolucion"];
const TODAS = 1_000_000_000; // las consultas de Mis jugadas piden un límite de filas: aquí no hay

/** Un valor de texto de una celda; si empieza como una fórmula (=, +, -, @), se le pone una comilla delante para que una hoja de cálculo no la ejecute. */
function textoSeguro(valor) {
    const texto = String(valor ?? "");
    return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

/** Una celda CSV: entre comillas si lleva coma, comillas o salto de línea. */
function celda(valor) {
    const texto = String(valor ?? "");
    return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** La fecha ISO tal cual (AAAA-MM-DDTHH:MM:SSZ), o vacía. */
const fechaDe = (iso) => (iso ? new Date(iso).toISOString() : "");

/** El estado de una apuesta a un partido: pendiente, ganada, perdida, devuelta (partido sin resultado) o liquidada (sin premio guardado). */
function estadoPartido(a) {
    if (a.estado === "abierto") return "pendiente";
    if (a.estado === "caducado") return "devuelta";
    if (a.premio > 0) return "ganada";
    return a.premio === 0 ? "perdida" : "liquidada";
}

function filaPartido(a) {
    const estado = estadoPartido(a);
    const premio = estado === "devuelta" ? a.cantidad : estado === "pendiente" ? "" : (a.premio ?? "");
    return [
        "partido",
        fechaDe(a.start_time),
        `${a.home_team} vs ${a.away_team}`,
        mercados.textoEleccion(a),
        a.cantidad,
        a.cuota,
        estado,
        premio,
    ];
}

const ESTADO_COMBINADA = { abierta: "pendiente", ganada: "ganada", perdida: "perdida", reembolsada: "devuelta", cancelada: "cancelada" };

function filaCombinada(c) {
    const patas = c.patas.map((p) => `${p.home_team} vs ${p.away_team}: ${mercados.textoEleccion(p)}`).join(" | ");
    const estado = ESTADO_COMBINADA[c.estado] || c.estado;
    return [
        "combinada",
        fechaDe(c.creada_en),
        `${c.patas.length} ${c.patas.length === 1 ? "partido" : "partidos"}: ${patas}`,
        "",
        c.cantidad,
        c.cuota,
        estado,
        c.estado === "abierta" ? "" : (c.premio ?? ""),
    ];
}

function filaQuiniela(q) {
    const estado = q.estado === "abierta" ? "pendiente" : q.reembolsada ? "devuelta" : q.premio > 0 ? "ganada" : "perdida";
    const premio = estado === "pendiente" ? "" : estado === "devuelta" ? q.cantidad : (q.premio ?? 0);
    return ["quiniela", fechaDe(q.creada_en), q.jornada, q.predicciones, q.cantidad, "", estado, premio];
}

/** Las filas del CSV (sin la cabecera): partidos, combinadas y quinielas, de lo más antiguo a lo más reciente dentro de cada tipo. */
function filasDe(userId) {
    const partidos = [
        ...jugadas.partidosDe(userId, { pendientes: false, limite: TODAS }),
        ...jugadas.partidosDe(userId, { pendientes: true, limite: TODAS }),
    ];
    const combinadas = [
        ...jugadas.combinadasDe(userId, { abiertas: false, limite: TODAS }),
        ...jugadas.combinadasDe(userId, { abiertas: true, limite: TODAS }),
    ];
    const quinielas = [
        ...jugadas.quinielasDe(userId, { abiertas: false, limite: TODAS }),
        ...jugadas.quinielasDe(userId, { abiertas: true, limite: TODAS }),
    ];
    const porFecha = (indice) => (a, b) => String(a[indice]).localeCompare(String(b[indice]));
    return [
        ...partidos.map(filaPartido).sort(porFecha(1)),
        ...combinadas.map(filaCombinada).sort(porFecha(1)),
        ...quinielas.map(filaQuiniela).sort(porFecha(1)),
    ];
}

/**
 * El CSV de las apuestas de una persona: la cabecera y una fila por apuesta. Sin apuestas, solo la cabecera.
 * @returns {{ csv: string, total: number }} `total`: cuántas apuestas lleva
 */
function csvDeApuestas(userId) {
    const textos = new Set([2, 3]); // partido o jornada, y elección: textos que vienen de fuera
    const filas = filasDe(userId);
    const lineas = filas.map((fila) => fila.map((v, i) => celda(textos.has(i) ? textoSeguro(v) : v)).join(","));
    return { csv: `${[CABECERA.join(","), ...lineas].join("\n")}\n`, total: filas.length };
}

module.exports = { CABECERA, csvDeApuestas, filasDe, textoSeguro, celda };
