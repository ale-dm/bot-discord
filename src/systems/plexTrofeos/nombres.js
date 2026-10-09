// 🍿 Trofeos de Plex: crear trofeos y pedirle a Gemini sus nombres temáticos (y renombrar los de por defecto).
const db = require("../../core/db");
const guildSettings = require("../guildSettings");
const { MAX_NOMBRES_IA, LOTE_IA, log } = require("./base");
const { cacheCatalogo } = require("./candidatos");

// ─── Nombres con Gemini ──────────────────────────────────────────────────────
function limpiarNombre(s) {
    const t = String(s || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/^["'«“\s]+|["'»”\s]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return t ? t.slice(0, 60) : null;
}
/** Pide a Gemini un nombre temático para cada trofeo ({ id, ia }). @returns {Promise<Map<string, string>>} id → nombre */
async function nombrarConIA(guildId, items) {
    const nombres = new Map();
    if (!items.length || !process.env.GOOGLE_API_KEY) return nombres;
    const { generateContentWithTimeout } = require("../../services/geminiClient");
    const { GEMINI_MODEL } = require("../duende/config");
    const modelo = guildSettings.getSettings(guildId).duende.model || GEMINI_MODEL;
    for (let i = 0; i < items.length; i += LOTE_IA) {
        const lote = items.slice(i, i + LOTE_IA);
        const prompt =
            "Pon nombre a trofeos de un servidor de Discord de amigos que ven series, anime y películas en Plex. Cada trofeo se " +
            "gana al terminar algo. El nombre tiene que sonar a esa obra: una frase mítica, un guiño o un personaje (por " +
            'ejemplo, al terminar Breaking Bad: "Say my name"; Juego de Tronos: "Winter is coming"). Corto (máximo 40 ' +
            "caracteres), sin spoilers del final, sin comillas ni emojis, en español salvo que la frase célebre sea en su " +
            "idioma original. Si el trofeo es de verla en un idioma, que el nombre juegue con ese idioma. Distinto para cada " +
            "trofeo.\n\n" +
            lote.map((x) => `${x.id} → ${x.ia}`).join("\n") +
            '\n\nResponde solo con un objeto JSON: {"<id>": "<nombre>", ...} con todos los id de arriba.';
        try {
            const r = await generateContentWithTimeout(
                {
                    model: modelo,
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    config: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 8192 },
                },
                45000,
                "Trofeos de Plex",
            );
            const texto =
                typeof r?.text === "string" ? r.text : r?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
            const json = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ""));
            const pares = Array.isArray(json) ? json.map((x) => [x.id || x.clave, x.nombre || x.name]) : Object.entries(json);
            const validos = new Set(lote.map((x) => x.id));
            for (const [id, nombre] of pares) {
                const limpio = limpiarNombre(nombre);
                if (validos.has(id) && limpio) nombres.set(id, limpio);
            }
        } catch (e) {
            log.warn(`Gemini no pudo poner nombre a ${lote.length} trofeos de Plex (se quedan con el nombre por defecto): ${e.message}`);
        }
    }
    return nombres;
}
/** Guarda los trofeos nuevos (con el nombre de Gemini si lo hay). @returns {Promise<string[]>} ids pedidos a Gemini */
async function crear(guildId, lista) {
    const conIA = lista.filter((c) => c.ia).slice(0, MAX_NOMBRES_IA);
    const nombres = await nombrarConIA(guildId, conIA);
    const insertar = db.prepare(
        `INSERT OR IGNORE INTO plex_trofeos (guildId, id, tipo, nombre, descripcion, objetivo, recompensa, anime, nombre_ia, creado, dificultad)
         VALUES (@guildId, @id, @tipo, @nombre, @descripcion, 1, @recompensa, @anime, @nombre_ia, @creado, @dificultad)`,
    );
    const ahora = Date.now();
    db.transaction(() => {
        for (const c of lista) {
            insertar.run({
                guildId,
                id: c.id,
                tipo: c.tipo,
                nombre: nombres.get(c.id) || c.nombre,
                descripcion: c.descripcion,
                recompensa: c.recompensa,
                dificultad: c.dificultad,
                anime: c.anime ? 1 : 0,
                nombre_ia: nombres.has(c.id) ? 1 : 0,
                creado: ahora,
            });
        }
    })();
    cacheCatalogo.delete(guildId);
    log.info(`Trofeos de Plex nuevos en ${guildId}: ${lista.length} (${nombres.size} con nombre de Gemini)`);
    return process.env.GOOGLE_API_KEY ? conIA.map((c) => c.id) : [];
}
/** Los tipos de trofeo que llevan nombre de Gemini (los de género y década tienen uno fijo; los de admin, el suyo). */
const TIPOS_CON_IA = ["temporada", "serie", "saga", "director", "idioma"];
/**
 * Pide a Gemini el nombre de los trofeos que se quedaron con el de por defecto ("X: completada"), porque Gemini falló o
 * porque se pasó del tope de nombres de una sincronización, o porque son de antes de que los de idioma lo llevaran. Como
 * mucho `max` (lo que sobra del tope en esta sincronización), sin los de `yaPedidos` (los de esta sincronización: si
 * Gemini acaba de fallar con ellos, se prueba en la siguiente). @returns {Promise<number>} renombrados
 */
async function renombrar(guildId, max, yaPedidos = new Set()) {
    if (max <= 0 || !process.env.GOOGLE_API_KEY) return 0;
    const filas = db
        .prepare(
            `SELECT id, descripcion FROM plex_trofeos WHERE guildId = ? AND nombre_ia = 0 AND tipo IN (${TIPOS_CON_IA.map(() => "?").join(",")})
             ORDER BY creado, id`,
        )
        .all(guildId, ...TIPOS_CON_IA)
        .filter((f) => !yaPedidos.has(f.id))
        .slice(0, max);
    if (!filas.length) return 0;
    // La descripción ya dice de qué es ("Termina Breaking Bad entera (62 episodios)"); sin los emojis del principio.
    const items = filas.map((f) => ({ id: f.id, ia: String(f.descripcion).replace(/^[^\p{L}\p{N}]+/u, "") }));
    const nombres = await nombrarConIA(guildId, items);
    const guardar = db.prepare("UPDATE plex_trofeos SET nombre = ?, nombre_ia = 1 WHERE guildId = ? AND id = ?");
    db.transaction(() => {
        for (const [id, nombre] of nombres) guardar.run(nombre, guildId, id);
    })();
    if (nombres.size) cacheCatalogo.delete(guildId);
    log.info(`Trofeos de Plex renombrados con Gemini en ${guildId}: ${nombres.size} de ${filas.length}`);
    return nombres.size;
}

// ─── Trofeos sociales (F-PX-12) ──────────────────────────────────────────────

module.exports = { limpiarNombre, nombrarConIA, crear, TIPOS_CON_IA, renombrar };
