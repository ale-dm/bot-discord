// Las constantes del pase de batalla (#36): temporadas, curva de niveles, XP por categoría con su tope diario, misiones, recompensas, el
// día perfecto (#334) y las rachas (#335). Lo que un admin puede cambiar desde /paneladmin → 🛡️ Pase (#353) son valores por defecto aquí:
// topes, XP por nivel y activar; el resto es fijo.
const DIA_MS = 86400 * 1000;
const DURACION_TEMPORADA_DIAS = 15;
const NIVEL_MAX = 20;
const MISION_XP = 70;
const MISIONES_DIA = 3;
const ORIGEN = Date.UTC(2026, 9, 1); // la temporada 0 empezó el 1 de octubre de 2026 (hora de Madrid, a medianoche)

/** XP de pase por categoría: cuánto da cada cosa y el tope diario (de la propuesta de diseño, sección 2). */
const CATEGORIAS = {
    mensaje: { xp: 2, tope: 120 },
    voz: { xp: 1, tope: 120 }, // por minuto
    casino: { xp: 8, tope: 260 },
    cripto: { xp: 6, tope: 180 },
    apuesta: { xp: 12, tope: 180 },
    tienda: { xp: 8, tope: 80 },
    logro: { xp: 20, tope: 120 }, // por logro completado (no los de la importación de Plex)
    reto: { xp: 15, tope: 90 }, // por reto ganado entre personas (#359): solo gana quien gana, y un reto devuelto no da nada
};

/** Cómo se llama cada categoría en las pantallas. */
const ETIQUETAS = {
    mensaje: "💬 Mensajes",
    voz: "🎙️ Voz (minutos)",
    casino: "🎰 Casino",
    cripto: "📈 Cripto",
    apuesta: "⚽ Apuestas",
    tienda: "🛒 Tienda",
    logro: "🏅 Logros",
    reto: "⚔️ Retos",
};

/** Misiones del día: se eligen 3 de estas cada día (rotando), y cuentan los eventos de su categoría. */
const MISIONES = [
    { id: "mensajes", nombre: "Envía 25 mensajes", categoria: "mensaje", meta: 25 },
    { id: "voz", nombre: "Pasa 10 minutos en voz", categoria: "voz", meta: 10 },
    { id: "casino", nombre: "Juega 5 partidas de casino", categoria: "casino", meta: 5 },
    { id: "cripto", nombre: "Haz 2 operaciones de cripto", categoria: "cripto", meta: 2 },
    { id: "apuesta", nombre: "Ten 1 apuesta resuelta", categoria: "apuesta", meta: 1 },
    { id: "tienda", nombre: "Compra 1 objeto en la tienda", categoria: "tienda", meta: 1 },
    { id: "logro", nombre: "Desbloquea 1 logro", categoria: "logro", meta: 1 },
];

/** Recompensa en monedas de cada nivel (de la propuesta, en TTCL que se leen como monedas 🪙), y el bonus del nivel final. */
const RECOMPENSA = [80, 120, 160, 200, 240, 300, 360, 430, 500, 600, 700, 820, 950, 1100, 1250, 1400, 1600, 1800, 2100, 2500];
const BONUS_FINAL = 2000;

/** Lo que cuesta cada nivel: XP_NIVEL_BASE el primero y XP_NIVEL_PASO más cada vez (el 1 → 2 cuesta 280, el 2 → 3, 320...). */
const XP_NIVEL_BASE = 280;
const XP_NIVEL_PASO = 40;

/** Completar las tres misiones del día da este XP extra, una vez por día (#334). */
const BONUS_DIA_PERFECTO = 100;
/** Días seguidos con las tres misiones completas que dan XP extra, una vez por racha (#335). */
const RACHA_HITOS = [
    { dias: 3, xp: 100 },
    { dias: 7, xp: 250 },
];

/** Las monedas de un nivel (la recompensa y, en el último, el bonus final). */
const monedasDelNivel = (nivel) => RECOMPENSA[nivel - 1] + (nivel === NIVEL_MAX ? BONUS_FINAL : 0);

module.exports = {
    DIA_MS,
    DURACION_TEMPORADA_DIAS,
    NIVEL_MAX,
    MISION_XP,
    MISIONES_DIA,
    ORIGEN,
    CATEGORIAS,
    ETIQUETAS,
    MISIONES,
    RECOMPENSA,
    BONUS_FINAL,
    XP_NIVEL_BASE,
    XP_NIVEL_PASO,
    BONUS_DIA_PERFECTO,
    RACHA_HITOS,
    monedasDelNivel,
};
