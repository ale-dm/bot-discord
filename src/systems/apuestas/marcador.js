// Apuesta al marcador exacto (F-AP-10). La Odds API no da cuota para el resultado exacto, así que el premio es fijo:
// lo apostado × PREMIO. Se guarda como una apuesta a partido más (apuestas_usuario), con la elección "exacto_2-1" y
// cuota PREMIO, así que la liquidación, Mis jugadas, las estadísticas, el ranking y el recordatorio la tratan como
// cualquier otra; solo cambia cómo se acierta (este módulo) y cómo se enseña.
const PREFIJO = "exacto_";
/** Lo apostado se multiplica por esto si se acierta el marcador. */
const PREMIO = 8;
/** Goles como mucho por equipo en el formulario. */
const MAX_GOLES = 20;

/** Elección guardada para un marcador: "exacto_2-1". */
const eleccion = (golesLocal, golesVisitante) => `${PREFIJO}${golesLocal}-${golesVisitante}`;

/** El marcador de una elección ("2-1"), o null si no es de marcador exacto. */
function marcadorDe(e) {
    const m = /^exacto_(\d+)-(\d+)$/.exec(String(e || ""));
    return m ? `${Number(m[1])}-${Number(m[2])}` : null;
}

/** Goles de un campo del formulario: entero de 0 a MAX_GOLES, o null. */
function golesValidos(texto) {
    const t = String(texto ?? "").trim();
    if (!/^\d{1,2}$/.test(t)) return null;
    const n = Number(t);
    return n <= MAX_GOLES ? n : null;
}

/**
 * ¿Acierta la apuesta? `resultado`: "home" | "draw" | "away"; `marcador`: "2-1" (goles del local - del visitante).
 * Las de marcador exacto aciertan solo con ese marcador; las demás, con el resultado.
 */
function acierta(e, resultado, marcador) {
    const exacto = marcadorDe(e);
    if (!exacto) return e === resultado;
    const [h, a] = String(marcador || "").split("-");
    return exacto === `${Number(h)}-${Number(a)}`;
}

module.exports = { PREFIJO, PREMIO, MAX_GOLES, eleccion, marcadorDe, golesValidos, acierta };
