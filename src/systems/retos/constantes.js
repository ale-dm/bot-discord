// Números, tablas y textos de los retos. No depende de nada: lo usan el resto de ficheros de la carpeta.
const MIN = 10;
const MAX = 100_000;
/** Retos sin aceptar que puede tener abiertos una persona a la vez. */
const MAX_PENDIENTES = 5;
/** Tiempo para aceptar un reto (en los de partido, como mucho hasta que empieza). */
const ESPERA_ACEPTAR_MS = 24 * 3600 * 1000;
/** Un duelo sin tocar este tiempo se da por abandonado. */
const ABANDONO_MS = 15 * 60 * 1000;
/** Una porra sin resolver en este tiempo se devuelve. */
const PORRA_DIAS = 30;
const PORRA_MAX_OPCIONES = 5;
const PORRA_MAX_LARGO_OPCION = 40;
const MAX_RONDAS_PPT = 5;
/** El Duende como participante de un reto (en vez de un id de Discord). */
const DUENDE = "duende";
/** Lo máximo que se juega contra el Duende (su parte la pone la banca). */
const TOPE_DUENDE = 1000;

const JUEGOS = {
    ppt: { emoji: "🪨", nombre: "Piedra, papel o tijera" },
    dados: { emoji: "🎲", nombre: "Dados" },
    blackjack: { emoji: "🃏", nombre: "Blackjack" },
};
const PPT = {
    piedra: { emoji: "🪨", gana_a: "tijera" },
    papel: { emoji: "📄", gana_a: "piedra" },
    tijera: { emoji: "✂️", gana_a: "papel" },
};
const ELECCIONES = ["home", "draw", "away"];
const SIN_EFECTIVO = "❌ No te llega el efectivo. Saca dinero del banco en `/perfil` → 💰 Economía → 💵 Sacar.";

module.exports = {
    MIN,
    MAX,
    MAX_PENDIENTES,
    ESPERA_ACEPTAR_MS,
    ABANDONO_MS,
    PORRA_DIAS,
    PORRA_MAX_OPCIONES,
    PORRA_MAX_LARGO_OPCION,
    MAX_RONDAS_PPT,
    DUENDE,
    TOPE_DUENDE,
    JUEGOS,
    PPT,
    ELECCIONES,
    SIN_EFECTIVO,
};
