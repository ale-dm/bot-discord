// Mercados de goles (#9) y de hándicap (#10), además del 1X2 y del marcador exacto. La API da la cuota de cada línea:
// el partido guarda la línea y las cuotas (apuestas_partidos) y cada apuesta guarda la línea con la que se apostó
// (apuestas_usuario.linea). Elecciones:
//   "mas" / "menos": más o menos goles que la línea (2,5 por defecto: 3 o más, o 2 o menos).
//   "casa" / "fuera": el local o el visitante con hándicap. La línea es la del local (−1,5 = gana por 2 o más); el
//   visitante tiene la contraria (+1,5 = pierde por 1 o menos).
// Las líneas son medias (…,5), así que nunca hay empate de línea (no se devuelve nada por "push").
const marcadorExacto = require("./marcador");

const LINEA_GOLES = 2.5;
const LINEA_HCAP = 1.5;
const MERCADOS = ["mas", "menos", "casa", "fuera"];
/** Goles por equipo que se miran al buscar el mejor escenario de un boleto (el marcador exacto llega a 20). */
const MAX_GOLES_ESCENARIO = 20;

const esMercado = (eleccion) => MERCADOS.includes(eleccion);
const fmtLinea = (n) => String(Math.abs(n)).replace(".", ",");
const signoLinea = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtLinea(n)}`;

/** La cuota de una elección de mercado en un partido, o null si la API no la dio. */
function cuotaDe(partido, eleccion) {
    const cuota = { mas: partido.cuota_mas, menos: partido.cuota_menos, casa: partido.cuota_casa, fuera: partido.cuota_fuera }[eleccion];
    return cuota ?? null;
}

/** La línea que se guarda con la apuesta: goles para más/menos; hándicap del local para casa/fuera. */
function lineaDe(partido, eleccion) {
    if (eleccion === "mas" || eleccion === "menos") return partido.total_linea ?? LINEA_GOLES;
    if (eleccion === "casa" || eleccion === "fuera") return partido.hcap_linea ?? null;
    return null;
}

/** ¿Acierta la apuesta? Para 1X2 y marcador exacto, se delega en marcador.js. `marcador`: "2-1"; `linea` de la apuesta. */
function acierta(eleccion, resultado, marcador, linea) {
    if (!esMercado(eleccion)) return marcadorExacto.acierta(eleccion, resultado, marcador);
    const [h, a] = String(marcador || "")
        .split("-")
        .map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(a) || linea == null) return false;
    if (eleccion === "mas" || eleccion === "menos") {
        const total = h + a;
        return eleccion === "mas" ? total > linea : total < linea;
    }
    const diferencia = h - a;
    return eleccion === "casa" ? diferencia + linea > 0 : -diferencia - linea > 0;
}

/** Los botones de mercado que se pueden mostrar en un partido (solo los que tienen cuota). */
function botonesDisponibles(partido) {
    const botones = [];
    if (cuotaDe(partido, "mas")) botones.push({ eleccion: "mas", etiqueta: `⬆️ Más de ${fmtLinea(lineaDe(partido, "mas"))} goles` });
    if (cuotaDe(partido, "menos"))
        botones.push({ eleccion: "menos", etiqueta: `⬇️ Menos de ${fmtLinea(lineaDe(partido, "menos"))} goles` });
    if (cuotaDe(partido, "casa") && lineaDe(partido, "casa") != null) {
        botones.push({ eleccion: "casa", etiqueta: `🏠 ${partido.home_team} ${signoLinea(lineaDe(partido, "casa"))}` });
    }
    if (cuotaDe(partido, "fuera") && lineaDe(partido, "fuera") != null) {
        botones.push({ eleccion: "fuera", etiqueta: `✈️ ${partido.away_team} ${signoLinea(-lineaDe(partido, "fuera"))}` });
    }
    return botones;
}

/** Cómo se nombra una apuesta (de cualquier tipo) para las pantallas y los avisos. */
function textoEleccion(a) {
    const m = marcadorExacto.marcadorDe(a.eleccion);
    if (m) return `Marcador exacto ${m}`;
    if (a.eleccion === "home") return a.home_team;
    if (a.eleccion === "draw") return "Empate";
    if (a.eleccion === "away") return a.away_team;
    if (a.eleccion === "mas") return `Más de ${fmtLinea(a.linea ?? LINEA_GOLES)} goles`;
    if (a.eleccion === "menos") return `Menos de ${fmtLinea(a.linea ?? LINEA_GOLES)} goles`;
    if (a.eleccion === "casa") return a.linea == null ? `${a.home_team} con hándicap` : `${a.home_team} ${signoLinea(a.linea)}`;
    if (a.eleccion === "fuera") return a.linea == null ? `${a.away_team} con hándicap` : `${a.away_team} ${signoLinea(-a.linea)}`;
    return a.away_team;
}

/**
 * Lo máximo que se puede cobrar de un conjunto de apuestas a un partido: el mayor premio entre todos los marcadores
 * finales posibles. Así cuentan a la vez el 1X2, el marcador exacto, los goles y el hándicap (no son excluyentes).
 * @param {{ eleccion, cantidad, cuota, linea? }[]} apuestas
 */
function maximoPorMarcador(apuestas) {
    const premio = (a) => Math.round(a.cantidad * a.cuota);
    let mejor = 0;
    for (let h = 0; h <= MAX_GOLES_ESCENARIO; h++) {
        for (let a = 0; a <= MAX_GOLES_ESCENARIO; a++) {
            const resultado = h > a ? "home" : h < a ? "away" : "draw";
            const marcador = `${h}-${a}`;
            let total = 0;
            for (const ap of apuestas) if (acierta(ap.eleccion, resultado, marcador, ap.linea)) total += premio(ap);
            mejor = Math.max(mejor, total);
        }
    }
    return mejor;
}

module.exports = {
    LINEA_GOLES,
    LINEA_HCAP,
    MERCADOS,
    esMercado,
    cuotaDe,
    lineaDe,
    acierta,
    botonesDisponibles,
    textoEleccion,
    maximoPorMarcador,
};
