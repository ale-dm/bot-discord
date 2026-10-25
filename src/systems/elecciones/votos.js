// 🗳️ Votar y contar. Un voto por persona y fase (primarias y generales); votar otra vez lo reemplaza. Cada votante elige si
// su voto es 🔒 secreto (solo suma en el recuento) o 📢 público (se ve a quién ha votado). Los empates se rompen a favor de
// quien se inscribió antes. Sin Discord.
const repo = require("./repositorio");
const { ajustes } = require("./ajustes");
const { elegible } = require("./candidatos");

const FASES_VOTO = new Set(["primarias", "generales"]);

const error = (mensaje) => ({ ok: false, mensaje });

/**
 * La clasificación de una fase: cada candidato que sigue (en las generales, solo los finalistas) con sus votos, de más a
 * menos votado y, a igualdad, por orden de inscripción.
 * @returns {{ userId: string, votos: number, inscrito_en: number }[]}
 */
function clasificacion(eleccionId, fase) {
    const votos = new Map(repo.conteos(eleccionId, fase).map((f) => [f.userId, f.votos]));
    return repo
        .candidatos(eleccionId, { finalistas: fase === "generales" })
        .map((c) => ({ ...c, votos: votos.get(c.userId) || 0 }))
        .sort((a, b) => b.votos - a.votos || a.inscrito_en - b.inscrito_en || a.userId.localeCompare(b.userId));
}

/**
 * Vota a `candidatoId` en la fase en curso.
 * @returns {{ ok: true, eleccion: object, fase: string, antes: object | null, publico: boolean } | { ok: false, mensaje: string }}
 */
function votar({ guildId, votanteId, candidatoId, publico, esBot, unidoEn, ahora = Date.now() }) {
    const eleccion = repo.activa(guildId);
    if (!eleccion || !FASES_VOTO.has(eleccion.estado)) return error("🔒 Ahora mismo no hay ninguna votación abierta.");
    if (eleccion.fase_fin <= ahora) return error("🔒 Esta votación acaba de cerrarse.");
    const puede = elegible({ esBot, unidoEn }, ajustes(guildId).antiguedadDias, ahora);
    if (!puede.ok) return puede;
    const c = repo.candidato(eleccion.id, candidatoId);
    if (!c || c.retirado || (eleccion.estado === "generales" && !c.finalista)) return error("❌ Esa persona no está en la papeleta.");
    const fase = eleccion.estado;
    const antes = repo.votoDe(eleccion.id, fase, votanteId);
    repo.guardarVoto({ eleccionId: eleccion.id, fase, votanteId, candidatoId, publico: Boolean(publico), ahora });
    return { ok: true, eleccion, fase, antes, publico: Boolean(publico) };
}

/** El voto de una persona en la fase en curso, o null. */
function miVoto(eleccion, votanteId) {
    if (!eleccion || !FASES_VOTO.has(eleccion.estado)) return null;
    return repo.votoDe(eleccion.id, eleccion.estado, votanteId);
}

module.exports = { FASES_VOTO, clasificacion, votar, miVoto };
