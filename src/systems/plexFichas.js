// 🍿 Fichas de Plex para los trofeos (fases 2 y 3). El historial de Tautulli no dice de qué biblioteca es cada cosa, ni
// sus géneros, ni cuántos episodios tiene cada temporada: eso sale de la ficha (get_metadata) de cada título. Aquí se
// guardan en plex_fichas:
//   - Todas las películas de las bibliotecas de películas (la lista se repasa cada 6 h): con ellas se sabe qué películas
//     de un director o de una colección hay en Plex ("todas las de Nolan", sagas).
//   - Las series que alguien ha visto, con los episodios de cada temporada (sin especiales), para saber quién ha
//     terminado una temporada o la serie entera. Las vistas hace poco se vuelven a mirar cada 3 días (episodios nuevos).
//   - Cuándo llegó a Plex cada película y cada episodio (added_at), para los trofeos sociales ("Sin spoilers").
// Se piden poco a poco (un máximo de llamadas por sincronización, primero lo que alguien ha visto), así la primera vez no
// se satura Tautulli: con una biblioteca grande tarda unas horas en estar completa.
// Las piezas están en systems/plexFichas/; este fichero reexporta lo que usa el resto.
const sincronizacion = require("./plexFichas/sincronizacion");
const tautulli = require("./plexFichas/tautulli");
const consulta = require("./plexFichas/consulta");

module.exports = {
    PRESUPUESTO: sincronizacion.PRESUPUESTO,
    completarPaises: sincronizacion.completarPaises,
    tmdbDe: tautulli.tmdbDe,
    actualizar: sincronizacion.actualizar,
    estado: consulta.estado,
    cargar: consulta.cargar,
    bibliotecas: tautulli.bibliotecas,
    nombresBibliotecas: consulta.nombresBibliotecas,
    configAnime: consulta.configAnime,
    esAnime: consulta.esAnime,
    normalizar: consulta.normalizar,
    clavePelicula: consulta.clavePelicula,
};
