# Features

Ideas de funcionalidad nueva, sin implementar. Cuando se haga una, borrarla de aquí y apuntarla en
[CHANGELOG.md](../CHANGELOG.md). Los problemas del código que ya existe están en
[DEUDA_TECNICA.md](DEUDA_TECNICA.md), y las tareas manuales en [TAREAS.md](TAREAS.md).

**Esfuerzo:** S (reutiliza algo que ya existe, una tarde) · M (un par de días) · L (más).
**Créditos** (solo apuestas): coste extra en la Odds API. El plan gratuito da 500 al mes y hoy se gastan
pocos (se ven en el log y en `/diagnostico`).

## Por dónde empezar

Lo que más aporta con menos trabajo:

1. [F-AD-02](#administración) Resumen semanal para admins: ya llegan DMs a los admins (alertas).
2. [F-AP-03](#apuestas-deportivas) Ranking de apostadores (podría incluir los retos).
3. [F-EC-03](#economía-y-juego) Clasificación semanal con premios.
4. [F-AP-12](#apuestas-deportivas) Liga de pronósticos por temporada.

Hechas el 2026-10-02 (ver el [CHANGELOG](../CHANGELOG.md)): F-EC-01 (recompensa diaria), F-PX-01 ("ya está en
Plex"), F-AP-06 (resultados en el canal), F-AP-08 (recordatorio antes del partido), F-AD-01 (alertas por DM) y,
con el sistema de ⚔️ Retos, F-AP-01 (apuestas 1 contra 1), F-EC-04 (duelos de casino) y F-AP-11 (porras propias),
y las tres fases de F-PX-02 (logros genéricos de Plex con la copia del historial de Tautulli; trofeos de cada serie,
temporada y saga con nombre de Gemini, por género, director y década, de admin, separados en series y anime, con
rareza y opción de ocultarlos). El 2026-10-03, además, logros de Plex por idioma (inglés, VOSE, castellano y las
versiones del anime) y dificultad en todos (fácil, normal y Gordo del Plex).

---

## Apuestas deportivas

| ID | Idea | Tipo | Esfuerzo | Créditos | Detalle |
|---|---|---|---|---|---|
| F-AP-02 | **Combinadas** | Mercado | M | 0 | Varios partidos en un boleto; cuota final = producto de las cuotas; se gana solo si se aciertan todos. |
| F-AP-03 | **Ranking de apostadores** | Entre jugadores | S | 0 | Beneficio, % de acierto y mejor racha (ya se guarda el premio de cada apuesta). |
| F-AP-04 | **Cartera de apuestas** | Seguimiento | S | 0 | Mejorar `/misapuestas`: total en juego, posible premio y beneficio del mes. |
| F-AP-05 | **Cancelar una apuesta** | Reglas | S | 0 | Devolverla antes de que empiece el partido, con una pequeña comisión. |
| F-AP-07 | **Partido destacado del día** | Seguimiento | S | 0 | Mensaje con las cuotas del partido grande de la jornada y botón de apostar (usa la caché). Podría ir al canal de resultados. |
| F-AP-09 | **Límites por jugador** | Reglas | S | 0 | Tope diario apostado y máximo por partido, configurables en el panel (el sistema de límites del casino ya existe). |
| F-AP-10 | **Marcador exacto** | Mercado | S | 0 | Sin cuota de la API: premio fijo (p. ej. ×8) o bote repartido entre los que acierten, como la quiniela. |
| F-AP-12 | **Liga de pronósticos por temporada** | Entre jugadores | M | 0 | Puntos por acierto en cada quiniela, clasificación acumulada y premio al final de temporada. |
| F-AP-13 | **Más/menos goles (2,5)** | Mercado | M | +1 por descarga | Mercado `totals`. Se liquida con el marcador que ya se consulta. |
| F-AP-14 | **Hándicap** | Mercado | M | +1 por descarga | Mercado `spreads` ("Barça −1,5"). Mismo coste que F-AP-13: mejor elegir uno de los dos. |
| F-AP-15 | **Más competiciones** | Mercado | M | +1 por competición | Mundial, Eurocopa, Copa del Rey, Europa League. Asumible con la caché si se apuesta poco. Basta con añadirlas a `DEPORTES` en `src/services/oddsApi.js` (y a las opciones de los comandos). |
| F-AP-16 | **Apuestas en directo** | Mercado | L | Muy alto | Cuotas refrescadas cada pocos minutos: agota el plan gratuito en un fin de semana. Solo con plan de pago. |

## Duende e IA

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-DU-02 | **Personalidad según la hora o el canal** | S | Más borde de madrugada, más formal en ciertos canales. |
| F-DU-03 | **El Duende participa en la economía** | S | Herramientas para que apueste contigo, preste monedas o te rete a piedra-papel-tijera desde el chat (los retos ya existen: le faltaría poder lanzar uno). |
| F-DU-04 | **Recuerdos automáticos** | M | Detecta cosas memorables de la conversación y propone guardarlas como nota; un admin las aprueba con un botón. |
| F-DU-05 | **Conversación de voz continua** | M | Modo "tertulia": escucha a todos los del canal, no solo a una persona. |
| F-DU-06 | **Memoria semántica con embeddings** | S | Guardar un vector (Gemini embeddings, $0,15/M tokens de entrada, salida gratis) junto a cada nota del Duende y buscar por similitud en vez de notas fijas. Con el volumen de este server no hace falta una base de datos vectorial: comparar a pelo en SQLite basta. |
| F-DU-07 | **Conversación de voz en tiempo real (Gemini Live API)** | L | Sustituye el pipeline por lotes de `/escuchar` (Vosk + TTS) por audio bidireccional real (~$0,005/min de entrada + $0,018/min de salida). El coste por uso es bajo, pero hay que recablear las herramientas del Duende al protocolo de la sesión en vivo (distinto del de `generateContent`) y poner un timeout de inactividad, porque se cobra mientras la conexión esté abierta, no solo cuando alguien habla. |

## Plex y Seerr

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-PX-02d | **Trofeos por país** | M | Lo único que quedó fuera de las fases 2 y 3: Tautulli no da el país de las películas. Habría que leerlo de Plex directamente (con un token de Plex) o de TMDB a partir del `guid`. |
| F-PX-02e | **Filtro de categoría en 🏅 Logros** | S | Hay 80 logros fijos de Plex (con los de idioma) que ve todo el mundo, también quien no tiene Plex vinculado, y además los trofeos de quien ve mucho: la pestaña pasa de 20 páginas. Un menú para ver solo una categoría, solo los trofeos o solo una dificultad, y quizá esconder los de Plex a quien no lo tiene vinculado. |
| F-PX-02f | **El Duende conoce los trofeos** | S | Herramienta para "¿qué trofeos de Plex tiene X?" o "¿quién ha terminado Breaking Bad?" con las tablas `plex_trofeos` y `achievements_progress`. |
| F-PX-03 | **Recomendaciones personales** | M | A partir de lo que cada uno ve en Tautulli, con botón "Pedir en Seerr". |
| F-PX-04 | **Plex Wrapped mensual** | M | Imagen con horas vistas, top series y el más viciado (ya hay `canvas` para las gráficas de cripto). |
| F-PX-05 | **Sesión de cine** | M | `/cine peli hora`: convocatoria con botones de "me apunto" y recordatorio 10 min antes. |
| F-PX-06 | **`npm run plex:check` contra el Tautulli real** | S | Script de solo lectura (como `voz:test`): unas reproducciones con el idioma que se detecta (y cuántas salen "otro" o sin dato), las bibliotecas y cuáles cuentan como anime, la ficha de una serie con sus temporadas. Para comprobar los supuestos de [SIGUIENTES_PASOS](../SIGUIENTES_PASOS.md#3-lo-que-hay-que-comprobar-con-datos-reales) en dos minutos. |
| F-PX-07 | **🔍 Diagnóstico de idiomas en el panel** | S | En Panel admin → Plex → 🏆 Trofeos: cuántas reproducciones hay de cada audio y subtítulo, y qué nombres no se reconocen (para ajustar `plexIdiomas.codigoIdioma`). |
| F-PX-08 | **Proteger la economía en la primera importación** | S | Al importar el historial entero cada vinculado desbloquea decenas de logros de golpe. Que lo de la primera importación dé la mitad (o nada), o un tope diario de monedas por logros. |
| F-PX-09 | **Pestaña 🍿 Plex en `/perfil` con "casi lo tienes"** | M | Horas, series terminadas, reparto de idiomas ("60 % en VOSE") y lo que le falta poco: "3 episodios para terminar *Dark* en inglés", "2 películas para *Cineclub*". Los datos ya los calcula `plexTrofeos.datosUsuario`. |
| F-PX-10 | **Ranking de Plex en 🏆 Rankings** | S | Más trofeos, más 🎰 Gordos del Plex, más horas (del mes o de siempre), más políglota. El menú de rankings ya existe (`paneles/perfil.js`). |
| F-PX-11 | **Trofeos con fecha** | M | Condiciones de admin con fechas ("Halloween: 5 de terror en octubre") y eventos de temporada. |
| F-PX-12 | **Trofeos sociales** | M | "Cine compartido" (lo mismo que otro vinculado el mismo día), "Sin spoilers" (en las 24 h desde que llega a Plex), "Primero del servidor" en ver un estreno. |
| F-PX-13 | **Roles por Gordos del Plex** | S | Un rol al llegar a 1, 5 y 10 🎰; con el sistema de roles de niveles. |
| F-PX-14 | **Nombres de Gemini para los trofeos de idioma** | S | Y renombrar después los que se quedaron con el nombre por defecto por pasar del tope de 150 por sincronización. |

## Economía y juego

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-EC-02 | **Eventos temporales** | S | Happy hour de XP ×2, fin de semana con premios del casino subidos (los multiplicadores ya existen). |
| F-EC-03 | **Clasificación semanal con premios** | S | Cada lunes, premio automático al más rico, al más activo y al mejor apostador (con F-AP-03). |
| F-EC-05 | **Pase de batalla** | L | Diseñado en [diseno/pase-de-batalla-s1.md](diseno/pase-de-batalla-s1.md). |
| F-EC-06 | **Impuestos, robos y dinero negro** | M | Sobre el efectivo y el banco del [plan de paneles](diseno/reorganizacion-paneles.md#4-plan-de-ejecución) (parte 5): el banco es seguro y el efectivo se puede perder. Robar efectivo a otro, impuestos sobre ingresos o saldo, dinero negro que no se puede ingresar sin "blanquearlo". Por diseñar. |

## Administración

| ID | Idea | Esfuerzo | Detalle |
|---|---|---|---|
| F-AD-02 | **Resumen semanal para admins** | S | Errores de la semana, créditos de API, uso de Gemini y comandos más usados (datos que ya están en los logs y en 🩺 Sistema), por DM a quien recibe las alertas (`systems/alertas`). |
| F-AD-03 | **Cambio automático de modelo de Gemini** | S | Si el modelo configurado da 404 o no usa herramientas (ya se comprueba al arrancar), pasar solo a uno que funcione en vez de solo avisar. |
