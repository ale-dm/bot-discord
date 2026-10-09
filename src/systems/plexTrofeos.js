// 🍿 Trofeos de Plex, fases 2 y 3 (F-PX-02b y F-PX-02c). Con la copia del historial (plex_reproducciones) y las fichas
// de Tautulli (systems/plexFichas):
//   - Fase 2, de cada título: terminar una temporada, una serie entera o una saga (colección de Plex). Separados en
//     series y anime (🎌): lo que es anime lo dicen las bibliotecas (configAnime).
//   - Fase 3, por significado: películas de un género (10 y 25), todas las de un director que hay en Plex, 10 películas
//     de una década (antes de 2000), y los que crea un admin en /paneladmin → Plex → 🏆 Trofeos.
//   - Contadores fijos del catálogo (achievementsSystem): películas, series y episodios de anime y series terminadas, y
//     por idioma (systems/plexIdiomas): episodios, películas y series enteras en inglés, VOSE, castellano...
//   - Por idioma, de cada serie: terminarla entera en una versión ("Breaking Bad en inglés").
//   - Sociales (F-PX-12, contadores fijos): la misma película que otro el mismo día, verlo en las 24 h desde que llega
//     a Plex y ser el primero del servidor en ver un estreno.
//   - Los de admin pueden llevar fechas (F-PX-11): solo cuenta lo visto entre ellas (eventos de temporada).
// Los de cada título y los de significado se crean la primera vez que alguien los consigue, con un nombre temático que
// propone Gemini ("Say my name" al terminar Breaking Bad) y que se guarda (los que se quedan con el de por defecto se
// renombran en las siguientes sincronizaciones, F-PX-14); para los demás solo se ven cuando los consiguen. Son logros
// normales de la categoría plex (id "plext:…"): se reclaman en /perfil → 🏅 Logros.
// Todos tienen dificultad: 🟢 fácil, 🟡 normal o 🎰 "Gordo del Plex".

// Partido en systems/plexTrofeos/ (DT-17): cada parte en su fichero. Esta fachada exporta lo mismo que antes.

const { PREFIJO, EVENTOS_FICHAS } = require("./plexTrofeos/base");
const { catalogo, candidatos, datosUsuario, contexto } = require("./plexTrofeos/candidatos");
const { CONDICIONES, AYUDA_FECHAS, rangoDe, parsearCondicion } = require("./plexTrofeos/condiciones");
const { renombrar } = require("./plexTrofeos/nombres");
const { EVENTOS_SOCIALES, eventosDe, sociales } = require("./plexTrofeos/sociales");
const {
    buscar,
    crearAdmin,
    borrar,
    resumen,
    rarezas,
    textoRareza,
    paraAnuncio,
    oculto,
    setOculto,
    opcionesPerfil,
} = require("./plexTrofeos/gestion");

module.exports = {
    PREFIJO,
    EVENTOS_FICHAS,
    EVENTOS_SOCIALES,
    CONDICIONES,
    AYUDA_FECHAS,
    catalogo,
    candidatos,
    eventosDe,
    datosUsuario,
    contexto,
    sociales,
    renombrar,
    buscar,
    rangoDe,
    parsearCondicion,
    crearAdmin,
    borrar,
    resumen,
    rarezas,
    textoRareza,
    paraAnuncio,
    oculto,
    setOculto,
    opcionesPerfil,
};
