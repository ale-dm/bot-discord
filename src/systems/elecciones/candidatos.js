// 🗳️ Candidatos y quién puede participar: inscribirse, retirarse y entregar el programa electoral. Sin Discord: quien llama
// pasa si la persona es un bot y cuándo entró en el servidor.
const repo = require("./repositorio");
const { ajustes, DIA_MS } = require("./ajustes");

/** Lo que cabe en un desplegable de Discord: a partir de aquí no se admiten más inscripciones. */
const MAX_CANDIDATOS = 25;
const TITULO_MIN = 3;
const TITULO_MAX = 100;
const TEXTO_MIN = 20;
const TEXTO_MAX = 4000;
/** En qué fases puede retirarse un candidato. */
const FASES_RETIRO = new Set(["inscripcion", "primarias", "programas", "generales"]);

const error = (mensaje) => ({ ok: false, mensaje });

/**
 * ¿Puede votar o presentarse? No siendo un bot y llevando al menos `antiguedadDias` en el servidor.
 * @param {{ esBot?: boolean, unidoEn?: number | null }} persona `unidoEn`: cuándo entró en el servidor (ms)
 */
function elegible({ esBot = false, unidoEn = null }, antiguedadDias, ahora = Date.now()) {
    if (esBot) return error("🤖 Los bots no participan en las elecciones.");
    if (antiguedadDias > 0 && (!unidoEn || ahora - unidoEn < antiguedadDias * DIA_MS)) {
        return error(`⏳ Hace falta llevar al menos **${antiguedadDias}** días en el servidor para participar.`);
    }
    return { ok: true };
}

/**
 * Se presenta a las elecciones en marcha del servidor (solo durante la inscripción).
 * @returns {{ ok: true, eleccion: object, vuelve: boolean } | { ok: false, mensaje: string }}
 */
function inscribir({ guildId, userId, esBot, unidoEn, ahora = Date.now() }) {
    const eleccion = repo.activa(guildId);
    if (!eleccion) return error("🗳️ Ahora mismo no hay elecciones en marcha.");
    if (eleccion.estado !== "inscripcion") return error("🔒 La inscripción de candidatos ya está cerrada.");
    const a = ajustes(guildId);
    const puede = elegible({ esBot, unidoEn }, a.antiguedadDias, ahora);
    if (!puede.ok) return puede;
    if (!a.reeleccion && repo.ultimaConPresidente(guildId)?.presidenteId === String(userId)) {
        return error("🚫 En este servidor no hay reelección: quien acaba de ser presidente no puede presentarse.");
    }
    const antes = repo.candidato(eleccion.id, userId);
    if (antes && !antes.retirado) return error("✅ Ya estás inscrito como candidato.");
    if (repo.candidatos(eleccion.id).length >= MAX_CANDIDATOS) return error(`📋 Ya hay ${MAX_CANDIDATOS} candidatos: no caben más.`);
    repo.inscribir(eleccion.id, userId, ahora);
    return { ok: true, eleccion, vuelve: Boolean(antes) };
}

/**
 * Se retira de las elecciones. Sus votos dejan de contar; en las generales, la papeleta se queda con un finalista menos.
 * @returns {{ ok: true, eleccion: object } | { ok: false, mensaje: string }}
 */
function retirarse(guildId, userId) {
    const eleccion = repo.activa(guildId);
    if (!eleccion || !FASES_RETIRO.has(eleccion.estado)) return error("🗳️ Ahora mismo no hay ninguna candidatura de la que retirarse.");
    const c = repo.candidato(eleccion.id, userId);
    if (!c || c.retirado) return error("❌ No eres candidato en estas elecciones.");
    repo.retirar(eleccion.id, userId);
    return { ok: true, eleccion };
}

/** Limpia y valida un programa: título de 3 a 100 caracteres y texto de 20 a 4000. */
function validarPrograma(titulo, texto) {
    const t = String(titulo ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const x = String(texto ?? "").trim();
    if (t.length < TITULO_MIN || t.length > TITULO_MAX) return error(`❌ El título va de ${TITULO_MIN} a ${TITULO_MAX} caracteres.`);
    if (x.length < TEXTO_MIN || x.length > TEXTO_MAX) return error(`❌ El programa va de ${TEXTO_MIN} a ${TEXTO_MAX} caracteres.`);
    return { ok: true, titulo: t, texto: x };
}

/**
 * Un finalista entrega (o corrige) su programa. Solo durante la fase de programas.
 * @returns {{ ok: true, eleccion: object, corregido: boolean } | { ok: false, mensaje: string }}
 */
function guardarPrograma({ guildId, userId, titulo, texto, ahora = Date.now() }) {
    const eleccion = repo.activa(guildId);
    if (!eleccion || eleccion.estado !== "programas") return error("📜 Los programas solo se entregan en la fase de programas.");
    const c = repo.candidato(eleccion.id, userId);
    if (!c || c.retirado || !c.finalista) return error("❌ Solo los finalistas entregan programa.");
    const v = validarPrograma(titulo, texto);
    if (!v.ok) return v;
    repo.guardarPrograma(eleccion.id, userId, v.titulo, v.texto, ahora);
    return { ok: true, eleccion, corregido: Boolean(c.programa_texto) };
}

module.exports = {
    MAX_CANDIDATOS,
    TITULO_MAX,
    TEXTO_MAX,
    elegible,
    inscribir,
    retirarse,
    validarPrograma,
    guardarPrograma,
};
