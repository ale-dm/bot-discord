// Mercados de goles (#9) y de hándicap (#10), además del 1X2 y del marcador exacto. La API da la cuota de cada línea:
// el partido guarda la línea y las cuotas (apuestas_partidos) y cada apuesta guarda la línea con la que se apostó
// (apuestas_usuario.linea). Elecciones:
//   "mas" / "menos": más o menos goles que la línea (2,5 por defecto: 3 o más, o 2 o menos).
//   "casa" / "fuera": el local o el visitante con hándicap. La línea es la del local (−1,5 = gana por 2 o más); el
//   visitante tiene la contraria (+1,5 = pierde por 1 o menos).
// Las líneas son medias (…,5), así que nunca hay empate de línea (no se devuelve nada por "push").
// Ambos marcan y doble oportunidad (#532), sin línea y solo si la API dio su cuota:
//   "ambossi" / "ambosno": marcan los dos equipos (o no).
//   "dc1x" / "dc12" / "dcx2": gana el local o empata, gana cualquiera (no hay empate) o empata o gana el visitante. Con
//   empate, 1X y X2 ganan y 12 pierde.
const marcadorExacto = require("./marcador");

const LINEA_GOLES = 2.5;
const LINEA_HCAP = 1.5;
const MERCADOS_AMBOS = ["ambossi", "ambosno"];
const MERCADOS_DOBLE = ["dc1x", "dc12", "dcx2"];
const MERCADOS = ["mas", "menos", "casa", "fuera", ...MERCADOS_AMBOS, ...MERCADOS_DOBLE];
// Columna de apuestas_partidos con la cuota de cada elección de mercado.
const COLUMNA_CUOTA = {
    mas: "cuota_mas",
    menos: "cuota_menos",
    casa: "cuota_casa",
    fuera: "cuota_fuera",
    ambossi: "cuota_ambos_si",
    ambosno: "cuota_ambos_no",
    dc1x: "cuota_dc_1x",
    dc12: "cuota_dc_12",
    dcx2: "cuota_dc_x2",
};
// Qué resultados del 1X2 cubre cada doble oportunidad.
const CUBRE = { dc1x: ["home", "draw"], dc12: ["home", "away"], dcx2: ["draw", "away"] };
// Cómo se llama cada uno, sin siglas sueltas.
const NOMBRE = {
    ambossi: "Ambos marcan: Sí",
    ambosno: "Ambos marcan: No",
    dc1x: "Doble oportunidad: 1X",
    dc12: "Doble oportunidad: 12",
    dcx2: "Doble oportunidad: X2",
};
/** La leyenda corta de la doble oportunidad, para la ficha del partido. */
const LEYENDA_DOBLE = "1X = gana el local o empate · 12 = gana cualquiera · X2 = empate o gana el visitante";
/** Goles por equipo que se miran al buscar el mejor escenario de un boleto (el marcador exacto llega a 20). */
const MAX_GOLES_ESCENARIO = 20;

const esMercado = (eleccion) => MERCADOS.includes(eleccion);
const fmtLinea = (n) => String(Math.abs(n)).replace(".", ",");
const signoLinea = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtLinea(n)}`;

/**
 * La cuota de una elección de mercado en un partido, o null si la API no la dio. Ambos marcan y doble oportunidad se cierran
 * al empezar el partido (#532): sus cuotas se piden antes y no se refrescan en directo, así que no valen con el balón en juego.
 */
function cuotaDe(partido, eleccion, ahora = Date.now()) {
    const columna = COLUMNA_CUOTA[eleccion];
    if (!columna) return null;
    const extra = MERCADOS_AMBOS.includes(eleccion) || MERCADOS_DOBLE.includes(eleccion);
    if (extra && partido.start_time && Date.parse(partido.start_time) <= ahora) return null;
    return partido[columna] ?? null;
}

/**
 * La probabilidad implícita (%) de cada resultado del 1X2 sin el margen de la casa (#370), y ese margen: la suma de las
 * probabilidades de las cuotas (1 / cuota) menos 100 %. Las tres suman 100 %. null si falta alguna cuota.
 * @returns {{ home: number, draw: number, away: number, margen: number } | null}
 */
function probabilidadesSinMargen(partido) {
    const cuotas = [partido.cuota_home, partido.cuota_draw, partido.cuota_away].map(Number);
    if (cuotas.some((c) => !Number.isFinite(c) || c <= 0)) return null;
    const implicitas = cuotas.map((c) => 1 / c);
    const suma = implicitas.reduce((s, p) => s + p, 0);
    const [home, draw, away] = implicitas.map((p) => (p / suma) * 100);
    return { home, draw, away, margen: (suma - 1) * 100 };
}

/** Un porcentaje con una cifra decimal y coma: «41,2 %». */
const fmtPorcentaje = (n) => `${n.toFixed(1).replace(".", ",")} %`;

/** La línea que se guarda con la apuesta: goles para más/menos; hándicap del local para casa/fuera. */
function lineaDe(partido, eleccion) {
    if (eleccion === "mas" || eleccion === "menos") return partido.total_linea ?? LINEA_GOLES;
    if (eleccion === "casa" || eleccion === "fuera") return partido.hcap_linea ?? null;
    return null;
}

/** ¿Acierta la apuesta? Para 1X2 y marcador exacto, se delega en marcador.js. `marcador`: "2-1"; `linea` de la apuesta. */
function acierta(eleccion, resultado, marcador, linea) {
    if (!esMercado(eleccion)) return marcadorExacto.acierta(eleccion, resultado, marcador);
    if (CUBRE[eleccion]) return CUBRE[eleccion].includes(resultado);
    const [h, a] = String(marcador || "")
        .split("-")
        .map(Number);
    if (MERCADOS_AMBOS.includes(eleccion)) {
        if (!Number.isFinite(h) || !Number.isFinite(a)) return false;
        return (h > 0 && a > 0) === (eleccion === "ambossi");
    }
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
    return [...botones, ...botonesExtra(partido)];
}

/** Los botones de ambos marcan y doble oportunidad (#532): cada pareja o trío solo si la API dio todas sus cuotas. */
function botonesExtra(partido) {
    const grupo = (elecciones, emoji) =>
        elecciones.every((e) => cuotaDe(partido, e)) ? elecciones.map((e) => ({ eleccion: e, etiqueta: `${emoji} ${NOMBRE[e]}` })) : [];
    return [...grupo(MERCADOS_AMBOS, "⚽"), ...grupo(MERCADOS_DOBLE, "🔀")];
}

/** ¿Tiene el partido cuotas de doble oportunidad? Para enseñar la leyenda. */
const tieneDoble = (partido) => MERCADOS_DOBLE.every((e) => cuotaDe(partido, e));

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
    if (NOMBRE[a.eleccion]) return NOMBRE[a.eleccion];
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
    MERCADOS_AMBOS,
    MERCADOS_DOBLE,
    COLUMNA_CUOTA,
    LEYENDA_DOBLE,
    esMercado,
    tieneDoble,
    botonesExtra,
    cuotaDe,
    lineaDe,
    probabilidadesSinMargen,
    fmtPorcentaje,
    acierta,
    botonesDisponibles,
    textoEleccion,
    maximoPorMarcador,
};
