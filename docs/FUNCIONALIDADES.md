# El Duende — Qué hace el bot

Documentación funcional de todo lo que hace El Duende: comandos, sistemas automáticos,
configuración y datos. Refleja el código a fecha 2026-10-18.

> **Leyenda:** `*` = opción obligatoria · 🔒 = solo administradores · ⏱️ = tarea automática

## Índice

1. [Visión general](#1-visión-general)
2. [El Duende (IA conversacional)](#2-el-duende-ia-conversacional)
3. [IA y multimedia](#3-ia-y-multimedia)
4. [Niveles y XP](#4-niveles-y-xp)
5. [Logros](#5-logros)
6. [Perfil](#6-perfil)
7. [Economía: banco, tienda e inventario](#7-economía-banco-tienda-e-inventario)
8. [Casino](#8-casino)
9. [Apuestas deportivas y quinielas](#9-apuestas-deportivas-y-quinielas)
10. [Criptomonedas](#10-criptomonedas)
11. [Plex y Seerr](#11-plex-y-seerr)
12. [Administración](#12-administración)
13. [Tareas automáticas](#13-tareas-automáticas)
14. [Utilidades y comandos varios](#14-utilidades-y-comandos-varios)
15. [Configuración (.env)](#15-configuración-env)
16. [Datos, logs y despliegue](#16-datos-logs-y-despliegue)
17. [Referencia rápida de comandos](#17-referencia-rápida-de-comandos)

---

## 1. Visión general

El Duende es un bot de Discord para un grupo de amigos (un único servidor). Combina:

- **Un personaje con IA** (Gemini) que participa en el chat, con memoria de la gente, personalidades,
  herramientas que consultan datos reales del bot y respuestas por voz.
- **Progresión**: XP por mensajes y voz, niveles, rachas diarias, rangos con roles y logros.
- **Economía virtual**: banco, tienda de objetos, casino, apuestas de fútbol reales, retos entre jugadores y una
  criptomoneda propia ($TTCL) con mercado de pool de liquidez.
- **Integración con Plex** (vía Tautulli) y **Seerr** para consultar y pedir películas/series.
- **Panel de administración** para configurarlo todo desde Discord.

Casi todo se hace desde **ocho paneles** con pestañas y botones, enlazados entre sí: `/perfil` (perfil, economía,
juegos, logros y rankings), `/juegos` (casino, apuestas, retos, mis jugadas y stats), `/tienda` (catálogo, inventario y
compras), `/cripto`, `/duende` (hablar, recuerdos, personalidad y guardia), `/plex` (sesión de cine, recomendaciones, Wrapped y
perfil de Plex), `/sonidos` y, para admins, `/paneladmin`. `/ayuda` explica cada parte y tiene botones para abrirlas.

**Público o privado:** de momento los paneles y las partidas son **públicos** (los ve todo el canal), pero solo quien
los abrió puede pulsar sus botones. Se quedan en privado los avisos de error, `/paneladmin`, lo que el Duende recuerda
de la gente (`/duende` → 🧠 Recuerdos), el editor de pronósticos de la quiniela (para que no se copien) y
las pantallas de ayuda de cada juego.

Idioma: todo en español. Zona horaria de referencia: Europe/Madrid (rachas, cron).

---

## 2. El Duende (IA conversacional)

### Cuándo responde

El Duende lee todos los mensajes de texto (no los que empiezan por `/`) y decide si contestar:

| Situación | Probabilidad de respuesta |
|---|---|
| Le mencionan (`@El Duende`) o escriben "duende" en el mensaje | Siempre |
| Conversación activa (le han hablado o ha hablado en los últimos 3 min en ese canal) | 100 % (`DUENDE_ACTIVE_TEXT_REPLY_PROB`) |
| Resto de mensajes | 25 % (`DUENDE_TEXT_REPLY_PROB`) |

- **Mensajes de bajo esfuerzo** ("jajaja", "xd", "lol", un emoji suelto): en vez de gastar una llamada
  a la IA, solo reacciona con un emoji (😂 🤣 👀 💀 😏 🔥).
- **Imágenes**: si el mensaje trae imágenes (hasta 2), las "ve" y puede comentarlas.
- **Canal restringido**: si el admin fija un canal para el Duende, solo responde allí.
- **Límite diario**: 50 respuestas al día en total (`DUENDE_DAILY_LIMIT`) y 15 por persona (`DUENDE_DAILY_LIMIT_USER`). Al llegar al suyo, solo esa persona se queda sin respuesta. Los contadores sobreviven a los reinicios.
- **Imágenes desde el chat**: «dibújame…» genera una imagen con el mismo cooldown y cuota diaria que `/imagen`.
- **Notas de voz**: una nota de voz de menos de 60 s en un canal del Duende se transcribe y contesta como si fuera texto.
- **Mensajes duplicados** (reconexiones de Discord) se ignoran para no ejecutar dos veces una acción.

### Cómo responde

- Respuestas cortas (1–2 frases), en el tono de la **personalidad** activa en el canal.
- **🕐 Tono según la hora o el canal** (F-DU-02; Config Global → Duende → 🕐 Tono, desactivado por defecto): encima de la
  personalidad, 🌙 **más borde de madrugada** (de 00:00 a 07:00 en hora de Madrid, configurable; puede pasar la
  medianoche) y 👔 **más formal en los canales elegidos** (sin tacos ni insultos, aunque mantenga la ironía). Si se dan
  las dos cosas, las dos a la vez. Cambiar la personalidad entera de un canal se hace desde `/duende` → 🎭 Personalidad.
- Recuerda los últimos 20 mensajes de cada canal (`history_limit`); el historial de un canal se borra
  tras 24 h sin actividad.
- Usa los **perfiles de personas** (descripción escrita por un admin en Panel admin → Config Global → Duende →
  🧠 Perfiles, más las notas de 🧠 Recuerdos de `/duende`) para tratar a cada uno según lo que sabe de él, y relaciona
  a quien habla con quien se menciona. Cada perfil va ligado al **Discord ID**: cambiar de username no lo pierde.
- Convierte en **menciones reales** de Discord el nombre de la gente cuando lo escribe en una respuesta
  (el nombre principal de sus apodos, no los motes).
- **Apodos** (Panel admin → Config Global → Duende → Apodos): el nombre con el que llama a cada uno y otras
  formas de referirse a esa persona ("el perro", "coneyo"...), para entender de quién habláis.
- A veces (8 %, `DUENDE_GIF_PROB`) acompaña la respuesta con un **GIF** de Giphy.
- **Voz**: si quien le habla está en un canal de voz, a veces (10 %, `DUENDE_VOICE_REPLY_PROB`) entra y
  dice la respuesta en voz alta (Gemini TTS). Se queda conectado 5 min por si sigue la charla. En voz dice los nombres
  (no las menciones), sin enlaces, emojis del servidor ni formato, y como mucho 200 caracteres. En una charla de voz
  (`/escuchar`), si no puede hablar (el TTS falla, no hay conexión...), contesta por texto en el canal ("🗣️ …").
- Si Gemini bloquea la respuesta por contenido, reintenta con un tono neutro manteniendo las herramientas.
- **Mensajes espontáneos** (Config Global → Duende → 💬 Mensajes solos): de vez en cuando, sin que nadie le hable, se
  dirige en el canal elegido a alguien al azar de quien tenga perfil (🧠 Perfiles, con descripción o notas de
  🧠 Recuerdos de `/duende`), mencionándole, para picarle y que conteste. Solo si ese canal lleva un rato sin mensajes de
  verdad (no interrumpe una conversación activa) y con una probabilidad baja cada hora, de 11:00 a 23:00. Si no hay
  nadie con perfil al que dirigirse, no dice nada. No se dirige a quien ya recibió uno en las últimas 24 h ni a quien escribió el último mensaje del canal. Se activa o desactiva y se elige el canal ahí mismo.

### Herramientas (datos reales)

Durante una respuesta, el Duende puede consultar datos del bot. Las de solo lectura sobre el propio usuario
nunca permiten mirar datos de otro (el usuario sale del contexto de Discord, no del texto).

| Grupo | Herramientas | Dónde |
|---|---|---|
| Básicas | Nivel, XP y racha · saldo · precio de TTCL · logros · tirar un dado · lo que hay en la tienda · tu inventario · tus apuestas en juego y tu balance · tus últimas partidas del casino · si puedes cobrar la recompensa diaria (solo la consulta) | Siempre |
| Plex (Tautulli) | Qué ha visto alguien · qué se ve ahora · horas vistas · última conexión · novedades · comparar a dos personas · top del servidor · buscar en Plex · ranking de quién más ve · bibliotecas · día/hora de más actividad · **trofeos de Plex** (los de alguien, quién tiene el de una serie, saga o director —"¿quién ha terminado Breaking Bad?"— o quién tiene más; sin los de quien los oculta) | Solo en canales permitidos para Plex |
| Seerr | Buscar contenido · **pedir** película/serie (también "en nombre de" otra persona) · ver peticiones recientes | Solo en canales permitidos para Seerr |
| 🧙 Economía | **Proponer** un reto a piedra, papel o tijera, una apuesta a un partido o un préstamo a quien le habla (ver [El Duende en la economía](#-el-duende-en-la-economía-f-du-03)) | En el chat de texto (no por voz) |

- Pedir contenido en Seerr está limitado a 5 peticiones diarias por persona (`seerr.daily_request_limit`)
  y solo con un resultado de una búsqueda reciente en ese canal (el modelo no puede inventar IDs).
- Los nombres ("Raúl", "el perro"...) se resuelven a personas reales con los apodos del panel (sin
  importar tildes, mayúsculas ni artículo), los perfiles y los apodos/nombres de Discord.

### Comando `/duende`

| Subcomando | Qué hace | Permiso |
|---|---|---|
| `talk texto* [personality]` | Hablarle explícitamente (opcionalmente con otra personalidad) | Todos |
| `list` | Lista las personalidades | Todos |
| `set personality*` | Fija la personalidad del canal actual | 🔒 |
| `add id* title* systeminstructions*` | Crea o edita una personalidad | 🔒 |
| `remove id*` | Borra una personalidad | 🔒 |
| `recuerda usuario* nota*` | Guarda una nota sobre alguien (máx. 15 notas por persona, 200 caracteres cada una). Respuesta privada | Sobre uno mismo; un admin, sobre cualquiera |
| `olvida usuario*` | Borra las notas guardadas con `recuerda` (no el perfil base escrito a mano) | La propia persona, o un admin para cualquiera |
| `personas` | Lo que recuerda de ti; a un admin, de todos. Respuesta privada | Todos |

### 🛡️ Guardia (`/duende` → 🛡️ Guardia, #553)

El botón **🛡️ Guardia** del panel de `/duende` hace que el bot entre al canal de voz en el que estás y **se quede
indefinidamente**, sin temporizador. Si no estás en ningún canal de voz, se abre un formulario para elegirlo (solo canales
de voz); si lo cierras sin elegir, no se conecta. Si le faltan permisos de Conectar o Hablar, lo dice en el panel.

- Usa la misma conexión que `/conectar`, así que `/sonidos`, `/tts` y el Duende por voz suenan ahí. Si había una presencia
  de `/conectar`, la guardia la sustituye.
- Mientras dura, `/conectar` no la sustituye, ni la renueva, ni la cierra: avisa de que el bot está de guardia. `/conversación`
  no empieza («estoy de guardia y ahora mismo no puedo hablar») y la guardia sigue.
- El panel enseña en qué canal está, quién la puso y desde cuándo. **🚪 Dejar la guardia** se sale en el momento. Solo
  quien la puso y los admins pueden dejarla o moverla a otro canal (pulsando 🛡️ Guardia desde el canal nuevo); el resto ve
  los botones deshabilitados, y el bot lo comprueba también al pulsar.
- Sobrevive a los reinicios: al arrancar vuelve al mismo canal. Si el canal ya no existe o faltan permisos, se descarta
  (queda en el log). Si Discord echa al bot del canal o la conexión se cierra, la guardia se da por terminada.

Migración 076: `guardia_voz`. Tests: `tests/guardia.test.js`, `tests/guardiaPanel.test.js`.

---

### 🧠 Recuerdos automáticos (#15)

El Duende lee la conversación en segundo plano y, cuando algo merece recordarse de alguien (un gusto, un dato de su vida,
una manía), lo **propone** como nota de su perfil. Nada se guarda sin aprobación:

- Mira a cada persona cada **10 mensajes** con texto de verdad (60 caracteres o más), en el canal del Duende si hay uno
  configurado. Tope de llamadas a Gemini por día y servidor.
- La propuesta llega por **DM a los admins** (`alertas.admin_ids`), con ✅ **Guardar** y ❌ **Descartar**. Lo decide un
  admin, una sola vez; si lo guarda, pasa a las notas de la persona (`/duende` → 🧠 Recuerdos).
- ✏️ **Editar** abre un formulario para corregir el texto antes de guardarlo (queda como aprobado). Una propuesta sin decidir en 7 días caduca y su DM pierde los botones.
- `DUENDE_RECUERDOS_AUTO=0` lo apaga; `DUENDE_RECUERDOS_MAX_DIA` (40 por defecto) limita las llamadas.

Migración 035: `duende_recuerdos_propuestos`. Tests: `tests/recuerdosAuto.test.js`.

## 3. IA y multimedia

| Comando | Qué hace |
|---|---|
| `/imagen descripcion* [imagen1..5] [estilo]` | Genera una imagen con IA (Gemini), o edita/combina hasta 5 imágenes adjuntas. Estilos: realista, óleo, lápiz, anime, pixel art, cyberpunk, fantasía épica, caricatura. Reintenta si la API está saturada; timeout de 2 min; cooldown de 45 s por usuario y 10 imágenes al día por persona (`IMAGE_GEN_DAILY_LIMIT`). Trae un botón 🔁 Otra versión (15 min, solo quien la pidió) y cada imagen se apunta en el historial. |
| `/imagenes` | Tus últimas 10 imágenes generadas con `/imagen` (a un admin, las del servidor), con el enlace al mensaje. Privado |
| `/resumen [mensajes]` | El Duende resume lo hablado en el canal (1 a 200 mensajes, 50 por defecto), con el tono de la personalidad, sin menciones ni enlaces. Privado y cuenta para tu cuota de respuestas |
| `/tts texto* [voz]` | El bot entra en tu canal de voz y lee el texto (Gemini TTS). Voces: Puck, Kore, Charon, Fenrir, Algenib, Sulafat, Despina. El idioma se detecta solo. Los textos se ponen en cola por servidor. |
| `/escuchar [usuario]` | El bot escucha a un usuario en el canal de voz, transcribe lo que dice (Vosk, local) y le responde **por voz** como el Duende, encadenando turnos mientras la conversación siga activa. |
| `/conversación [modo] [con] [tertulia]` | Conversación de voz **en directo** con el Duende (Gemini Live API): audio bidireccional real, sin esperar a que termines de hablar. Por defecto le puede hablar **cualquiera del canal** — por turnos (uno habla y acaba, luego otro), y antes de cada turno sabe quién es quien habla —, pero con mucha gente eso se puede volver un caos: `con @persona` hace que solo escuche a esa persona, como antes. Por defecto (`modo: mención`) solo contesta si dices "Duende" al hablar; `modo: siempre` hace que conteste a todo. Dile que cuelgue, o vuelve a usar `/conversación`, para terminarla; se corta sola tras unos minutos sin que nadie hable o a los 30 min de duración. Conoce el perfil de quien le habla y puede consultar el de cualquier otra persona (lo mismo que sabe el Duende por texto). Al terminar, publica en el canal de texto un resumen de lo hablado. Funcionalidad aparte de `/escuchar`, que sigue igual. **`tertulia: sí`** (#16) cambia el modo: escucha a **todo el canal a la vez**, sin turnos (las voces se mezclan en un solo flujo, y el Duende contesta al grupo, sin saber quién dice cada cosa). No se combina con `con`. Es opt-in y sin probar con voz real todavía. |
| `/bola8 pregunta*` | Respuesta al azar de la bola 8 mágica. |

---

## 4. Niveles y XP

### Cómo se gana XP

| Fuente | XP | Condiciones |
|---|---|---|
| Mensaje | 15 + hasta 10 según longitud (máx. a los 200 caracteres) | Máximo un mensaje cada 15 s. Las letras repetidas ("aaaaa") no cuentan para la longitud. |
| Voz | 5 XP por minuto | Sin mute ni ensordecer, y con al menos otra persona (no bot) en el canal. |
| Multiplicadores | × multiplicador global del servidor · × ⚡ happy hour (si está en marcha) · × bonus de racha | Configurables en el panel. |

- Los **canales ignorados** no dan XP (ni por texto ni por voz). Los **roles sin XP** tampoco (texto, reacciones y voz), y cada canal puede tener un **multiplicador** de ×0 a ×10 (×0 = ignorado).
- **Reacciones**: quien recibe una reacción de otra persona gana 3 XP (configurable; cooldown de 60 s por autor).
- **Tope diario**: opcional, de XP por persona y día (hora de Madrid); sin tope por defecto.
- Cada persona puede tener un **multiplicador de coste** propio (subir de nivel le cuesta más o menos).
- **⚡ Happy hour de XP** (F-EC-02): si un admin la activa (`/paneladmin` → ⚙️ Config Global → 🎉 Eventos), cada día
  de una hora a otra (hora de Madrid; de 20:00 a 22:00 por defecto, también puede pasar la medianoche) la XP se
  multiplica (×2 por defecto). Mientras dura sale en `/perfil` → 👤 Perfil, debajo de la barra de XP.

### Niveles

XP necesaria para pasar del nivel *n* al *n+1*:

```
100 × (n + 1)^1.5 × 1.6 × 10 × multiplicador_de_usuario
```

(base, exponente y multiplicadores configurables en Panel admin → Niveles → Config.)

Al subir de nivel: anuncio en el canal de anuncios configurado, y se asignan los **roles de recompensa**
de ese nivel. Al arrancar, el bot revisa y asigna los roles que falten (por si se configuraron después).
Todo se configura en Panel admin → Niveles; lo que se quita o cambia ahí se respeta (antes algunos valores
por defecto volvían solos). Un servidor nuevo empieza con los rangos pero sin roles ni canal de anuncios.

### Rangos (títulos) y roles de este servidor

| Nivel | Rango | Roles de permiso que se desbloquean |
|---|---|---|
| 2 | 🥉 BRONCE | |
| 3 | | Reaccionar |
| 5 | | Cambiarse el apodo |
| 6 | | Panel de sonidos |
| 10 | 🥈 PLATA | |
| 12 | | Mover usuarios |
| 15 | 🥇 ORO | |
| 16 | | Expulsar de voz |
| 20 | 💠 PLATINO | |
| 22 | | Cambiar apodos ajenos |
| 30 | 💎 DIAMANTE | |
| 32 | | Silenciar en voz |
| 40 | 🔷 MASTER | |
| 50 | 🔹 GRANDMASTER | |
| 60 | 🐶 PERRO | |
| 70 | 🦣 MAMUT | |

### Racha diaria

- Cada día (hora de Madrid) en que ganas XP suma un día de racha; si fallas un día, vuelve a 1, salvo que un admin haya puesto **días de gracia al mes** (0 por defecto): faltar un solo día no la rompe si queda alguno en el mes natural.
- Se guarda tu **mejor racha** y hay un ranking en 🏆 Rankings → 🔥 Rachas. Logros de 3, 7, 30 y 100 días.
- Bonus de XP: +2 % por día de racha, con un máximo de +50 %.
- A partir del segundo día, te avisa por DM de que la racha sigue.
- ⏱️ A las 17:00 avisa por DM a quien tenga racha de 2 días o más y aún no haya ganado XP ese día.
- 💔 A las 00:30 avisa una sola vez a quien acaba de perder una racha de 3 días o más.

Se ve en `/perfil` → 👤 Perfil: nivel, XP, progreso, rango, racha, puesto en el ranking, próxima recompensa y
últimas subidas de nivel (antes era `/nivel`).

---

## 5. Logros

129 logros fijos en 7 categorías que se completan solos al hacer cosas, más los [trofeos de Plex](#trofeos-de-plex)
que se van creando; la recompensa en monedas se reclama a mano. Los de Plex (fijos y trofeos) tienen
[dificultad](#dificultad-de-los-logros-de-plex).

| Categoría | Logros (objetivo → recompensa) |
|---|---|
| Social | 1 mensaje → 100 · 100 → 400 · 1.000 → 1.500 · 2.500 → 2.500 · 5.000 → 5.000 |
| XP | Voz 60 min → 300 · 300 min → 1.200 · 1.000 min → 3.500 · XP total 1.000 → 300 · 5.000 → 1.500 · 20.000 → 5.000 · Nivel 10 → 500 · 25 → 1.500 · 40 → 3.500 · 60 → 7.000 · XP en un solo día 1.000 → 600 · 3.000 → 2.000 |
| Racha | 3 días seguidos → 300 · 7 → 1.000 · 30 → 5.000 · 100 → 20.000 |
| Casino | Primera apuesta → 150 · 10.000 apostadas → 800 · 50.000 → 3.500 · 25 victorias → 1.200 · 100 → 4.500 · 5.000 netas ganadas → 2.000 · 20.000 → 7.500 · *(oculto)* 50 derrotas → 1.800 |
| Cripto | Primera compra → 150 · 10 operaciones → 900 · 50 → 4.000 · 20.000 movidas → 1.500 · 100.000 → 7.000 · 25 ventas → 2.500 · *(ocultos)* tener 500 TTCL → 1.800 · 2.000 TTCL → 9.000 |
| Tienda | Primera compra → 120 · 20 compras → 1.100 · 50 → 3.200 · 5.000 gastadas → 1.300 · 20.000 → 6.000 |
| 🍿 Plex | Horas vistas 10 → 300 · 100 → 1.500 · 500 → 5.000 · 1.000 → 10.000 · Películas 1 → 100 · 25 → 1.200 · 100 → 4.000 · Episodios 50 → 800 · 250 → 3.000 · 1.000 → 9.000 · Series distintas 10 → 1.000 · 30 → 3.500 · Maratón (horas en un día) 6 → 800 · Atracón (episodios de una serie en un día) 5 → 700 · *(ocultos)* 10 horas en un día → 2.000 · 10 episodios de una serie en un día → 1.800 · 5 noches viendo algo entre las 3 y las 6 → 900 |
| 🍿 Plex: series y anime | Series terminadas (sin anime) 1 → 400 · 5 → 1.500 · 15 → 4.000 · 🎌 Películas de anime 1 → 150 · 10 → 1.200 · 25 → 3.000 · Series de anime distintas 3 → 600 · 10 → 2.000 · Episodios de anime 100 → 1.200 · 500 → 4.000 · Series de anime terminadas 1 → 500 · 5 → 2.500 |
| 🍿 Plex: por idioma | 51 logros, ver [Logros de Plex por idioma](#logros-de-plex-por-idioma) |
| 🍿 Plex: sociales | Cine compartido (la misma película que otro vinculado el mismo día) 1 → 300 · 10 → 1.500 · Sin spoilers (verlo en las 24 h desde que llega a Plex) 1 → 200 · 25 → 1.500 · 100 → 5.000 · Primero del servidor (el primero en ver un estreno, en su primera semana en Plex) 1 → 300 · 25 → 2.500. Ver [Trofeos sociales](#trofeos-sociales-de-plex) |

Las recompensas se multiplican por `logros.reward_multiplier` y se pueden desactivar categorías enteras (la de Plex
es `plex`).

**Logros de Plex**: solo para quien tiene su cuenta de Plex vinculada (Panel admin → Plex). Cada 30 minutos se copia
el historial de Tautulli a la BD (`plex_reproducciones`) y se recalculan. Películas y episodios cuentan una vez aunque
se vuelvan a ver, y solo si Tautulli los da por vistos (su % de "visto"); las horas cuentan todo lo reproducido, sin
pausas. Los días van en hora de Madrid (una sesión cuenta entera en el día en que empezó). La primera vez se importa
el historial entero: lo que sale de golpe se anuncia en un solo mensaje por persona.

**Primera importación** (`systems/plexImportacion`): lo que se desbloquea mientras se le calcula a alguien lo antiguo
da solo una parte de las monedas al reclamarlo: el **50 %** por defecto (`plex.importacion_pct`, de 0 a 100, en Panel
admin → Plex → 🏆 Trofeos → 🪙 % de la importación; vale al reclamar, también para lo ya desbloqueado). La importación
de cada vinculado empieza con su primer cálculo y termina cuando ya no queda nada antiguo por revisar (las fichas del
servidor y los idiomas de lo que ha visto), como mucho a los 7 días. Quien se vincula más tarde tiene la suya, y
vincularse con otra cuenta de Plex empieza otra. En 🏅 Logros y en el menú de reclamar se ve "📼 de la importación"
(salvo al 100 %). Se multiplica además por `logros.reward_multiplier`.

### Trofeos de Plex

Además de los fijos, hay trofeos que salen de las **fichas** de Tautulli (`systems/plexFichas`, tabla `plex_fichas`):
cada 30 min, después de copiar el historial, se piden poco a poco (como mucho 300 llamadas; 1.200 con el botón 📼
Sincronizar) las fichas de todas las películas de las bibliotecas de películas (la lista se repasa cada 6 h) y de las
series que alguien ha visto, con los episodios de cada temporada sin los especiales (las vistas en el último mes se
vuelven a mirar cada 3 días por si hay episodios nuevos). Lo que alguien ha visto primero.

| Trofeo | Cuándo | Recompensa |
|---|---|---|
| 📺 Temporada | Terminar una temporada de una serie con 2 o más | 100 + 5 por episodio (máx. 300) |
| 📺 Serie | Terminarla entera (todas las temporadas que hay en Plex) | 250 + 10 por episodio (máx. 1.500) |
| 🎬 Saga | Ver todas las películas de una colección de Plex (de 2 a 40) | 100 por película (máx. 1.000) |
| 🎥 Director | Ver todas las suyas que hay en Plex (si hay 3 o más) | 100 por película (máx. 1.000) |
| 🎭 Género | 10 y 25 películas de un género (en español e inglés cuentan juntos: Terror = Horror) | 400 · 1.000 |
| 🌍 País | 5 y 10 películas de un país de producción (según TMDB; hace falta `TMDB_API_KEY`). El nombre: "Viajero de Japón" | 250 · 600 |
| 📼 Década | 10 películas de una década anterior a 2000 | 400 |
| 🗣️ Serie en un idioma | Terminar una serie entera en una versión: "Breaking Bad en inglés", "Frieren en japonés con subtítulos en castellano" (todos sus episodios vistos así alguna vez) | 300 + 15 por episodio (máx. 2.000) |
| ✍️ De admin | Lo que diga su condición (con fechas, solo lo visto entre ellas) | La que ponga el admin |

- **Anime** 🎌: series y películas de las bibliotecas de anime. Por defecto, las que tienen "anime" en el nombre y lo
  que tenga el género Anime; se pueden elegir en Panel admin → Plex → 🏆 Trofeos → 🎌 Bibliotecas de anime. Los trofeos
  de anime llevan 🎌 y cuentan en sus propios logros fijos (arriba), no en los de series.
- Cada trofeo se crea la primera vez que alguien lo consigue. Los de temporada, serie, saga, director y serie en un
  idioma con un nombre temático que propone **Gemini** ("Say my name" al terminar Breaking Bad; los de idioma, que
  jueguen con el idioma) y que se guarda para los siguientes; si Gemini falla, uno por defecto ("Breaking Bad:
  completada"). Los que se quedan con el de por defecto (Gemini falló o se pasó del tope de 150 nombres por
  sincronización) se vuelven a pedir en las siguientes sincronizaciones, hasta 40 cada vez. Los de género y década
  tienen nombres fijos.
- Solo los ve quien los tiene (tampoco con 👁️ Ver secretos), salvo los de admin, que se ven siempre con su progreso.
- **Rareza**: en 🏅 Logros y en el anuncio, qué parte de los vinculados a Plex lo tiene ("solo el 8 % del servidor lo
  tiene").
- "Todas las de un director" y las sagas esperan a que estén las fichas de todas las películas (si no, faltarían
  películas y saldrían antes de tiempo). Una película que sale de Plex deja de contar.
- **De admin** (Panel admin → Plex → 🏆 Trofeos → ➕ Crear trofeo): nombre, condición, recompensa, y descripción y
  dificultad opcionales (fácil, normal —por defecto— o gordo). Condiciones: `genero:Terror 20`,
  `director:Christopher Nolan` (o `director:Nolan 5`), `decada:1980 10`, `saga:Harry Potter`, `serie:Breaking Bad`,
  `pelicula:Titanic`, `peliculas 50`, `episodios 500`, `horas 200`, `series-completas 10`, `anime-peliculas 10`,
  `anime-series 5`, `anime-episodios 300`, `anime-completas 3`, y por idioma `idioma-episodios:<versión> N`,
  `idioma-peliculas:<versión> N` e `idioma-series:<versión> N` (versiones: `ingles`, `vose`, `ingles-sin-subs`,
  `castellano`, `anime-castellano`, `anime-jap-sub-es`, `anime-ingles`, `anime-jap-sub-en`, `anime-jap-sin-subs`). Se
  calcula al crearlo; 🗑️ Borrar trofeo lo quita (lo ya reclamado no se devuelve).
- **Con fechas** (eventos de temporada): cualquier condición puede llevar `desde:AAAA-MM-DD` y `hasta:AAAA-MM-DD`
  (días en hora de Madrid, incluidos) y solo cuenta lo que se empezó a ver entre esas fechas:
  `genero:Terror 5 desde:2026-10-01 hasta:2026-10-31` (Halloween), `genero:Familia 3 desde:2026-12-20 hasta:2027-01-06`
  (Navidad), `horas 10 hasta:2026-12-24`. La descripción dice las fechas. Pasado el `hasta`, solo lo ve quien lo
  consiguió.
- **🍿 Ocultar mis logros de Plex** (en tu 🏅 Logros, si tienes Plex vinculado): tus logros de Plex no se anuncian, los
  demás no los ven en tu perfil (ni tu pantalla 🍿 Plex), no sales en los rankings de logros de Plex, el Duende no los
  cuenta y no se te dan los roles de Gordos. En el ranking semanal y en los de horas sí sales (no son logros).
- No hay trofeos por país: Tautulli no da el país de las películas.

### Logros de Plex por idioma

De cada reproducción vista por alguien con Plex vinculado se pide a Tautulli (`get_stream_data`, `systems/plexIdiomas`)
el idioma del **audio** que se oyó y de los **subtítulos** que se vieron (los forzados, que solo traducen carteles, no
cuentan). Se pide poco a poco, lo más reciente primero: 1.500 por sincronización y 5.000 con el botón 📼 Sincronizar
(solo lee la base de datos de Tautulli, no molesta a Plex). Cada reproducción cuenta en las versiones que cumpla:

| Versión | Series y películas | Anime |
|---|---|---|
| 🇬🇧 Inglés | audio en inglés (con o sin subtítulos) | doblado al inglés |
| 📝 VOSE | audio en inglés con subtítulos en castellano | — |
| 🎧 Sin subtítulos | audio en inglés sin subtítulos | audio en japonés sin subtítulos |
| 🇪🇸 Castellano | audio en castellano | doblado al castellano |
| 🇯🇵 Japonés subtitulado | — | japonés con subtítulos en castellano · japonés con subtítulos en inglés |

El español latino cuenta aparte cuando la pista lo dice ("Latino", "Latinoamérica", es-419) y no suma en castellano.
Un episodio o película visto en dos idiomas cuenta en los dos; visto dos veces en el mismo, una vez.

| Versión | Episodios | Películas | Series enteras |
|---|---|---|---|
| 🇬🇧 Inglés | 10 🟢 300 · 100 🟡 1.500 · 500 🎰 6.000 | 5 🟢 300 · 25 🟡 1.500 · 100 🎰 6.000 | 1 🟡 1.000 · 5 🎰 5.000 |
| 📝 VOSE | 10 🟢 300 · 100 🟡 1.500 · 500 🎰 6.000 | 5 🟢 300 · 25 🟡 1.500 | 1 🟡 1.000 · 5 🎰 5.000 |
| 🎧 Inglés sin subtítulos | 25 🟡 1.200 · 250 🎰 6.000 | 10 🟡 1.200 | 1 🎰 4.000 |
| 🇪🇸 Castellano | 10 🟢 200 · 100 🟡 1.000 · 500 🎰 4.000 | 5 🟢 200 · 25 🟡 1.000 · 100 🎰 4.000 | 1 🟡 800 · 5 🎰 3.500 |
| 🎌 Doblado al castellano | 12 🟢 300 · 100 🟡 1.500 · 500 🎰 6.000 | 3 🟢 300 | 1 🟡 1.000 · 5 🎰 5.000 |
| 🎌 Japonés + subtítulos en castellano | 12 🟢 300 · 100 🟡 1.500 · 500 🎰 6.000 | 3 🟢 300 | 1 🟡 1.000 · 5 🎰 5.000 |
| 🎌 Doblado al inglés | 12 🟢 300 · 100 🟡 1.500 | 3 🟢 300 | 1 🟡 1.000 |
| 🎌 Japonés + subtítulos en inglés | 12 🟢 300 · 100 🟡 1.500 · 500 🎰 6.000 | 3 🟢 300 | 1 🟡 1.000 |
| 🎌 Japonés sin subtítulos | 12 🟡 1.500 · 100 🎰 6.000 | — | 1 🎰 5.000 |

Además, el trofeo de [serie en un idioma](#trofeos-de-plex) de cada serie que alguien termina entera en una versión.

**🔍 Diagnóstico** (Panel admin → Plex → 🏆 Trofeos → 🔍 Idiomas): cuántas reproducciones de los vinculados hay de cada
audio y subtítulo (y cuántas sin dato o pendientes) y qué nombres de idioma no se reconocen (pregunta a Tautulli por
las últimas 15 guardadas como "otro"), para ajustar `plexIdiomas.codigoIdioma`. Para comprobarlo todo contra el
Tautulli de verdad sin tocar la BD: `npm run plex:check` (ver [Datos, logs y despliegue](#16-datos-logs-y-despliegue)).

### Trofeos sociales de Plex

Con la copia del historial de todo el servidor y cuándo llegó cada película y cada episodio a Plex (`added_at` de las
fichas de Tautulli, que se guarda desde la migración 018):

- **Cine compartido**: ver la misma película (aunque sea otra copia, p. ej. la 4K) que otro vinculado el mismo día
  (hora de Madrid). Cuenta cada vez.
- **Sin spoilers**: episodios y películas distintos vistos en las 24 h desde que llegaron a Plex.
- **Primero del servidor**: ser el primero de todo el servidor (vinculado o no) en ver un estreno, algo en su primera
  semana en Plex.

Lo que no tiene la fecha de llegada (fichas pedidas antes de la migración 018) no cuenta para los dos últimos hasta que
se vuelve a pedir su ficha (las series vistas en el último mes, cada 3 días; las películas, cada 30).

### Roles por Gordos del Plex

En Panel admin → Plex → 🏆 Trofeos → 🎰 Roles de Gordos se elige un rol para 1, 5 y 10 logros de Plex 🎰 (Gordo del
Plex) conseguidos (`plex.rol_gordos_1`, `_5` y `_10`; menú vacío = sin rol). Se dan después de cada cálculo de los
logros de Plex (cada 30 min, con 📼 Sincronizar y al elegir el rol), como los roles de nivel: solo se dan, no se quitan.
A quien oculta sus logros de Plex no se le dan. El bot necesita "Gestionar roles" y estar por encima de esos roles.

### Dificultad de los logros de Plex

Cada logro de Plex (fijo o trofeo) es 🟢 **Fácil**, 🟡 **Normal** o 🎰 **Gordo del Plex** (los más difíciles). Se ve
en `/perfil` → 🏅 Logros (junto a la categoría y, dentro del filtro 🍿 Plex, cuántos tienes de los que hay de cada
dificultad: "🟢 Fácil: **3**/26") y en el anuncio. Los
trofeos automáticos: temporada 🟢; serie, serie en un idioma, saga y director 🟡, y 🎰 si son largos (100 episodios o
más, 8 películas de saga, 10 de un director); género 🟢 con 10 películas y 🟡 con 25; década 🟡. Los de admin, la que
elija el admin. Panel admin → Plex → 🏆 Trofeos cuenta los creados de cada dificultad.

**Anuncios**: cada logro desbloqueado (de cualquier categoría) se anuncia en el canal de logros mencionando a quien lo
consigue: "🎉 @alguien desbloqueó logros: 🏅 …". El canal se elige en Config Global → Logros; en este servidor es el
mismo que el de las subidas de nivel (`874776941000020018`, lo pone la migración 014). Sin canal, no se anuncia.

Se ven y se reclaman en `/perfil` → 🏅 Logros (antes era `/logros`): lista con páginas y progreso, 👁️ Ver secretos,
un menú para **filtrar** por categoría (🍿 Plex solo sale a quien tiene logros de Plex; con 🍿 Plex elegido, sale otro
menú con todo lo de Plex: todos, 🏆 solo los trofeos o una dificultad), un menú 🎁 para reclamar uno y 🎁 Reclamar
todo (se queda en el filtro). En el perfil de
otra persona se ven sus logros, sin reclamar. **A quien no tiene Plex vinculado no le salen los logros de Plex que no
tiene** (ni cuentan en su total de logros, en el perfil ni para el Duende); los que ya consiguió, sí. El ranking de
logros está en 🏆 Rankings.

---

## 6. Perfil

`/perfil [usuario] [seccion]` junta todo lo de una persona en pestañas, que salen siempre en la última fila (la
actual, resaltada). Sustituye a `/nivel`, `/logros` y `/banco`:

| Pestaña | Qué hay |
|---|---|
| 👤 Perfil | Nivel, XP, rango, racha, ranking, logros X/Y, dinero y próxima recompensa, con los botones 🎭 Recompensas de nivel y 🍿 Plex (si tiene Plex vinculado) |
| 💰 Economía | Efectivo, banco y total, lo ganado y perdido en el casino, la cartera cripto valorada y los objetos. En tu perfil, con 🏦 Ingresar · 💵 Sacar · 💸 Transferir · 📜 Movimientos (ver [Dinero](#7-economía-banco-tienda-e-inventario)) |
| 🎲 Juegos | Abre `/juegos` (casino, apuestas, retos, mis jugadas y stats) |
| 🏅 Logros | Ver [Logros](#5-logros) |
| 🏆 Rankings | Uno a la vez, con un menú: 📈 Nivel (con páginas) · 💰 Riqueza (efectivo + banco) · 🎰 Casino · 🏅 Logros · 💎 TTCL · 🍿 Plex · ⭐ Valoraciones · ⚽ Apostadores · 🔥 Rachas · 📅 Esta semana · 🗓️ Semanas · 🏦 Patrimonio neto |

**🍿 Plex** (desde 👤 Perfil, o `/perfil seccion:🍿 Plex`; no es una pestaña más porque una fila de botones de Discord
admite cinco): horas, películas y episodios vistos; series terminadas (y cuántas de anime); logros de Plex X/Y; 🎰 Gordos
del Plex y a cuántos está el siguiente rol; récords (horas en un día, atracón, noches); en qué idiomas lo ve ("🇬🇧 Inglés
55 % (📝 VOSE 40 %)") y **🎯 Te falta poco**: series a medias ("3 episodios para terminar *Dark* 📝 en VOSE", con la
versión si todo lo visto es en una) y los logros de Plex más avanzados ("13 películas para **Socio del videoclub**").
Con un botón a 🏅 Logros filtrado por Plex. La de quien oculta sus logros de Plex no la ven los demás.

**🍿 Rankings de Plex**: los 5 primeros en logros de Plex, 🎰 Gordos del Plex, políglota (logros de idioma) y horas
(este mes, desde el día 1 en hora de Madrid, y de siempre). Solo los vinculados; quien oculta sus logros de Plex no
sale en los de logros.

**Reseñas de series**: cuando terminas una temporada te llega el DM «Has terminado la temporada N de X», y cuando terminas la serie entera, otro «Has terminado X». Solo cuenta lo que ves desde que el admin activa los avisos, y un episodio suelto no genera ninguno. Con la misma nota de media estrella y las mismas opiniones y topes que las películas.

**📣 Feed de reseñas**: si el admin elige un canal (en `/paneladmin` → 🎬 Plex → ⭐ Reseñas; apagado por defecto), cada reseña nueva sale allí una vez: el título, la nota en estrellas, un extracto de la opinión (300 caracteres como mucho) y quién la ha escrito, mencionado sin aviso. Las que tienen spoilers salen sin texto, con «⚠️ contiene spoilers». Cambiar una reseña no la vuelve a publicar, y las de quien oculta sus reseñas (o las ocultas por moderación) no salen.

**El Duende y las reseñas**: si le preguntas por lo que opina el servidor («¿qué os pareció Dune 2?», «¿qué ha valorado Ana?», «¿cuál es la mejor valorada?»), responde con las reseñas públicas de `/plex` → ⭐ Reseñas. El texto de una reseña con spoilers no lo cuenta: te dice que la tiene.

**📊 Mi cine**: en `/plex` → ⭐ Reseñas, tus estadísticas de cine, solo para ti: cuántas reseñas has escrito (películas y series o temporadas), la media que das frente a la del servidor (solo con las reseñas públicas: las que oculta cada uno no cuentan), tu película mejor y peor valorada, el género y la década que más ves (películas y series vistas, una vez por título, con las fichas de Plex), tu racha de días seguidos viendo algo (la actual y la mejor) frente a la media de la mejor racha del servidor (sin contar a quien oculta sus logros de Plex) y el resumen de tu año hasta hoy: reseñas, horas, películas, episodios, tus series más vistas y la mejor racha del año. Con 🖼️ **Imagen del año**, la misma imagen del 🎞️ Wrapped con tus series del año en curso (solo si has visto alguna). Sin la cuenta de Plex vinculada solo salen tus reseñas.

**🎲 Ruleta de películas**: en `/plex` → ⭐ Reseñas, el «no sé qué ver»: una película al azar de las que hay en Plex y **no has visto** (según tu historial de Plex; lo empezado y no terminado sí puede salir). Con menús para filtrar por **género**, **década** y **duración máxima** (hasta 1 h 30, 2 h o 2 h 30; solo ofrecen lo que te queda sin ver con los otros filtros, y el de duración sale cuando las fichas de Plex ya saben cuánto dura cada película). La ficha enseña los géneros, el director, la biblioteca y la media de las reseñas del servidor, con 📝 **Quiero ver** (la apunta en tu lista de «quiero ver» como ya disponible en Plex), 🎬 **Otra** (nunca repite la que tenías delante) y ⭐ Puntuar desactivado: se puntúa al verla, con el DM que llega al terminarla. Hace falta tener la cuenta de Plex vinculada.

**📚 Listas** (#575): en `/plex` → ⭐ Reseñas, listas ordenadas al estilo de Letterboxd («Top 10 de Nolan», «Para ver en Halloween»). ➕ Nueva lista con título y descripción opcional; ➕ Añadir busca por título (sin tildes ni mayúsculas) **solo entre lo que hay en Plex**, películas y series, y lo pone al final. Eligiendo un título en el desplegable se puede ⬆️ subir, ⬇️ bajar, ❌ quitar o abrir su ⭐ ficha (con la media del servidor, aunque nadie la haya reseñado aún). Cada lista es 🌍 pública (sale en 🌍 Públicas con su dueño) o 🔒 privada (solo la ve quien la creó); se cambia con un botón, y ✏️ Editar y 🗑️ Borrar (con confirmación) son solo del dueño. Hasta 10 listas por persona y 50 títulos por lista; diez títulos por página.

**⭐ Valoraciones de Plex**: las mejor valoradas (con un mínimo de reseñas, el que ponga el admin en `plex.resenas_min_votos`,
3 por defecto), quién más valora, y quién da la media más alta (😇) y la más baja (😈). Solo reseñas públicas: quien las oculta
no sale.

**⚽ Ranking de apostadores**: los 10 con más beneficio en apuestas (partidos y quinielas ya resueltos, como en 📊
Stats), con su % de acierto y su mejor racha de partidos ganados seguidos (estos dos, solo de los partidos). Hacen
falta 5 apuestas resueltas para salir; a igualdad de beneficio, va antes quien acierta más.

**El perfil de otra persona se ve entero** (economía y movimientos incluidos), pero las acciones (ingresar, sacar,
transferir, reclamar) solo salen en el tuyo, y todos los botones llevan a su perfil, no al tuyo. Los botones de un
perfil solo los puede usar quien lo abrió.

---

## 7. Economía: banco, tienda e inventario

### Dinero: efectivo, banco y dinero negro

Cada uno tiene el dinero en tres sitios:

- **💵 Efectivo**: lo que se gasta. Casino, apuestas, quiniela, tienda, cripto y transferencias cobran de
  aquí, y los premios, reembolsos, ventas de cripto, recompensas de logros y objetos de monedas llegan aquí.
- **🏦 Banco**: el sitio seguro. Ahí no se gasta: hay que sacarlo antes.
- **🥷 Dinero negro** (F-EC-06b): lo robado con `/robar` (ver abajo). Se gasta igual que el efectivo en
  tienda, casino y apuestas (de hecho se gasta **antes** que el efectivo normal), pero no se puede meter
  en el banco ni cuenta como patrimonio hasta blanquearse: para eso están los 🏪 negocios (ver abajo).

Todo el mundo empieza con **1.000 monedas en efectivo** (la cuenta se crea al usarla por primera vez). El dinero
es único para todo el bot (no es por servidor).

**`/perfil` → 💰 Economía** (antes `/banco`): efectivo, banco, dinero negro y total, con los botones

| Botón | Qué hace |
|---|---|
| 🏦 Ingresar | Pasa efectivo al banco (formulario con la cantidad; máx. 1.000.000 por operación) |
| 💵 Sacar | Pasa dinero del banco al efectivo |
| 💸 Transferir | Eliges a quién (selector de personas) y la cantidad; va de tu efectivo al suyo |
| 📜 Movimientos | Tu historial con páginas y un filtro por tipo: casino, apuestas, tienda, cripto, banco, transferencias, logros, diario, trabajo, objetos, impuesto, robos, admin |
| 🛡️ Límite de pérdidas | Un tope **que te pones tú** de lo que pierdes (netas, casino y apuestas) por día o por semana, en hora de Madrid. Con el tope alcanzado, o si una apuesta lo pasaría, el casino y las apuestas no te dejan jugar hasta el periodo siguiente. Bajarlo vale al momento; **subirlo o quitarlo tarda 24 h**. Migración 061 |
| 🛡️ Seguro antirrobo | Prima de **2.000 🪙** por **24 h** (configurable en el panel): mientras está activo, los robos contra ti fallan el 60 % de las veces y, si aciertan, se llevan **la mitad**. Renovar extiende desde el vencimiento, con 1 h de cooldown y un tope de 7 días por delante. Cobra del dinero gastable (🥷 negro primero y luego 💵 efectivo). Migración 072 |
| 📈 Depósito | Guarda dinero del **banco** a 7, 30 o 90 días: paga un 1 %, 3 % o 6 % al vencer (configurable). Al vencer vuelve solo al banco con el interés y llega un DM; cancelarlo antes devuelve el principal y pierde el interés. Un depósito activo por persona. Migración 073 |

**💼 `/trabajar`**: a diferencia del diario, se puede usar cada 30 min (`TRABAJAR_COOLDOWN_SEC`) — exige estar
activo, no es gratis una vez al día. Da entre 20 y 50 monedas al azar (`TRABAJAR_BASE_MIN`/`MAX`) más 2 por cada
nivel que tengas (`TRABAJAR_BONUS_NIVEL`), y un 12 % de las veces (`TRABAJAR_PROB_FALLO`) no da nada. El Duende
escribe con Gemini, cada vez, en qué has "trabajado" (con tu personalidad y tu perfil si tienes uno) — no es una
frase fija de una lista. Queda en Movimientos como 💼 Trabajo.

**📈 Depósito a plazo** (F-EC-13, #518): desde `/perfil` → 💰 Economía → 📈 Depósito. Se guarda dinero del **banco** (no del efectivo) a 7, 30 o 90 días: paga un **1 %**, **3 %** o **6 %** según el plazo (configurable). Mientras dura no se puede gastar; al vencer vuelve **solo** al banco con el interés y llega un DM. Cancelarlo antes devuelve el principal y pierde el interés. Solo un depósito activo por persona; de 1.000 a 100.000 🪙 (configurable). Queda en Movimientos como 🏦 Banco.

**🥷 `/robar @persona`** (F-EC-06b): cooldown de **2 horas, global** (da igual el servidor — el dinero ya es
global, así que el cooldown también). La víctima necesita al menos 150 de efectivo para que merezca la pena
robarle (si no llega, no se gasta el intento ni el cooldown). 65 % de probabilidad de éxito:

- **Si sale bien**: roba del **efectivo** de la víctima (nunca del banco) entre 50 y 150 monedas al azar más 2
  por cada nivel del ladrón, sin pasar de lo que la víctima tenga. Se guarda como **dinero negro** del ladrón,
  no como efectivo normal. Sin aviso a la víctima en el momento — solo se nota mirando su saldo o sus
  Movimientos (queda como 🥷 Robos, igual que lo que gana el ladrón).
- **Si sale mal**: el ladrón paga una multa de entre 30 y 80 de su propio efectivo (o lo que tenga, si es menos).
- **🛡️ Objetos de protección** (F-EC-06c): antes de cada intento se mira el inventario de la víctima. Funcionan con
  solo tenerlos (no se "usan"); si tiene varios del mismo tipo, se usa el más fuerte. Se compran en la tienda:
  - 🔒 **Candado** (150 🪙, efecto `antirrobo:30`): le quita 30 puntos a la probabilidad de éxito (del 65 % al 35 %).
    Se gasta con ese intento, salga bien o mal.
  - 💣 **Trampa para ladrones** (100 🪙, efecto `trampa:3`): si el robo falla, la multa se multiplica por 3. Se gasta
    solo cuando salta.
  El ladrón se entera en el mensaje de `/robar` ("🔒 Ana tenía **Candado**…", "💣 ¡Ha saltado su **Trampa**…").
- **🛡️ Seguro antirrobo** (F-EC-19, #526): se compra en `/perfil` → 💰 Economía (y se ajusta en
  `/paneladmin` → Config Global → 🛡️ Economía). Mientras está activo, un robo que iba a salir bien tiene un
  **60 %** de fallar del todo (el ladrón ve un fallo normal, paga su multa y no sabe por qué) y, si no falla, se
  lleva **la mitad**. No se gasta con el robo: dura lo que dura la prima. La víctima sí lo ve en su DM.

Donde se gasta (selectores de importes del casino, confirmación de la tienda, compra de cripto) se ve el efectivo
y el banco, y si tienes algo en el banco sale **💵 Sacar del banco**: después de sacar, la pantalla se vuelve a
pintar con el efectivo nuevo, sin tener que ir al perfil.

El historial global de movimientos está en `/paneladmin` → Banco.

### Objetos, tienda e inventario

Los admins crean **objetos** en un catálogo y los ponen a la venta en la **tienda** con precio y stock, desde
`/paneladmin` → 🛒 Catálogo (ver [Administración](#12-administración)).

Tipos de objeto:
- **rol**: al comprarlo (o usarlo) te da un rol de Discord (por ID o por nombre igual al del objeto).
- **consumible**: al usarlo aplica su efecto — `monedas:N` (te da N monedas) o `mensaje:texto`.
- **coleccionable**: no se usa. Si tiene efecto `antirrobo:N` (1-100) o `trampa:N` (2-10), protege de `/robar` con
  solo tenerlo (ver [Dinero](#dinero-efectivo-banco-y-dinero-negro)).
- Cada objeto puede tener categoría, rareza, imagen y ser **único** (solo se puede comprar una vez).

| Comando | Qué hace |
|---|---|
| `/tienda` | Abre el panel de la tienda: 🛒 Catálogo (la tienda con botones de compra, paginada), 🎒 Inventario (tus objetos, con un botón **Usar** en los que hacen algo) y 🧾 Mis compras. Sin subcomandos ni opciones |

En el catálogo y el inventario hay menús de **categoría** y **rareza**, y un botón **🔍 Buscar** por nombre o tipo. Los filtros
se recuerdan para cada persona mientras el bot esté encendido. Antes eran `/tienda ver`, `/tienda inventario` y `/tienda historial`, con opciones.

Las tres pestañas (🛒 Catálogo · 🎒 Inventario · 🧾 Mis compras) salen en la última fila de todas las pantallas
de la tienda. Después de comprar: ⬅️ Volver a la tienda · 🎒 Ver en inventario · 🔮 Usar ya (en los consumibles).
Los botones de la tienda solo los puede usar quien la abrió.

Una compra es atómica: o se cobra y se entrega el objeto, o no pasa nada. Se puede limitar con cooldown y
cupo diario de compras.

**Más cosas de la tienda**
- 🎒 Inventario → **🎁 Gestionar**: 🎁 regalar un objeto a otra persona (sin monedas), 💰 vender una unidad a la tienda (`tienda.recompra_pct` % del precio base, 50 por defecto) o 🏷️ ponerla en el **mercado**. Los objetos de protección no se regalan ni se venden.
- **🏷️ Mercado**: ofertas de otros jugadores a precio fijo (7 días, máx. 10 por persona), pagadas con efectivo y sin comisión.
- **🎟️ Canjear**: códigos de monedas y/u objeto que crean los admins (usos máximos y caducidad; una vez por persona).
- **⭐ Lista de deseos**: sigue hasta 25 objetos y recibe un DM cuando vuelven a tener stock o bajan de precio.
- **Ofertas temporales** (descuento con inicio y fin) y **precio dinámico** (sube con las compras y baja cada hora hacia el base; apagado por defecto) los configura un admin en 🛒 Catálogo. El precio mostrado es siempre el cobrado.

### 🏛️ Impuestos (F-EC-06a)

Motor de impuestos configurable por servidor, sin ningún % fijo en el código. Cada servidor tiene sus propias
**reglas**, gestionadas desde `/paneladmin` → ⚙️ Config Global → 🏛️ Impuestos:

- **Sobre ingresos** (trabajo, diario, logros, retos, cripto, casino...): se aplica a todo salvo transferencias,
  movimientos de banco y acciones de admin (y, en el futuro, el dinero negro de F-EC-06b). Puede ser **general**
  (afecta a cualquier ingreso) o **de un tipo concreto** (p. ej. solo al casino); si hay una regla general y otra
  específica para el mismo tipo, siempre gana la específica, nunca se suman las dos.
- **Sobre compras**: un % extra sobre el precio al comprar en la tienda, que se cobra junto al precio (también se
  tiene en cuenta al comprobar si llega el saldo).
- Cada regla tiene un **destino**: 💰 al **bote** del servidor (se acumula, de momento sin repartir — pensado para
  mecánicas futuras) o al **sumidero** (desaparece, para controlar la inflación).
- El redondeo del impuesto siempre es hacia abajo. Es **silencioso**: no se avisa al cobrarlo, solo aparece como una
  línea aparte ("🏛️ Impuesto") en 📜 Movimientos, justo después del ingreso que lo generó.
- Si un servidor no tiene ninguna regla todavía, se le crea sola una por defecto (5 % sobre ingresos, al bote) la
  primera vez que hace falta calcular un impuesto o se abre el panel — para no empezar sin impuestos por descuido.

### 🏆 Clasificación semanal con premios (F-EC-03)

Cada **lunes a las 10:00** (hora de Madrid) se publica en el canal de la clasificación y se paga un premio al 💵 efectivo
(500 🪙 por defecto, o el premio propio de cada categoría; tipo 🏆 Premios en Movimientos, con el impuesto de ingresos del servidor) a:

- 💰 **El más rico**: más efectivo + banco en ese momento (el dinero es global, como 🏆 Rankings → Riqueza).
- 💬 **El más activo**: más XP ganada en el servidor desde la clasificación anterior (la primera, desde que se instaló).
- ⚽ **El mejor apostador**: más beneficio en las apuestas resueltas la semana anterior, de lunes a domingo (partidos por
  el día del partido, quinielas por el día en que se cerraron), solo si ganó algo.
- 📆 **El más constante**: más días distintos con XP en la semana anterior; en empate, más XP esa semana.

Se menciona a los premiados (solo a ellos les llega el aviso), y una misma persona puede llevarse más de un premio. Si
una categoría no tiene a nadie (nadie ha ganado XP o nadie ha ganado apostando), no se da. Se configura en `/paneladmin`
→ ⚙️ Config Global → 🏆 Semanal: el canal (sin canal, ni se publica ni se paga nada), el premio general y el de cada categoría y quién ganaría si fuera
ahora.

Cada publicación guarda los ganadores: **🏆 Rankings → 🗓️ Semanas** enseña las últimas 8 y **📅 Esta semana** la carrera en curso (XP desde el último corte y cuándo se publica la próxima). Tu perfil cuenta los premios semanales que has ganado. Con el botón **🔔 Aviso del domingo** de 👤 Perfil, si vas primero en alguna categoría, el domingo a las 20:00 te llega un DM con lo que cobrarías.

---

### 🎟️ Lotería semanal (#524)

`/loteria` abre el panel: el bote, cuándo es el sorteo, el precio, tus boletos y el último resultado. Cada boleto lleva **4 números distintos del 1 al 20** (🎲 al azar o ✍️ eligiéndolos) y se paga con **efectivo** (no con dinero negro), con un tope por persona y sorteo (100 🪙 y 10 boletos por defecto, en ⚙️ Config Global → 🛡️ Economía → 🎟️ Más economía). El sorteo es **cada domingo a las 21:00** (hora de Madrid): quien acierta los 4 números se lleva el bote; con varios acertantes se reparte a partes iguales y, si nadie acierta, el bote se acumula para la semana siguiente. Al sortear, si se vendió algún boleto, se suma el **10 % del bote de impuestos** (como mucho 100.000). El resultado se anuncia en el canal elegido y al ganador le llega un DM (se apaga en `/avisos`). Si el bot estaba apagado a la hora, el sorteo se celebra al arrancar y se anuncia como atrasado.

### 🔨 Casa de subastas (#519)

`/subastas` complementa el 🏷️ Mercado a precio fijo. Con **➕ Subastar** eliges un objeto de tu inventario (los de protección contra robos no se pueden), el precio de salida, el incremento mínimo entre pujas y si dura **24 o 48 horas**; el objeto queda retenido mientras tanto. Puedes tener 5 subastas abiertas. Se puja con **efectivo** (no con el banco ni con dinero negro): el importe se retiene y, si alguien te supera, se te devuelve al momento con un DM. Una puja en los **2 últimos minutos** alarga el cierre 2 minutos (como mucho 30 en total). Al cerrar, el ganador recibe el objeto y el vendedor el dinero menos un **5 % de comisión** (mínimo 1), que va al bote de impuestos del servidor; sin pujas, el objeto vuelve al vendedor. Quien subasta puede cancelar mientras nadie haya pujado. Pestañas: 🔨 Abiertas, 🙋 Mis pujas (con si vas ganando) y 📦 Mis subastas. Los DM se apagan en `/avisos` → 🔨 Subastas.

### 🤝 Préstamos entre jugadores (#520)

`/prestamo proponer usuario cantidad interes dias` ofrece un préstamo a otra persona: el **interés** (total, de 0 a 50 %) y el **plazo** (de 1 a 30 días) los pones tú, y puedes prestar como mucho el **25 % de tu banco**. Le llega un DM con ✅ Aceptar y ❌ Rechazar; la propuesta caduca a las 24 horas. Al aceptar, el dinero pasa de tu banco al suyo. `/prestamo ver` enseña los préstamos dados y recibidos: quien debe puede pagar antes (todo o una parte, del efectivo) y quien propone puede cancelar mientras no se acepte; un préstamo aceptado no se cancela. Al vencer, el bot cobra solo, primero del banco y luego del efectivo, y lo lleva al banco de quien prestó; lo que no llegue queda como **deuda** y se sigue cobrando cada 10 minutos. Avisos por DM a los dos un día antes del vencimiento, al cobrar y si pasa a deuda (se apagan en `/avisos`). Cada persona puede tener 5 préstamos dados o propuestos y deber 3 a la vez.

### 🏦 Patrimonio (F-EC-10)

Impuesto periódico sobre lo que se tiene en el banco, con su propio ciclo. Cada persona tiene su ciclo (**7 días** por
defecto) y en cada ciclo se hace lo siguiente, en este orden:

1. **Interés**: un **0,5 %** del saldo del banco, que se ingresa en el banco (tipo 🏦 Patrimonio en Movimientos).
2. **Impuesto**: un **1 %** sobre lo que pasa del umbral (**50.000**). La base es el banco más lo pagado por sus
   negocios. Se cobra del banco (tipo 🏛️ Impuesto). Lo que no se pueda pagar del banco no se cobra y no deja deuda.

El impuesto va al **bote** del servidor donde se usó la economía por última vez, o desaparece si el destino es
sumidero. Todo se configura en Panel admin → Config Global → 🏛️ Impuestos → 🏦 Patrimonio. El primer ciclo de cada
persona solo marca su fecha, sin cobrar.

En tu 💰 Economía ves el **próximo cobro** con una estimación (mismo cálculo que el ciclo real), un resumen de lo cobrado (interés, impuesto y neto, desde siempre y del último mes) y la evolución de tu dinero de los últimos 30 días. Un admin puede eximir del impuesto a unos **roles** (siguen cobrando el interés). **🙈 Ocultar mi economía** impide que los demás vean tu dinero y tus movimientos. 🏆 Rankings → **🏦 Patrimonio neto** suma efectivo, banco, negocios y cripto valorada.

**Tramos, meta y sueldos** (Panel admin → Config Global → Impuestos): 📊 una regla de ingreso puede tener **tramos** (cada parte del ingreso paga el porcentaje de su tramo); 🎯 una **meta del bote** reparte el bote entre quien ha ganado XP en la última semana al llegar a la cifra; 💼 un **sueldo diario por rol** de Discord se paga cada día a quien lo tenga (suma de roles, con impuesto).

### 🏪 Negocios y blanqueo (F-EC-06d)

Se gestionan desde **/perfil → 💰 Economía → 🏪 Negocios**. Se compran con dinero del **banco** (hay que ingresar antes).

| Negocio | Precio | Blanquea/día | Ingreso diario (efectivo) |
|---|---|---|---|
| 🧺 Lavandería | 15.000 | 7.500 | 100 |
| 📦 Oficina de correos | 38.000 | 15.000 | 250 |
| 🚗 Túnel de lavado | 75.000 | 22.500 | 500 |
| 🌮 Taco Ticklers | 190.000 | 30.000 | 800 |

- **Uno de cada tipo** por persona. Su capacidad de blanqueo se **suma** en un tope diario conjunto.
- **Depositar 🧼** mete dinero negro en los negocios. Se limpia en **24 h**, repartido a lo largo del día, y al terminar
  pasa al **efectivo** pagando impuesto como cualquier ingreso (tipo 🧼 Blanqueo en Movimientos).
- El tope se **reinicia a las 00:00 (hora de Madrid)**. Lo que no cabe en el tope de hoy se queda como dinero negro.
- Cada negocio paga su **ingreso diario** en efectivo una vez al día (tipo 🏪 Negocios; también paga impuesto). El primer
  pago llega el día siguiente a comprarlo.
- **Mejorar ⬆️** un negocio (hasta el nivel 3, con el banco): nivel 2 cuesta 1× el precio y da ×1,5 de blanqueo e ingreso; nivel 3 cuesta 2× y da ×2.
- **Vender** un negocio devuelve el **50 % de todo lo pagado** (mejoras incluidas) al banco.
- Un cron cada 5 minutos hace el blanqueo y los ingresos diarios; no avisa por DM.


---

### 🛡️ Pase de batalla (#36)

`/pase` (solo lo ves tú) muestra tu pase de la temporada: **temporadas de 15 días** (empiezan el 1 de octubre de 2026 y
se suceden solas). Cada cosa que haces da XP de pase, con topes diarios:

| Qué | XP | Tope diario |
|---|---|---|
| Mensaje que cuenta para la XP | 2 | 120 |
| Minuto en voz | 1 | 120 |
| Partida de casino | 8 | 260 |
| Operación de cripto | 6 | 180 |
| Apuesta resuelta | 12 | 180 |
| Compra en la tienda | 8 | 80 |
| Logro completado | 20 | 120 |
| Reto ganado | 15 | 90 |

Cada día hay **3 misiones** (de un pool de 7, rotan) que dan **70 XP** al completarse ("Envía 25 mensajes", "Pasa 10 minutos
en voz", "Juega 5 partidas de casino", "Haz 2 operaciones de cripto", "Ten 1 apuesta resuelta", "Compra 1 objeto en la tienda",
"Desbloquea 1 logro"). Las tres juntas dan un **🌟 día perfecto** (+100 XP, una vez al día) y los días perfectos seguidos forman una
**🔥 racha** (+100 XP a los 3 días y +250 a los 7, una vez por racha).

Hay **20 niveles**. Subir de nivel desbloquea una recompensa en **monedas** (de 80 🪙 en el nivel 1 a 2.500 🪙 en el 20, más un
bonus final de 2.000 🪙). Se cobra con **🎁 Reclamar**, una sola vez por nivel, en efectivo. El **🏆 Top** ordena por XP y, si no estás entre los 10, enseña tu puesto y lo que te falta. **📊 Topes** muestra lo usado hoy en cada categoría y **🕰️ Historial** el resumen de las temporadas ya cerradas. El último día de la temporada, un DM avisa de los niveles sin cobrar (no se cobran solos). Un admin ajusta todo en `/paneladmin` → 🛡️ Pase: activar, topes, XP por nivel, canal de anuncios de subida de nivel y objetos que dan algunos niveles (además de las monedas).

**Decisión:** el diseño ([docs/planificacion/diseno/pase-de-batalla-s1.md](planificacion/diseno/pase-de-batalla-s1.md))
incluía roles de Discord como recompensa (expulsar, mover o silenciar en voz, renombrar a otros, subir emojis). **No se
conceden**: los permisos de moderación no los decide un juego. Las recompensas son monedas. Cada logro completado da
**20 XP** de pase (tope de 120 al día); los que salen al importar el historial de Plex no dan XP. Migraciones 036 y 063. Tests:
`tests/pasePase.test.js`, `tests/paseFase5.test.js` y `tests/cabosSueltos.test.js`.

## 8. Casino

Todo lo que es apostar monedas (casino, apuestas deportivas, quiniela y retos entre jugadores) está en
**`/juegos [seccion]`**, en cinco pestañas que salen siempre en la última fila: **🎰 Casino · ⚽ Apuestas ·
⚔️ Retos · 📋 Mis jugadas · 📊 Stats**.
Sustituye a los comandos `/blackjack`, `/ruleta`, `/tragaperras`, `/adivinar`, `/ppt`, `/apuestas`,
`/quiniela` y `/misapuestas`, que ya no existen. El botón 🎰 Casino de `/perfil` abre la pestaña Casino.

### Reglas comunes

- Se juega con el **💵 efectivo** (ver [Dinero](#7-economía-banco-tienda-e-inventario)). Apuesta mínima 10 y máxima 100.000 (configurable).
- Opcionalmente: cooldown entre jugadas y cupo diario de jugadas. Una apuesta rechazada (sin saldo, fuera
  de límites) no gasta cupo.
- **RTP** configurable por juego (blackjack, tragaperras, ruleta, adivinar y rasca y gana): escala solo el premio neto,
  nunca la probabilidad ni la apuesta devuelta en un empate.
- **🎉 Fin de semana del casino** (F-EC-02): si un admin lo activa (`/paneladmin` → ⚙️ Config Global → 🎉 Eventos), el
  sábado y el domingo (hora de Madrid) el premio neto de esos cinco juegos sube (al 150 % por defecto), encima de su
  RTP. Mientras dura, la pantalla de 🎰 Casino lo dice arriba.
- **Tope y cooldown por juego** (#460, #461): `/paneladmin` → ⚙️ Config Global → 🎰 Casino → 🎯 Tope por juego y ⏱️ Cooldown por juego. Un juego sin ajuste propio usa el general; el cupo diario cuenta todos los juegos juntos.
- **🔒 Autoexclusión** (#463): desde el resumen del casino, 1 día, 1 semana o 1 mes. Ningún juego cobra apuestas (tampoco doblar o separar) mientras dure, no se puede levantar antes (ni un admin), y al acabar el casino vuelve solo.
- **🎲 Doble o nada** (#462): tras una victoria, un botón con la ganancia como importe, a una tirada de 50 %. Perder descuenta solo esa ganancia; ganar la duplica. Se registra como una partida distinta, se usa una sola vez por victoria y no se encadena. Caduca a los 10 minutos o al empezar otra partida.
- **Partidas a medias**: no puedes tener dos partidas del mismo juego a la vez. Una partida sin tocar
  15 minutos se da por perdida. Si el bot se reinicia a mitad de partida, **se devuelve lo apostado**.
- Todo queda registrado en el historial y cuenta para los logros de casino.
- **Cómo se juega**: en 🎰 Casino eliges juego y después importe (50 · 100 · 500 · 1.000 · 5.000; los que no te
  alcanzan salen desactivados). Todas las partidas acaban con la misma fila: 🔄 Repetir (misma apuesta; en
  ppt vuelve a pedir la jugada) · 🎲 Otra apuesta · 📊 Stats de ese juego · ◀ Casino. Si no se puede cobrar la
  apuesta (saldo, límite diario, espera), el aviso sale aparte y el panel sigue ahí.
- La pantalla de Casino tiene también 🏆 Ranking, 📜 Historial (últimas 15 partidas) y 📊 Mis stats del casino.
- Los botones de un panel solo los puede usar quien lo abrió. Las reglas de canales y roles (ACL) se ponen
  sobre `juegos`.

### Juegos

| Juego | Cómo es | Pagos |
|---|---|---|
| 🃏 Blackjack | Contra el crupier con 4 barajas: pedir, plantarse, doblar y separar (split, con regla especial para ases). El crupier pide hasta 17 y comprueba su blackjack al repartir. Con un **as visible** se ofrece un **🛡️ seguro** (la mitad de la apuesta, paga 2 a 1 si el crupier tiene blackjack); en la primera decisión se puede **🏳️ rendir** (recuperas la mitad) y **💡 Consejo** te dice, solo a ti, qué haría la estrategia básica. | Victoria ×2 · Blackjack natural ×2,5 · Empate: recuperas la apuesta |
| 🎰 Tragaperras | 3 carretes con jackpot progresivo (el 10 % de cada apuesta va al bote; empieza en 10.000). Con el desplegable **🔁 Auto x10 / x25 / x50** se hacen varias tiradas seguidas con la misma apuesta (cada una respeta saldo, cupo, cooldown y topes), con ⏹️ Parar, hasta que salga el jackpot, y un resumen al final. | 3 iguales: 🍒×2 🍋×3 🍊×4 🍇×5 🔔×8 💎×15 ⭐×25 · 3×7️⃣ = JACKPOT · 2 iguales: valor/3 (mín. ×1) |
| 🎡 Ruleta | Ruleta europea (0–36): primero el tipo de apuesta (color, par/impar, mitad, docena o número exacto, con un formulario) y después el importe. | Rojo/negro, par/impar, bajo/alto ×2 · Docenas ×3 · **Calle** (3 números de una fila del tapete: 1-2-3, 4-5-6…) ×12 · Número exacto ×36 |
| 🔮 Adivinar | "Ride the bus": 4 rondas — color, mayor/menor, dentro/fuera, palo. Te puedes retirar desde la ronda 3. | Acumulado ×2 → ×3 → ×4 → **×20** si aciertas las 4 |
| ✂️ Piedra, papel o tijera | Contra el Duende: importe y después jugada. | Victoria ×2 · Empate: recuperas la apuesta. **Al mejor de 3** (#457): misma apuesta, fija, cobrada una vez; gana quien llega a 2 manos o lleva más tras la tercera (empate: recuperas); una serie sin responder 15 min se cierra y se devuelve |
| 🎟️ Rasca y gana (#521) | Cartón de 3×3 al instante: ganas si salen tres símbolos iguales. | Tres iguales: 🍒×2 🍋×3 🍊×5 🍇×8 🔔×15 💎×30 ⭐×50 |

---

## 9. Apuestas deportivas y quinielas

Usa cuotas y resultados reales de **The Odds API** para LaLiga, Premier League, Champions League, Mundial, Eurocopa, Copa del Rey y Europa League. Todo está en
`/juegos`:

| Pestaña | Qué hace |
|---|---|
| ⚽ Apuestas | Próximos partidos de la competición elegida (botones para cambiar entre las siete competiciones; con las de torneo, solo salen cuando hay partidos en la API) con sus cuotas (1/X/2) y escudos. Eliges partido y resultado y apuestas (10–1.000), o 🎯 **Marcador exacto**: pones los goles de cada equipo y, si aciertas, cobras **×8** lo apostado (premio fijo: la API no da cuota para el marcador; se puede apostar a varios marcadores distintos del mismo partido). No se puede repetir la misma apuesta, y un partido que ya ha empezado no admite apuestas aunque se pulse un botón de un mensaje antiguo (salvo con las apuestas en directo, ver abajo). Las cuotas se reutilizan 30 min para no gastar créditos de la API. Botón 🧾 Quiniela de esa competición. |
| 🧾 Quiniela (desde Apuestas o Mis jugadas) | Quiniela de la jornada: pronósticos 1/X/2 para 10 partidos (**🎯 Rellenar favoritos** pone la cuota más baja en los que no has elegido; lo que eliges se guarda como **📝 borrador** y sobrevive a un reinicio hasta que apuestas o cancelas). Un admin la crea con un botón; se bloquea 15 min antes del primer partido (también se rechaza un formulario enviado después). Si ya has apostado, enseña tus pronósticos con ✅/❌ en cada partido jugado y los aciertos que llevas. |
| 🏅 Liga (desde Apuestas) | Liga de pronósticos de la temporada: cada acierto de una quiniela cerrada suma 1 punto. Clasificación con los puntos y las quinielas jugadas, tu posición y los campeones anteriores. La temporada va de julio a junio. |
| 📋 Mis jugadas | Partidos y quinielas juntos: ⏳ En juego (arriba, tu cartera: 💰 lo que tienes en juego, 🏆 lo máximo que puedes cobrar de tus partidos —en cada partido, el mejor resultado posible: solo uno de 1/X/2 puede salir, pero un 🎯 marcador exacto se cobra a la vez que el resultado que implica (el 2-1 y «gana el local»); la quiniela no suma porque depende del bote— y 📅 el beneficio de lo resuelto este mes, en hora de Madrid; debajo, cada apuesta, con tus pronósticos de la quiniela, los aciertos que llevas y tus últimas partidas del casino) y 📋 Resueltas (ganada con su premio, perdida, reembolsada o devuelta). Después de apostar salen 📋 Mis jugadas y ⚽ Más partidos / 🧾 Ver la quiniela. En ⏳ En juego, el menú ↩️ **Cancelar una apuesta** devuelve al efectivo lo apostado a un partido que aún no ha empezado, menos un **10 % de comisión** (mínimo 1 🪙), después de confirmarlo; la apuesta desaparece (en Movimientos quedan la apuesta y la devolución). El mismo menú cancela una **🧩 combinada** (devuelta entera, sin comisión, mientras ningún partido haya empezado: queda como «cancelada») y quita una **🔔 alerta de cuota**. El menú **💸 Retirar ya** (cash-out, #529) ofrece cobrar ahora una apuesta o una combinada que siguen en juego (también en directo): vale lo apostado × la cuota con la que apostaste ÷ la cuota de ahora, menos un **8 %** de margen (tope de 1.000.000). Solo sale si hay cuota actual reciente (no con el mercado suspendido, ni el marcador exacto, ni una combinada con alguna pata fallada; en una combinada, las patas ya acertadas cuentan con cuota 1). El valor se bloquea **60 segundos**; si la cuota se mueve más de un 10 % antes de confirmar, se recalcula. Se cobra una sola vez al efectivo, la apuesta deja de liquidarse y en 📋 Resueltas sale «💸 Retirada (+N)». Cada apuesta pendiente enseña «apostado a 1.8 · ahora 2 ↑» (↓ / =) mientras el partido no ha empezado. **🔁 Repetir última** propone tu última apuesta a un partido (misma elección e importe) en el que elijas, a la cuota de ahora, y solo cobra al confirmar; **📤 CSV** te envía en privado todas tus apuestas (partidos, combinadas y quinielas). |
| ⚔️ Retos | Apuestas contra otras personas (ver [Retos entre jugadores](#retos-entre-jugadores)). |
| 📊 Stats | Casino (resumen y por juego), apuestas a partidos y quinielas, retos, y el beneficio total. Una quiniela devuelta cuenta como recuperada. |

Los admins pueden forzar la liquidación y crear la quiniela desde `/paneladmin` → ⚽ Apuestas.

**🔴 Apuestas en directo (#12)**: con `ODDS_DIRECTO=1`, un partido **admite apuestas durante sus 2 primeras horas**,
con las cuotas que se refrescan cada 10 minutos mientras se juega (solo las competiciones con un partido en juego). Sin esa
variable, todo se cierra al empezar, como antes. Cada refresco gasta créditos de la Odds API (3 por competición), por eso
va apagado: en el plan gratuito se agota en un fin de semana. Las **combinadas** también aceptan partidos en juego; los
**retos** y las **quinielas** siguen cerrándose al empezar. Un partido en juego no tiene marcador en vivo en el bot: la
apuesta se hace solo con la cuota. Tests: `tests/apuestasDirecto.test.js`.

**🧩 Combinadas (#1)**: un boleto con **de 2 a 5 partidos** (uno por partido). La cuota total es el producto de las
cuotas de cada pata y el premio es lo apostado × esa cuota. Se gana **solo si aciertas todas**: en cuanto falla una, el
boleto se pierde. Si un partido se caduca sin resultado, la combinada se devuelve entera.
- Se arma en privado: ⚽ Apuestas → **🧩 Combinada** abre tu boleto (solo lo ves tú). En cada partido, el menú
  **🧩 Sumar a mi combinada** añade una pata con la elección que quieras (1X2, goles o hándicap). Un partido solo puede
  tener una pata: si sumas otra elección del mismo partido, sustituye a la anterior.
- Antes de pagar se comprueba cada partido y cada cuota: si ha empezado o la cuota ha cambiado, hay que volver a sumarlo.
- El importe cuenta para el tope diario y cobra como las demás apuestas (efectivo y dinero negro).
- Sale en 📋 Mis jugadas (⏳ En juego y 📋 Resueltas, con cada partido y su elección) y cuenta en 📊 Stats. No se puede
  cancelar una vez apostada, ni se incluye el marcador exacto (su premio es fijo).
- **🎛️ Sistema** (#534): con 3, 4 o 5 partidos en el boleto, en vez de la combinada se juegan todas sus combinaciones
  parciales: **2 de 3** (3 combinaciones), **3 de 4** (4) o **3 de 5** (10). El importe es **por combinación**; antes de
  cobrar se enseñan el coste total (importe × combinaciones, como mucho 50.000), lo que cobrarías si aciertas todos y
  cuántos partidos puedes fallar. Al liquidar, cada combinación acertada paga su importe × sus cuotas (redondeada una a una)
  y las falladas no. Un partido sin resultado cuenta con cuota 1,00 y, si se quedan todos sin resultado, se devuelve lo
  apostado. En 📋 Mis jugadas sale con cada partido (✅ ❌ ➖ ⏳) y cada combinación con lo que cobró. Una jugada es de un
  tipo: un sistema no se mezcla con una combinada.

**🔁 Exchange entre jugadores (#533)**: en la ficha de cada partido, **🔁 Exchange** abre (en privado) el libro del partido: las
órdenes de otros jugadores por resultado (1X2) y cuota, con lo disponible y la cuota de la casa como referencia.
- **➕ A favor**: publicas tu cuota (de 1,1 a 50) y cuánto apuestas; se te retiene y esperas a que alguien la cruce.
- **🤝 En contra**: cruzas las órdenes del libro hasta la cuota que aceptes; se cruza primero la cuota más baja y, a igual
  cuota, la más antigua, también en parte. Arriesgas lo cubierto × (cuota − 1), que se te retiene. No puedes cruzar las tuyas.
- **Comisión**: quien gana paga el **2 %** de su ganancia neta; la confirmación lo enseña antes de publicar o cruzar.
- **📋 Mis órdenes**: las tuyas con lo cruzado y su estado, y lo que has cruzado en contra; desde ahí se cancela lo que nadie
  ha cruzado (se devuelve). Al empezar el partido, lo no cruzado se devuelve solo.
- Se liquida con el resultado del partido, una sola vez; si se queda sin resultado, cada uno recupera lo suyo.
- **Límites**: como mucho el 10 % de tu capital por orden (o riesgo), el 25 % en un mismo partido y 100.000 retenidos en total.
  En esta versión solo hay órdenes a favor; ir en contra es siempre cruzando el libro.

**Mercados de goles y de hándicap (#9 y #10)**: debajo de los botones 1/X/2 de cada partido, cuando la API da la línea:
- **⬆️ Más de 2,5 goles** / **⬇️ Menos de 2,5 goles**: gana si el total de goles es 3 o más (o 2 o menos).
- **🏠 Local −1,5**: gana el local si gana por 2 o más. **✈️ Visitante +1,5**: gana si pierde por 1 o menos (o no pierde).

Las líneas son medias, así que no hay empates de línea y nunca se devuelve nada por "push". Cada apuesta guarda la línea
con la que se apostó: si la API la cambia después, la apuesta se liquida con la suya. Solo se ofrece la línea de 2,5 y
la de ±1,5; si la casa no da esas líneas, el botón no sale. Coste: 3 créditos por actualización de cuotas de cada
competición (ver `ODDS_MERCADOS`).

**Ambos marcan y doble oportunidad (#532)**: en su propia fila, cuando la API da sus cuotas para ese partido:
- **⚽ Ambos marcan: Sí / No**: ganan si marcan los dos equipos (o si alguno se queda a cero).
- **🔀 Doble oportunidad: 1X, 12 o X2**: 1X gana con victoria local o empate; 12, con cualquier victoria (pierde con
  empate); X2, con empate o victoria visitante. La ficha lleva una leyenda corta con lo que significa cada una.

Se pueden sumar a una combinada (una pata por partido, como siempre) y se ven en 🧾 Mis jugadas con su nombre completo. Se
cierran al empezar el partido, también con las apuestas en directo: sus cuotas no se refrescan con el balón en juego. La
API solo los da partido a partido y cada uno cuesta un crédito por partido, así que están **apagados** salvo que se active
`ODDS_MERCADOS_EXTRA` (ver la tabla de variables).

**🧾 Mis jugadas** calcula lo máximo que puedes cobrar de un partido mirando todos los marcadores posibles, así que
cuenta a la vez el 1X2, el marcador exacto, los goles y el hándicap cuando salen juntos.

**🏅 Liga de pronósticos (F-AP-12, #8)**: cada acierto de una quiniela cerrada suma **1 punto** (las quinielas
caducadas no cuentan). La temporada va de **1 de julio a 30 de junio** (hora de Madrid). El 1 de julio, desde las 10:00,
se publica la clasificación final de la temporada anterior en el canal de la clasificación y se paga al efectivo a los
tres primeros: **5.000**, **2.500** y **1.000** 🪙 (`liga.premio_1`, `liga.premio_2` y `liga.premio_3` en los ajustes del
servidor; se editan en `/paneladmin` → ⚽ Apuestas → 🏆 Premios de liga). En empate manda quien menos quinielas ha jugado, y después el
id. Cada temporada se liquida una sola vez por servidor. Sin canal de clasificación no se publica ni se paga nada.

**🚦 Límites por jugador** (`/paneladmin` → ⚽ Apuestas → 🚦 Límites; 0 = sin límite, como viene por defecto):
**tope diario**, lo que cada uno puede apostar en un día (hora de Madrid) sumando partidos y quiniela, y **máximo por
partido**, lo que cada uno puede tener apostado a un mismo partido sumando todas sus apuestas a él. Si una apuesta se
pasa, no se cobra y el mensaje dice cuánto se puede apostar todavía. Lo apostado cuenta para el tope aunque luego se
devuelva.

**Liquidación** ⏱️ cada hora (minuto 15): cierra los partidos terminados (empezados hace más de 2 h),
paga las apuestas ganadoras (apuesta × cuota) y liquida las quinielas completas: el 90 % del bote se reparte
entre quienes más aciertos tengan, siempre que lleguen a la mitad de los partidos (5 de 10); si nadie llega,
se devuelve lo apostado. Los resultados de la quiniela se guardan partido a partido según se conocen.
Los ganadores reciben un DM.

**Resultados en el canal**: si un admin elige un canal en `/paneladmin` → ⚽ Apuestas → 📢 Canal de resultados,
después de cada liquidación se publica ahí un resumen de lo cerrado: "⚽ **Elche 1-0 Oviedo** · 3 de 4 acertaron ·
1.240 🪙 en premios · 🏆 quiénes", y en las quinielas cuántos ganadores, con cuántos aciertos y cuánto se lleva cada
uno (o que se devuelve lo apostado). Los nombres salen como mención, pero sin avisar a nadie.

**⭐ Partido destacado del día**: cada día desde las 10:00 (hora de Madrid), en el mismo canal de resultados, el partido
grande de la jornada con sus cuotas y los botones 🏠/🤝/🚩 y 🎯 Marcador exacto para apostar (abren el formulario de
siempre; si el partido ya empezó, no deja). Es, de los de hoy que aún no han empezado, el que más apuestas tiene; a igualdad, el más igualado (las
cuotas de local y visitante más parecidas). Sale de los partidos ya guardados, así que **no gasta créditos** de la Odds
API; un día sin partidos no se publica nada. Se activa o quita en `/paneladmin` → ⚽ Apuestas → ⭐ (viene activado, pero
sin canal de resultados no se publica).

**🧾 Recordatorio de la quiniela**: unas horas antes de que se cierre (3 por defecto; `/paneladmin` → ⚽ Apuestas → ⏰ Recordatorio, 0 = no avisar), un DM a quien suele jugar quinielas y aún no ha enviado la de la jornada, con su borrador si lo tiene. Una vez por quiniela. **📊 Resumen semanal**: los lunes desde las 10:00, un DM con lo apostado, cobrado y el beneficio de la semana anterior y tu puesto en la 🏅 liga. **🔔 Alertas de cuota**: el botón 🔔 de la ficha de un partido te avisa por DM cuando una elección llega a la cuota que pongas (hasta 10 activas). Los tres se pueden apagar en `/avisos`.

**⏰ Recordatorio**: 30 minutos antes de un partido al que has apostado te llega un DM con el partido, a qué apostaste
y cuánto ganarías (uno solo con todos tus partidos de esa media hora, y una sola vez por apuesta). Se activa o
desactiva y se cambian los minutos en `/paneladmin` → ⚽ Apuestas → ⏰ Recordatorio.

**⭐ Equipos favoritos (`/favoritos`)**: sigue hasta **10 equipos** con `seguir equipo:…`, déjalos con `dejar equipo:…`
y consulta los que tienes y sus próximos partidos con `lista`. Es global para tu cuenta, como las apuestas. El catálogo
sale de los partidos que ya ha sincronizado el bot (las siete competiciones de ⚽ Apuestas), así que no gasta créditos
de la Odds API. Cuando aparezca un partido de un equipo que sigues, te llega **un DM** (o varios si hay muchos partidos)
con la competición, la hora (`<t:…:f>` y `<t:…:R>`) y las cuotas 1X2; se avisa una sola vez por partido y el aviso se
apaga en `/avisos` (⭐ Equipos favoritos). El aviso sale al **actualizarse las cuotas** (al abrir ⚽ Apuestas, la quiniela o retos, y con las
apuestas en directo); no hay una consulta periódica propia para no gastar créditos de la Odds API.

La API solo da resultados de los **últimos 3 días**: un partido (o una quiniela con partidos) que empezó hace
más y sigue sin resultado se marca como caducado y **se devuelve lo apostado** (con aviso por DM).

### Retos entre jugadores

`/juegos` → ⚔️ Retos: apostar contra otras personas. Todos funcionan igual: a cada uno se le cobra del 💵 efectivo
al entrar, el dinero queda guardado hasta que el reto se resuelve y entonces se paga o se devuelve. **El bot no se
queda nada**: el ganador se lleva lo de todos. Entre 10 y 100.000 por persona. Tipo `retos` en Movimientos.

| Tipo | Cómo es |
|---|---|
| ⚽ Partido | Eliges un partido de los próximos (cualquier competición), qué crees que pasará (gana el local, empate o gana el visitante), a quién retas y cuánto. El rival va con lo contrario («empate o gana el Sevilla»). Se resuelve solo en la liquidación de cada hora, con el resultado real; si el partido se queda sin resultado, se devuelve. Si acaba el plazo o empieza el partido sin que lo acepten, se devuelve. |
| 🎲 Duelo | Contra una persona, a 🪨 **piedra, papel o tijera** (cada uno elige en secreto con los botones del reto; si empatáis, otra ronda, y tras 5 empates seguidos se devuelve), 🎲 **dados** (dos dados cada uno al aceptar, gana la suma más alta; si empatan, se vuelve a tirar) o 🃏 **blackjack** (cada uno juega su mano en privado con 🃏 Mi mano, sin ver la del otro; gana el que más se acerque a 21 sin pasarse, un blackjack natural gana a un 21 normal y un empate devuelve lo apostado). |
| 🗳️ Porra | Una pregunta con 2 a 5 opciones («¿Llegará Jorge tarde?» · Sí / No) y una entrada fija. Crearla no cuesta nada: entra quien quiera eligiendo una opción (una vez dentro no se cambia). Quien la creó o un admin puede 🔒 cerrar las apuestas; un **admin** dice cuál ha ganado (⚖️ Resolver, con un menú privado) y el bote se reparte a partes iguales entre los que la eligieron. Si nadie la eligió, se devuelve todo. 🚫 Anular la devuelve: un admin, o quien la creó si no ha entrado nadie más. |

- Al lanzar un reto, el panel vuelve a ⚔️ Retos y el reto sale en un **mensaje público** nuevo que menciona al rival.
  Los botones de ese mensaje solo hacen algo a quien le toca: aceptar o rechazar, el rival; cancelar, quien retó
  (mientras nadie lo haya aceptado); jugar, los dos del duelo; resolver la porra, un admin. El mensaje se actualiza
  solo cuando el reto cambia o se resuelve.
- Un reto de partido o duelo hay que **aceptarlo en 24 h** (los de partido, como mucho hasta que empieza): si no,
  se devuelve. Cada uno puede tener como mucho 5 retos sin aceptar a la vez.
- Un duelo sin tocar **15 minutos**: en el blackjack, quien no había terminado se planta y se resuelve; en piedra,
  papel o tijera se devuelve. Una porra que nadie resuelve en **30 días** se devuelve.
- Lo que se resuelve o devuelve solo (liquidación, plazos) se avisa por DM, y los retos a partidos resueltos salen
  también en el canal de resultados.
- La pestaña ⚔️ Retos enseña los retos que te han lanzado, los que esperan respuesta, lo que está en juego y los
  últimos cerrados (con lo que ganaste o perdiste), cada uno con un enlace a su mensaje.
- **Más formas de jugar** (fase 4): un duelo puede ser **🌐 abierto** (lo acepta el primero que pulse, #438), **al mejor de 3** (#436: el bote se paga una vez al final; un empate no suma y tres seguidos devuelven el reto), se puede **🏳️ rendir** (#446: el rival cobra todo) y en el blackjack **✖️2 doblar** con las dos primeras cartas (#444). El rival puede hacer una **💬 contraoferta** de cantidad (#442, una por reto; quien retó la acepta o cancela y se ajusta lo cobrado). **🚫 Bloquear** a quien te reta (#450, en un sentido; devuelve los pendientes entre los dos; se quita en ⚔️ Retos → 🚫 Bloqueos) y **🆚 Cara a cara** (#437: victorias de cada uno, beneficio neto y los últimos 5). Las porras aceptan un cierre automático («2h», «1d», #448).
- **DM de retos** (#452, #439): cuando el otro ya ha jugado en un duelo, un DM con el enlace (uno por persona y partida); y un recordatorio al rival a mitad del plazo de un reto pendiente. Respetan `/avisos`.
- **🔁 Revancha** (#318): un duelo resuelto entre dos personas ofrece el botón una sola vez; lo pulsa cualquiera de los dos y propone al otro el mismo duelo (juego, cantidad y serie). Hace falta efectivo en los dos; no hay revancha contra el Duende ni de un reto a un partido.
- Las partidas se guardan en la BD (no en memoria): un reinicio del bot no pierde ningún reto.
- También se puede retar al Duende, desde su chat: ver el apartado siguiente.

### 🧙 El Duende en la economía (F-DU-03)

Hablándole al Duende se le puede pedir que se juegue monedas contigo o que te preste: "te reto a piedra, papel o
tijera por 200", "te apuesto 300 a que gana el Betis", "préstame 500". **Él solo lo propone**: debajo de su respuesta
sale un mensaje con **✅ Acepto / ❌ No**, y el dinero solo se mueve si pulsas ✅. Solo lo puede aceptar a quien se lo
propuso, y la propuesta caduca a los 10 minutos. Por voz no se ofrece (no hay botones).

- **Su dinero es como la banca del casino**: no tiene saldo. Si gana, lo apostado desaparece; si pierde, su parte del
  premio se crea. Lo que ganas paga el impuesto del servidor como cualquier reto. De **10 a 1.000 🪙**.
- **🪨 Piedra, papel o tijera**: al aceptar, la propuesta se convierte en el mensaje del reto y eliges con sus botones;
  el Duende ya tiene su jugada (al azar) y se resuelve en el momento. Si empatáis, él vuelve a elegir. Sin jugar en 15
  minutos, se devuelve.
- **⚽ Apuesta a un partido**: uno de los próximos de ⚽ Apuestas, buscado por los equipos (con su nombre oficial:
  "Barcelona", no "Barça"). Tú vas con un resultado y el Duende con lo contrario; se resuelve en la liquidación de cada
  hora, como los retos a partidos, y sale en el canal de resultados.
- **🧙 Préstamo**: de 10 a 1.000 🪙, uno a la vez. Se devuelve con un **10 %** más en **7 días**, o antes con 🧙 Devolver
  en `/perfil` → 💰 Economía (ahí se ve lo que debes y cuándo vence). Al vencer **se cobra solo**: del efectivo y, si no
  llega, del banco, con aviso por DM. Lo que falte queda como **deuda**: se cobra de lo que vayas ganando (premios,
  logros, retos...) y, hasta saldarla, ni otro préstamo ni apuestas con el Duende. En Movimientos, tipo 🧙 Préstamos.

---

## 10. Criptomonedas

`/cripto` es un solo panel con pestañas (📈 Mercado, 🛒 Comprar, 💸 Vender, 💼 Cartera y 🧾 Historial):

- **📈 Mercado**: precio, gráfica con rango (24 h / 7 días / 30 días / todo), el pool, el último evento del mercado
  y quién tiene más TTCL.
- **🛒 Comprar**: importes fijos (1.000 a 100.000 monedas) o una cantidad escrita. Antes de pagar sale una **vista previa**:
  lo que pagas (con la comisión), lo que recibes, el precio medio y cómo se mueve el precio. Solo al confirmar se compra.
  Si no te llega el efectivo, el botón de confirmar sale apagado y se ofrece 💵 Sacar del banco.
- **💸 Vender**: el 25, 50 o 100 % de tu TTCL, o **✏️ Otra cantidad**: las monedas netas que quieres recibir (se redondea hacia abajo; si tu posición no llega, no se vende nada). También con vista previa (lo que recibes, la comisión y el precio) antes de
  confirmar.
- **🔔 Órdenes** (📈 Mercado / 💸 Vender / 🛒 Comprar → «Mis órdenes», hasta 5 de cada tipo, revisadas cada minuto): **alertas de precio** (DM una sola vez cuando el TTCL llega al precio), **🛡️ stop-loss** (vende toda la posición una vez al bajar hasta el umbral, con la comisión de una venta normal) y **🔁 compra recurrente** (importe cada N horas, mínimo 1; sin efectivo salta el ciclo y avisa por DM). Se cancelan sin cooldown.
- **💼 Cartera**: cuánto tienes, su valor, tu coste medio, la ganancia sin vender y un donut.
- **🧾 Historial**: tus compras y ventas, de la más reciente a la más antigua, con páginas.

- **$TTCL** (moneda del servidor): se opera contra un **pool de liquidez** global (1.000.000 monedas y 10.000 TTCL al
  arrancar, precio inicial 100). El precio es `monedas del pool / TTCL del pool`, y cada compra o venta se cobra contra
  el pool manteniendo el producto constante, así que comprar sube el precio y vender lo baja. La comisión (1 %) se queda
  en el pool. ⏱️ El precio se registra cada 10 minutos para el gráfico.
- Las **ventas** de TTCL no pagan impuesto de ingresos. Sí se descuenta la deuda con el Duende, si la hay.
- **Eventos de mercado**: cada día hay uno de **±5 %** del precio de TTCL, a una hora aleatoria (hora de Madrid, elegida al empezar el día). Mueve la reserva de TTCL del pool, así que el precio sube o baja sin que nadie opere. Se avisa por DM a quien tenga TTCL.
- **Estadísticas y ranking** en 📈 Mercado (#447, #445): resumen del periodo elegido (precio al inicio y al final, máximo, mínimo, variación y volumen de compras y ventas) y 🏆 quién gana más (ganancia realizada + sin vender, con el precio de 💼 Cartera).
- **Tope de impacto** (#454): `cripto.max_impacto_pct`; una compra o venta que moviera el precio más que eso se rechaza (la vista previa lo dice). **Anuncio de eventos** (#451): canal opcional donde se publica cada evento diario. Ambos, en ⚙️ Config Global → 📈 Cripto → 📊 TTCL + fees.
- Configurable: comisiones de compra/venta, cooldowns y mínimos/máximos por operación. Las reservas del pool no se
  configuran (van fijas en el código).

El estado del registro de precios de TTCL está en `/paneladmin` → 🩺 Sistema → 💎 TTCL.

---

## 11. Plex y Seerr

### Plex (vía Tautulli)

- ⏱️ **Novedades**: cada 30 minutos publica en el canal de novedades lo que se haya añadido a Plex.
- El Duende puede responder preguntas sobre Plex (ver [herramientas](#herramientas-datos-reales)) en los
  canales permitidos.
- Un admin **vincula** cada cuenta de Plex con su usuario de Discord (Panel admin → Plex), necesario para las
  consultas sobre personas concretas y para los [logros de Plex](#5-logros).
- ⏱️ **Historial para los logros**: cada 30 minutos se copia a la BD lo nuevo del historial de Tautulli (la primera vez,
  entero). Panel admin → Plex enseña cuántas reproducciones hay guardadas y cuándo se sincronizó, y tiene el botón
  📼 Sincronizar historial para hacerlo en el momento (también pide más fichas de golpe).
- ⏱️ **📣 Ranking semanal**: cada lunes a las 10:00 (hora de Madrid) se publica en el canal del ranking (por defecto
  `874776941000020018`, el de los niveles) quién vio más Plex la semana anterior, de lunes a domingo: "🦭 El mayor
  gordito come foquitos de la semana es @…" con sus horas, y la lista de los 5 primeros (🥇🥈🥉4️⃣5️⃣) con horas,
  episodios y películas. Cuenta el tiempo visto sin pausas de quien tiene Plex vinculado; antes de calcular copia lo
  último del historial. Solo le llega el aviso al primero (los demás salen con su nombre). Si el bot está caído a las
  10:00, sale en cuanto vuelva ese lunes; nunca dos veces la misma semana. Si nadie vio nada: "Esta semana nadie ha
  visto nada en Plex". Panel admin → Plex → 📣 Ranking semanal: cómo queda el de la semana pasada (en privado), cambiar
  el canal y 📣 Publicar ahora (cuenta como el de esa semana).
- ⏱️ **Fichas e idiomas para los trofeos**: después del historial, las fichas de películas y series que faltan y el
  idioma (audio y subtítulos) de lo visto. Panel admin → Plex → 🏆 Trofeos enseña cuántas hay y cuántas faltan, qué
  bibliotecas son anime, cuántos trofeos hay de cada tipo y dificultad, y los de admin (crear, borrar). Ver
  [Trofeos de Plex](#trofeos-de-plex) y [por idioma](#logros-de-plex-por-idioma).
- ⏱️ **Logros de Plex en cada sincronización**: la [primera importación](#5-logros) de cada vinculado da menos monedas,
  los nombres de Gemini que faltaban se vuelven a pedir y se dan los [roles de Gordos](#roles-por-gordos-del-plex).

### Seerr

- Pedir películas/series hablando con el Duende ("pídeme Dune", "pide X para Raúl").
- El usuario de Seerr se identifica por el Discord ID de su perfil en Seerr o, si no, por su vínculo de Plex.
- Límite diario de peticiones por persona (`seerr.daily_request_limit`, 5 por defecto).
- Solo funciona en los canales permitidos, que se eligen en Panel admin → Seerr.
- ⏱️ **"Ya está en Plex"**: cada 30 minutos (después de las novedades) se mira qué peticiones de Seerr han pasado a
  estar disponibles y se avisa a quien la pidió, mencionándole en el canal de novedades de Plex ("🍿 @Raúl, lo que
  pediste ya está en Plex: **Dune**"), o por DM si no hay canal de novedades. En una serie que llega por partes, se
  avisa cuando hay los primeros episodios. Cada petición se avisa una vez; la primera comprobación solo fija la base
  (no avisa de lo que ya estaba). Se activa o desactiva en Panel admin → Seerr.

---

### 🎯 Recomendaciones personales (#22)

En `/plex` → 🎯 **Para ti** (solo lo ves tú) propone qué ver a partir de lo que has visto en Plex en los últimos 6 meses: se toman tus
3 títulos más vistos (las series, agrupadas por serie), se buscan en Seerr y se piden sus recomendaciones. Salen primero
las que recomiendan más de tus títulos, y se descarta lo que ya has visto y lo que ya está en Plex. Cada sugerencia tiene
un **📥** para pedirla en Seerr a tu nombre (tu perfil de Seerr debe estar vinculado a tu Discord). Requiere la cuenta
de Plex vinculada. Tests: `tests/recomendaciones.test.js`. Migración: ninguna.

### 🎞️ Plex Wrapped mensual (#23)

El día 1 de cada mes, desde las 10:00 (hora de Madrid), **cada persona con la cuenta de Plex vinculada recibe por DM su
propio resumen** del mes anterior: sus horas vistas, sus películas y episodios, y sus series más vistas, con una gráfica
de sus series. Es privado: no se publica nada en ningún canal y nadie ve los datos de otra persona. Quien no ha visto nada
ese mes no recibe nada. Cada persona recibe cada mes una sola vez (tabla `plex_wrapped_enviados`, migración 038). Se puede
ver el del mes pasado cuando se quiera con 🎞️ Wrapped en `/plex` (solo lo ves tú). **El 1 de enero** también llega por DM el **resumen del año** (tabla `plex_wrapped_anual_enviados`, migración 068), y el botón «Ver el del año pasado» lo enseña cuando se quiera. Tests: `tests/plexWrapped.test.js`.

## 12. Administración

### `/mensaje` 🔒

`/mensaje usuario` abre un formulario con un campo de varias líneas (hasta 1.500 caracteres) y lo manda por **DM** de
parte del bot, tal cual lo escribiste (sin cabecera). Si la persona tiene los DM cerrados, lo dice.
Cada envío se audita (quién, a quién y cuántos caracteres; el texto no se guarda). Solo admins.

Con `cuando:DD/MM/AAAA HH:MM` (hora de Madrid) el DM queda **programado**: sale a esa hora con un margen de 5 minutos, o al arrancar el bot (con un aviso de que llega tarde) si estaba apagado. Se ven y se cancelan en `/paneladmin` → 🩺 Sistema → ✉️ Mensajes (hasta 20 pendientes, máximo un año). El texto se borra al enviarse o cancelarse y nunca está en la auditoría.

### `/paneladmin` 🔒

Panel con botones, todo en mensajes efímeros. Cada cambio queda en la **auditoría**.

| Sección | Qué se puede hacer |
|---|---|
| 🏦 Banco | Modificar saldo (efectivo, banco o dinero negro) · resetear usuario (como nuevo: 1.000 en efectivo, sin dinero negro) · borrar historial · historial global · buscar usuario |
| ⚽ Apuestas | Apuestas pendientes y quinielas abiertas por competición · 💸 **Liquidar ahora** (normalmente lo hace el cron de cada hora) · 🧾 **Crear quiniela** de cualquiera de las siete competiciones · 📢 **Canal de resultados** (o 🔕 no publicar) · ⏰ **Recordatorio** antes del partido (activo y minutos) · 🚦 **Límites** por jugador: tope diario y máximo por partido (ver [Apuestas](#9-apuestas-deportivas-y-quinielas)) · ⭐ **Partido destacado** del día (publicarlo o no) |
| 🛒 Catálogo | Los objetos, con si están a la venta, precio y stock · ➕ **Crear** (nombre, descripción, tipo —rol, consumible o coleccionable—, efecto `monedas:N`/`mensaje:texto` o rol, imagen) · ✏️ **Editar** un campo (nombre, descripcion, tipo, efecto, rol, imagen, categoria, rareza, unico) · 🗑️ **Eliminar** (si nadie lo tiene y no está a la venta) · 🏷️ **A la venta** (precio y stock; si ya lo estaba, los cambia) · ❌ **Quitar de la venta** |
| 🩺 Sistema | Diagnóstico: uptime, memoria, comandos, servidores, BD, errores y avisos desde el arranque, último error, consumo de Gemini, créditos que quedan de la Odds API, alertas y ajustes de Duende/cripto/logros/tienda · **nivel de log** en caliente (menú) · 💎 **TTCL**: precio, circulación, registro de precios y holders · 🔔 **Alertas** (ver abajo; con la vista previa del 📊 resumen semanal) · 🤖 **Probar Gemini**: prueba el modelo del Duende (si existe y si usa las herramientas) · 🔊 **Probar voz**: genera una frase con Gemini TTS, dice con qué modelo y la adjunta para oírla (o explica qué le pasó a cada modelo) · 💾 **Copias**: las copias de la BD con su tamaño, si existe la de hoy y **Hacer copia ahora** (pide confirmación si va a sustituir la de hoy) · 🕒 **Tareas**: la última ejecución de cada tarea programada (cuándo, cuánto tardó, OK o error, «sin ejecutar»), lanzarla a mano con confirmación y 📄 exportar el registro · ✉️ **Mensajes**: los `/mensaje` programados, con cancelación · muestra si el 🛠️ mantenimiento está activo |
| 📈 Niveles / XP | **Config**: XP por mensaje/voz, cooldown, fórmula de niveles, multiplicador global, canal de anuncios, racha (bonus, tope y días de gracia), tope diario de XP, XP por reacción, vista previa de la curva · **Recompensas**: roles por nivel y qué desbloquea cada uno (📝 Descripción, se muestra en `/perfil`) · **Usuarios**: ver perfil, ± XP, multiplicador de coste individual, reset de XP (con confirmación) · **Ignorados**: canales sin XP, roles sin XP y multiplicador de XP por canal |
| ⚙️ Config Global | **🤖 Duende**: modelo (al cambiarlo se prueba en el momento y dice si funciona), temperatura, historial, canal permitido, **🕐 Tono** (más borde de madrugada y canales formales), **🏷️ Apodos** y **🧠 Perfiles** (ficha completa de cada persona —Discord ID, username, nombre, apodos, descripción, notas y cuánto de todo eso recibe el Duende— y edición de todos los campos en un formulario; borrar notas o el perfil entero) · **📈 Cripto**: comisiones, límites y cooldowns · **🎰 Casino**: apuesta mín./máx., cooldown, cupo diario, RTP por juego · **🛒 Tienda**: activar, cooldown, cupo diario, canal de avisos · **🛠️ Modo mantenimiento**: con él activo, solo los admins usan comandos, botones y formularios; los demás ven el mensaje que configures (✏️), y las tareas programadas siguen · **🏆 Semanal**: canal y premio de la [clasificación semanal](#-clasificación-semanal-con-premios-f-ec-03), y quién ganaría si fuera ahora · **🎉 Eventos**: ⚡ happy hour de XP (activa, multiplicador y horas) y 🎰 fin de semana del casino (activo y % de los premios), y si están en marcha · **🏛️ Impuestos**: reglas de impuesto sobre ingresos o compras (ver [Economía](#7-economía-banco-tienda-e-inventario)) — añadir, activar/desactivar y quitar reglas, y ver el bote acumulado · **🔐 Comandos**: activar/desactivar comandos y restringirlos por canal o rol · **🏅 Logros**: activar, canal de avisos, multiplicador de recompensas, categorías desactivadas · **🛡️ Economía**: el seguro antirrobo (prima, duración, cooldown y tope) y el depósito a plazo (mínimo, máximo e interés de 7, 30 y 90 días) · **🎭 Autoroles**: los roles del menú de `/autoroles`, con etiqueta, emoji y grupo exclusivo · **🎁 Sorteos**: crear sorteos de dinero u objeto con ganadores, duración y requisitos (rol o nivel), y cancelarlos · **📣 Comunidad**: canales de cumpleaños, bienvenida y buzón de sugerencias, revisión de sugerencias y **🎫 Tickets** (canal de tickets, rol de staff, canal de transcripciones, categorías, los abiertos y 📤 publicar el panel público, avisando de los permisos que le faltan al bot) · **⏳ Roles temporales** (#543): dar un rol a alguien de 1 a 365 días (7 por defecto) con aviso por DM opcional; el bot lo quita solo al vencer (también lo que venció con el bot apagado, al arrancar). La lista enseña persona, rol, quién lo dio y cuándo vence; desde ella se renueva (desde el vencimiento, o desde ahora si ya venció, con tope de 365 días) o se quita antes de tiempo con confirmación. Varios roles temporales por persona, cada uno por su lado. No deja dar roles de integraciones, @everyone ni roles por encima del bot; si se borra el rol, sus asignaciones se cancelan. Todo queda en 🧾 Auditoría (familia ⏳ Roles temporales) · **📊 Estadísticas** (#538): una gráfica día a día de 💬 mensajes, ⭐ XP, 💰 economía neta, ⚽ dinero apostado o 🎬 horas de Plex, de los últimos 7, 30 o 90 días, con el total, la media diaria, el mejor día y la variación respecto al periodo anterior. Se cambia de métrica en el desplegable y de rango con los botones. Cada combinación se guarda 5 minutos (🔄 Actualizar se habilita al caducar). Mensajes y XP se cuentan desde la versión que trae esta pantalla (la XP arranca con las dos últimas semanas); economía y apuestas son del historial de todo el bot. Solo admins; se apunta en la auditoría quién lo abre · **⚠️ Moderación** (#542): rol de staff y canal de log, caducidad de los strikes (90 días por defecto) y umbrales (3 aviso serio, 5 silenciar 24 h, 7 expulsión y 10 ban, de menor a mayor), quién tiene strikes vigentes, y 🔎 consultar el historial de alguien (🟠 vigente, ⚪ caducado, ✖️ retirado) para retirar uno o limpiarlos todos con confirmación. El staff avisa con `/avisar usuario motivo` (quien tenga Moderar miembros, los admins o el rol de staff): al avisado le llega un DM con el motivo, se apunta en el canal de log y, al cruzar un umbral, los admins de las alertas reciben un DM con la medida sugerida. **El bot nunca sanciona solo** y los avisos no se publican en el canal general. Todo queda en 🧾 Auditoría (familia ⚠️ Moderación) · **📅 Calendario** (#540): canal fijo de los recordatorios y cuántos minutos antes avisan (60 por defecto; 0 los apaga), qué competiciones de apuestas salen (LaLiga por defecto) y los eventos propios (➕ título y fecha en hora de Madrid; se borran desde el desplegable). Todo el mundo lo ve con `/calendario`: por semanas o por meses, con ◀ ▶, agrupado por día y con la hora en la zona de cada uno; junta sesiones de cine (con enlace al mensaje), cumpleaños, partidos, el cierre de las quinielas abiertas y los eventos propios, y el desplegable enseña el detalle de uno. Cada recordatorio sale una sola vez, también tras un reinicio; los cumpleaños no se recuerdan (ya tienen felicitación) · **🗳️ Elecciones**: abrir unas elecciones a la presidencia, cerrar ya la fase en curso, cancelarlas o destituir al presidente (con confirmación), volver a publicar el panel y los ajustes: canal, rol y categoría del presidente, duración de cada fase, antigüedad para participar, canales y minutos de silencio máximos, espera por persona, reelección y reinicio automático (ver [Elecciones](#️-elecciones-a-la-presidencia)). Todo queda en 🧾 Auditoría (familia 🗳️ Elecciones) · **🎁 Diario**: activar, base, monedas por día de racha y tope (con ejemplos de cuánto da cada racha) |
| 🧾 Auditoría | Registro paginado de acciones de administración (las últimas 100), con un menú para ver solo una familia (banco, ajustes, alertas, logs, mensajes, Duende...). Los cambios de ajustes guardan el valor anterior y el nuevo de lo que cambió; abrir el historial global, buscar un usuario o abrir una ficha de perfil del Duende deja una fila `consulta.*` (quién y el ID, no el contenido) |
| 🎬 Plex | Vincular cuentas de Plex, canales permitidos para las herramientas de Plex, canal de novedades, 📼 Sincronizar historial (y fichas e idiomas), 📣 Ranking semanal (vista previa, canal y publicar ahora). 🏆 Trofeos: fichas e idiomas pendientes, 🎌 bibliotecas de anime, trofeos creados por tipo y dificultad, crear y borrar trofeos de admin (también con fechas), 🪙 % de la importación (y cuántos vinculados están importando), 🎰 Roles de Gordos, 🔍 Idiomas (diagnóstico) y ⭐ Reseñas (activar avisos, tope diario, mínimo de votos, canal del 📣 feed de reseñas, contadores y borrar una reseña, también oculta, con confirmación) |
| 🍿 Seerr | Canales permitidos para pedir contenido · 🔔 avisar (o no) cuando llega lo pedido |

### 🔔 Alertas por DM

El bot avisa por mensaje privado a los admins cuando pasa algo que hay que mirar:

- **Un error nuevo** (lo que acaba en `logs/error-log.txt`). El mismo error, aunque cambien los números, como mucho
  una vez cada 6 horas. Si falla la copia de seguridad, sale como "💾 La copia de seguridad ha fallado".
- **Odds API con menos de 50 créditos** este mes (`ODDS_CREDITOS_AVISO`), una vez al día.
- **Gemini sin cuota** (el Duende y `/imagen` fallan hasta que se renueve).
- **El modelo de Gemini no funciona** al arrancar: no existe, o responde pero no usa las herramientas (con él, el
  Duende se inventaría los datos). En esos dos casos el bot **se cambia solo** al primero que funcione de los de
  respaldo (el de `GEMINI_MODEL` y los de `GEMINI_FALLBACK_MODELS`), lo pone como modelo del servidor en Config
  Global → 🤖 Duende, lo apunta en la auditoría y el aviso dice a cuál ("🤖 He cambiado el modelo de Gemini"). Si el
  fallo es de paso (cuota, timeout) o ninguno de respaldo funciona, solo avisa.

Como mucho 10 alertas a la hora. Las de antes de conectar a Discord (errores al arrancar) se mandan al conectar.

**Categorías y canal de respaldo**: en 🔔 Alertas, cuatro botones activan o apagan por separado ❌ errores, 🤖 Gemini, 📈 Odds API y 💾 copias; una categoría apagada no manda nada ni cuenta para el máximo por hora (el resumen semanal no es una categoría). Con un **canal de respaldo** (✏️ Configurar), si nadie recibe el DM porque tiene los mensajes privados cerrados, la alerta se publica ahí (sin menciones); si el canal falla, solo queda en el log.

**📊 Resumen semanal** (F-AD-02): cada lunes a las 09:00 (hora de Madrid), a quien recibe las alertas, un DM con lo de
los últimos 7 días: ❌ los errores (agrupados: el mismo error con otros números cuenta como uno, los 5 más repetidos),
⌨️ los 5 comandos más usados, 🤖 el uso de Gemini (llamadas, errores y tokens desde el resumen anterior; si el bot se
reinició, desde el arranque, y lo dice) y ⚽ los créditos que quedan de la Odds API. Errores y comandos salen de los
logs (`logs/error-log*.txt` y `logs/app-log*.txt`); si han rotado tanto que falta el principio de la semana, lo avisa.
Con las alertas desactivadas no se manda. En 🔔 Alertas, **📊 Resumen semanal** enseña cómo va, solo a quien lo pulsa.
En `/paneladmin` → 🩺 Sistema → 🔔 Alertas: activarlas o no, a quién (IDs de Discord; sin nadie puesto, al dueño del
servidor), las últimas enviadas y 📨 Probar.

### Control de comandos (ACL)

Para cada comando se puede: desactivarlo en el servidor, limitarlo a ciertos canales y/o exigir ciertos roles.
Se aplica también a los botones (por ejemplo, los botones de la tienda respetan el ACL de `/tienda`).

Antes eran comandos sueltos: `/pagarapuestas`, `/objeto` y `/tienda añadir | editar | eliminar | config`,
`/diagnostico`, `/ttcl-diagnostico` y `/panel` (un panel antiguo del banco, ya repetido aquí). Las personalidades del
Duende se gestionan desde `/duende` → 🎭 Personalidad (solo admins).

---

## 13. Tareas automáticas

| Cuándo | Qué |
|---|---|
| Al arrancar | Registra los slash commands · crea índices de BD · **devuelve lo apostado en partidas interrumpidas** · asigna roles de nivel que falten · prueba el modelo de Gemini (si no existe o no usa herramientas, se cambia solo por uno de respaldo que funcione; alerta en los dos casos) · manda las alertas del arranque |
| Cada minuto | XP de voz |
| Cada 5 minutos | Liquida como perdidas las partidas de casino abandonadas (>15 min) · ⏰ recordatorio por DM de los partidos que empiezan pronto · ⚔️ retos colgados: devuelve los que nadie aceptó a tiempo y las porras de más de 30 días, y cierra los duelos abandonados (>15 min) · 🧙 cobra los préstamos del Duende vencidos (efectivo y luego banco) y avisa por DM |
| Cada 10 minutos | Registra el precio de $TTCL |
| Cada 30 minutos | Novedades de Plex · "ya está en Plex" a quien lo pidió en Seerr · copia del historial de Plex, fichas de Tautulli, idioma de lo visto y logros y trofeos de Plex (con los nombres de Gemini que falten y los roles de Gordos) |
| Cada minuto | 📊 Cierra las encuestas vencidas · 🔔 DM de los cooldowns que acaban |
| Cada hora (min. 15) | Liquidación de apuestas deportivas, retos a partidos y quinielas + DM a ganadores + resumen en el canal de resultados |
| Cada hora, desde las 09:00 (Madrid) | 🎂 Felicitaciones de cumpleaños (una por persona y año) |
| Cada hora | Limpia historiales de conversación del Duende sin actividad en 24 h |
| Cada 90 minutos | Cambia el estado ("Viendo ...") del bot, de la lista `ESTADOS` |
| 04:30 (Madrid) | Copia de seguridad de la BD en `data/backups/` (se guardan 7). Cada copia se comprueba con `PRAGMA integrity_check`: si falla se descarta, no rota las anteriores y avisa por DM. Al arrancar pasadas las 04:30 sin la copia de hoy, se hace entonces |
| Cada 5 min | Mensajes programados con `/mensaje cuando:…` que ya han llegado a su hora |
| 17:00 (Madrid) | Aviso de "racha en peligro" por DM |
| Cada día, 10:00 (Madrid) | ⭐ Partido destacado del día en el canal de resultados de las apuestas (comprobado cada hora de 10 a 20 y al arrancar; una vez al día) |
| Lunes, 09:00 (Madrid) | 📊 Resumen semanal por DM a quien recibe las alertas (comprobado cada hora de los lunes y al arrancar; una vez por semana) |
| Lunes, 10:00 (Madrid) | 📣 Ranking semanal de Plex en su canal, 🏆 clasificación semanal con premios y 📊 resumen semanal de apuestas por DM (comprobados cada hora de los lunes y al arrancar; una vez por semana) |

---

## 14. Utilidades y comandos varios

| Comando | Qué hace |
|---|---|
| `/ayuda` | Guía de los comandos principales, con botones por sección; en cada sección, botones que abren sus paneles (`/perfil`, `/tienda`, `/juegos`, `/cripto`, `/duende`, `/plex`, `/sonidos` y, a admins, `/paneladmin`) respetando los permisos de cada comando |
| `/ping` | Latencia del bot y de la API de Discord |
| `/javier` | Contesta "Eres un mierdas." |
| `/avisos` | 🔔 Un interruptor por cada tipo de DM del bot (racha, partidos, equipos favoritos, apuestas cobradas, Wrapped, Plex, Seerr, robos, eventos de TTCL, préstamos, retos, cooldowns, sugerencias, programas de las elecciones, premios de la lotería, subastas, préstamos entre jugadores) y 🌙 no molestar. Global (todos los servidores). Las alertas de administración no se pueden apagar |
| `/autoroles` | 🎭 El menú de roles del servidor: pulsa para ponerte o quitarte uno (✅ los que tienes). En un grupo exclusivo (por ejemplo, colores) solo se puede tener uno. Respeta la jerarquía del bot y el modo mantenimiento; la lista la configura un admin (ver [Administración](#12-administración)) |
| `/favoritos` | ⭐ `seguir equipo:…`, `dejar equipo:…` y `lista`: hasta 10 equipos por persona, con sus próximos partidos y cuotas. Aviso por DM cuando aparece un partido suyo, apagable en `/avisos` (ver [Apuestas](#9-apuestas-deportivas-y-quinielas)) |
| `/encuesta` | 📊 Pregunta con 2 a 5 opciones, un botón por opción, recuento en vivo y un voto por persona (se puede cambiar). Dura 24 h por defecto (1 a 168) o hasta que la cierra quien la creó. Solo se ve el recuento |
| `/elecciones` | 🗳️ `estado`, `inscribirse`, `retirarse` y `programa` de las [elecciones a la presidencia](#️-elecciones-a-la-presidencia) |
| `/presidente` | 👑 Los poderes de quien gana las elecciones durante su mandato; `estado` lo ve cualquiera (ver [elecciones](#️-elecciones-a-la-presidencia)) |
| `/sorteos` | 🎁 Los sorteos activos del servidor, con su premio y cuándo terminan. Se entra o se sale con el botón del mensaje del sorteo; los crea un admin (ver [Administración](#12-administración)) |
| `/recordar` | ⏰ `nuevo cuando texto` («18:30», «mañana 09:00», «en 45 min»; hoy o mañana, hasta 24 h; texto de hasta 200 caracteres) y `lista` (con botón de borrar). Hasta 10 pendientes; el DM llega a su hora y, con los DMs cerrados, se pierde |
| `/cumpleaños` | 🎂 `fecha dia mes`, `ver` (los próximos 5) y `borrar`. El bot felicita en el canal elegido desde las 09:00 (Madrid); el 29 de febrero se celebra el 28 los años no bisiestos |
| `/sugerencia` | 💡 Formulario → idea en el canal del buzón con su número y 👍/👎 (un voto, cambiable); hasta 3 al día por persona. Un admin la acepta o descarta (con motivo) en ⚙️ Config Global → 📣 Comunidad y el autor lo recibe por DM |
| `/presentacion` | 💬 Una frase sobre ti (hasta 150 caracteres) que sale en 👤 Perfil de `/perfil` cuando otra persona lo abre. Se abre con formulario; enviarlo vacío la borra |
| Bienvenida | 👋 Al entrar alguien (no bots), mensaje en el canal elegido con `{usuario}` y `{miembros}` + cómo empezar (`/perfil`, `/ayuda`). Canal y texto en 📣 Comunidad |
| 🎫 Tickets | Soporte privado con el staff (#537). En el canal de tickets, el panel público tiene **🎫 Abrir ticket**: un formulario con la categoría (las que ponga el admin; «General» por defecto) y qué necesitas (5 a 1.000 caracteres). Se crea un **hilo privado** (no se puede invitar a nadie más) con el autor dentro y una mención al rol de staff. **🔒 Cerrar ticket** lo pueden usar el autor y el staff (rol de staff, admins o quien gestiona hilos), siempre con confirmación; si lo cierra el autor, se avisa al staff. Al cerrarlo, la conversación va en un **.txt** (hasta 1 MB; si no cabe, se recorta y lo dice) al canal de transcripciones con quién lo abrió, quién lo cerró y cuándo, y el hilo queda bloqueado y archivado. **Uno abierto por persona** y **una hora de espera** tras cerrarlo. Si alguien borra el hilo a mano, el ticket se da por perdido y no bloquea. Se configura en ⚙️ Config Global → 📣 Comunidad → 🎫 Tickets |
| 🔔 Avisarme | Las respuestas de cooldown de `/trabajar` y `/robar` traen el botón: un DM cuando acaba (una sola vez; sobrevive a un reinicio) |

### 🗳️ Elecciones a la presidencia

Unas elecciones para elegir al presidente del servidor. Las abre un admin en `/paneladmin` → ⚙️ Config Global → 🗳️ Elecciones y
el bot publica un panel en el canal elegido que se va actualizando solo. Fases (la duración de cada una se configura; entre
paréntesis, la de por defecto):

1. **📝 Inscripción** (3 días): 🙋 Presentarme en el panel o `/elecciones inscribirse`. Hasta 25 candidatos; uno se puede retirar
   (🚪) y volver. Con menos de 2, se cancela. Con 4 o menos no hay primarias: todos pasan directamente.
2. **🗳️ Primarias** (30 días): 🗳️ Votar → eliges candidato y después si tu voto es **🔒 secreto** (solo suma en el recuento) o
   **📢 público** (sale en el panel «quién ha votado a quién»). Un voto por persona, que se puede cambiar hasta el cierre. Mientras
   se vota solo se ve el total; al cerrar se publica la clasificación. Pasan los **4 más votados** (a igualdad de votos, quien
   se inscribió antes).
3. **📜 Programas** (3 días): cada finalista elige el **nombre de su partido político** (2 a 40 caracteres, sin repetir el de
   otro candidato) y su **eslogan** (3 a 100), y escribe su programa electoral (✍️ Mi programa o `/elecciones programa`: título y
   hasta 4.000 caracteres). El partido y el eslogan salen en el panel, en la papeleta, en el programa que llega por DM y en los
   resultados. Quien no lo entrega sigue en la papeleta «sin programa».
4. **🏛️ Generales** (7 días): al empezar, el programa de los finalistas **llega por DM** a todos los que pueden votar (se apaga
   en `/avisos` → 🗳️ Elecciones) y se puede leer con 📜 Programas. Se vota igual que en las primarias. El más votado es el
   presidente; si nadie vota, se cancelan.
5. **👑 Mandato** (30 días): el ganador recibe el rol de presidente (si hay uno configurado) y puede usar `/presidente`:
   - `mover usuario canal`, `desconectar usuario`, `silenciar usuario minutos` y `ensordecer usuario minutos` en voz
     (30 minutos como mucho; el bot lo quita solo al acabar, también tras un reinicio) y `liberar usuario` para quitarlo antes.
   - `crear-canal nombre [tipo]` en la categoría del presidente (3 como mucho) y `borrar-canal` de los suyos.
   - **Nunca** sobre admins, staff (rol de moderación o Moderar miembros), bots, alguien con un rol más alto que el suyo ni sobre
     sí mismo, y con 5 minutos de espera antes de volver a actuar sobre la misma persona. Cada acción va a 🧾 Auditoría y al canal
     de log de ⚠️ Moderación.
   - Al acabar el mandato pierde el rol, sus canales se borran y sus castigos se deshacen. Si está activado, se abren otras
     elecciones solas.

Votar y presentarse exige no ser un bot y llevar 7 días en el servidor. Los admins pueden cerrar ya la fase en curso, cancelar
las elecciones, **destituir** al presidente (con confirmación) y volver a publicar el panel; también eligen el canal, el rol y
la categoría del presidente, las duraciones, los límites y si hay reelección. El rol solo lo da y lo quita el bot: **no le
pongas los permisos de Mover, Silenciar o Ensordecer miembros**, porque esos permisos de Discord no respetan la jerarquía y
podría usarlos contra los admins.

---

### 🎬 Sesión de cine (#24)

En `/plex` → 🎬 **Sesión de cine** (formulario con qué veis y la hora HH:MM) convoca a un grupo a ver algo a esa hora (hora de Madrid; si ya ha pasado, es la de
mañana). El mensaje lista quién se ha apuntado, con la hora en la de cada uno:

- **🙋 Me apunto** / **🚪 Me salgo**. Quien convoca se apunta solo.
- **🛑 Cancelar sesión**: solo quien la convocó o un admin.
- **Recordatorio**: 10 minutos antes, el bot avisa en el canal y menciona a quien se haya apuntado. Una sola vez por
  sesión. Lo revisa el cron cada 5 minutos.
- **🗳️ Votación**: si al convocar escribes varias películas separadas por `|` (hasta 5), salen botones para votarlas (se puede votar más de una y volver a pulsar quita el voto). El recordatorio nombra la más votada (en empate, la propuesta antes) y cierra la votación.
- **🎯 Sugerir**: propone hasta 5 películas que ninguno de los apuntados con Plex vinculado ha visto, con 📥 para pedirlas.
- **🔁 Cada semana**: con «¿Repetir cada semana?» el bot crea la sesión siguiente solo, a la misma hora de Madrid (cada una con sus apuntados y votos). «Cancelar y parar la serie» cancela la siguiente y no crea más.

Migración 033: `cine_sesiones` y `cine_asistentes`. Tests: `tests/sesionCine.test.js`.

### 🍿 /plex: todo lo de Plex en un panel

`/plex` agrupa lo de Plex en botones, como `/tienda` y `/duende`: 🎬 **Sesión de cine**, 🎯 **Para ti** (recomendaciones),
🎞️ **Wrapped** (el resumen de tu último mes, solo para ti) y 🏅 **Mi Plex** (tus horas, trofeos y logros de Plex, la misma
pestaña de `/perfil`), 📡 **Ahora** (qué se está viendo, en privado), 🗓️ **Estrenos** (los de la semana según Seerr, con 📥), 🏆 **Campeones** (las últimas 10 semanas del ranking semanal y las victorias de cada uno) y 📥 **Mis pedidos** (tus peticiones pendientes de Seerr, que puedes cancelar). Si un admin rechaza una petición tuya, te avisa el bot. El panel te dice si tu cuenta de Plex está vinculada. Es privado: solo lo ves tú (las sesiones de
cine sí se publican en el canal, para que la gente se apunte).

### 🔊 /sonidos y 🔌 /conectar

`/sonidos` muestra un **panel público** con un botón por sonido, como el de Discord. Quien pulsa uno hace que el bot lo
toque en un canal de voz: si el bot **ya está en un canal** (con `/conectar`), suena ahí; si no, **entra al canal de quien
pulsa, lo toca y se sale**. Solo puede sonar **uno a la vez** por servidor, y no entra si hay una conversación de voz con el
Duende en marcha. Si ya suena otro, el pulsado **espera en una cola** (hasta 5, con su puesto). De 20 en 20 por página (15 si hay categorías), hasta 40 sonidos por servidor. El sonido suena **entero** (hasta 4 minutos
como tope, por si el reproductor se atasca); la confirmación «Sonando…» sale cuando empieza, no cuando acaba.

Debajo de los sonidos: **🔍 Buscar** (por nombre), un menú de **categorías**, **🎲 Aleatorio** y **🏆 Más usados**. Entre dos
sonidos de la misma persona pasan 10 segundos (los admins, no). Un sonido con 🔒 solo lo pueden usar los roles que le puso el
admin. En el **horario de silencio** (o con los sonidos apagados) no suena nada y se avisa.

`/conectar` hace que el bot **entre a un canal de voz y se quede 30 minutos**, para que `/sonidos` suene sin entrar y salir
cada vez. Elige el canal con la opción *canal* (por defecto, el tuyo). Sin canal, si ya está conectado, se sale. Si Discord
lo echa, se olvida. No se sale a mitad de un sonido ni de una conversación con el Duende: espera a que acaben. No
sustituye a la conexión mientras suena algo. Una sola conexión por servidor. Si el bot está **de guardia** (`/duende` →
🛡️ Guardia), `/conectar` no hace nada y lo avisa: ni la sustituye, ni la renueva, ni la cierra.

**Los sonidos los sube y los borra un admin en `/paneladmin` → 🔊 Sonidos**: un formulario con el nombre (hasta 32 caracteres,
único en el servidor) y el archivo (mp3, ogg o wav, hasta 1 MB). Borrar es elegirlo en un menú. **✏️ Editar** permite
renombrar, cambiar el archivo, el **🔉 volumen** (25 a 200 %), la **🏷️ categoría** y los **👥 roles**. Además: **🌙 Horario**
(silencio de HH:MM a HH:MM en hora de Madrid, y un interruptor de apagado), **🔔 Eventos** (un sonido para «logro desbloqueado»
y otro para «apuesta ganada grande», desde 1.000 🪙, con un mínimo de minutos entre dos) y **📊 Más usados**. Los eventos solo
suenan si el bot está en un canal por `/conectar`.

`/conectar sonido:<nombre>` toca ese sonido una vez, al entrar.

Reproducir necesita `ffmpeg` en el servidor (ya viene en la imagen de Docker). `SONIDOS_DIR` (opcional) cambia la carpeta
donde se guardan; por defecto, `data/sonidos`. Migraciones 037 (`sonidos`) y 060 (categoría, volumen, usos, `sonido_roles`,
`sonidos_eventos`). Tests: `tests/sonidos.test.js`, `tests/presencia.test.js`, `tests/adminSonidos.test.js`,
`tests/sonidosAvanzados.test.js`, `tests/sonidosPaneles.test.js`.

## 15. Configuración (.env)

### Obligatorias

| Variable | Para qué |
|---|---|
| `TOKEN`, `CLIENT_ID`, `GUILD_ID` | Conexión a Discord y registro de comandos |
| `GOOGLE_API_KEY` | Gemini (Duende, `/imagen`, TTS) |
| `ODDS_API_KEY` | Apuestas deportivas y quinielas |

### Integraciones (opcionales)

| Variable | Para qué |
|---|---|
| `TAUTULLI_URL`, `TAUTULLI_API_KEY` | Plex (también configurable en el panel) |
| `SEERR_URL`, `SEERR_API_KEY` | Seerr (también configurable en el panel) |
| `SONIDOS_DIR` | `data/sonidos` | Carpeta donde se guardan los sonidos de `/sonidos` |
| `ODDS_DIRECTO` | `0` | `1` activa las apuestas en directo (#12): cuotas refrescadas cada 10 min mientras se juega. Gasta créditos de la Odds API |
| `DUENDE_RECUERDOS_AUTO` | `1` | Recuerdos automáticos del Duende (#15): `0` lo apaga |
| `DUENDE_RECUERDOS_MAX_DIA` | 40 | Llamadas a Gemini por día y servidor para detectar recuerdos |
| `TMDB_API_KEY` | Clave de TMDB (opcional): de cada película de Plex, sus países de producción, para los trofeos por país (🌍) |
| `GIPHY_API_KEY` | GIFs del Duende |
| `ESTADOS` | Lista separada por comas de estados del bot |

### Ajustes del Duende y la IA

| Variable | Por defecto | Qué controla |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo del Duende |
| `GEMINI_FALLBACK_MODELS` | `gemini-2.5-flash,gemini-2.5-pro` | Modelos de respaldo del Duende: si al arrancar el del servidor no existe o no usa herramientas, se pasa solo al primero que funcione (antes se prueba el de `GEMINI_MODEL`) |
| `GEMINI_TIMEOUT_MS` | 20000 | Timeout de cada llamada (cancela la petición) |
| `DUENDE_MAX_TOKENS` / `DUENDE_MAX_TOKENS_FALLBACK` | 1024 / 512 | Longitud máxima de respuesta |
| `DUENDE_HISTORY_LIMIT` | 20 | Mensajes de contexto por canal |
| `DUENDE_DAILY_LIMIT` | 50 | Respuestas al día (0 = sin límite) |
| `DUENDE_DAILY_LIMIT_USER` | 15 | Respuestas al día por persona (0 = sin límite) |
| `IMAGE_GEN_DAILY_LIMIT` | 10 | Imágenes al día por persona (0 = sin límite) |
| `DUENDE_RECUERDOS_CADUCA_DIAS` | 7 | Días antes de que caduque una propuesta de recuerdo |
| `DUENDE_ESPONTANEO_ENFRIAMIENTO_H` | 24 | Horas antes de dirigir otro mensaje espontáneo a la misma persona |
| `DUENDE_TEXT_REPLY_PROB` | 0.25 | Probabilidad de responder sin que le hablen |
| `DUENDE_ACTIVE_TEXT_REPLY_PROB` / `DUENDE_ACTIVE_WINDOW_MS` | 1 / 180000 | Conversación activa |
| `DUENDE_INTERVENE_PROB` | 0.5 | Probabilidad de meterse cuando hablan entre ellos |
| `DUENDE_GIF_PROB` | 0.08 | Probabilidad de GIF |
| `DUENDE_VOICE_REPLY_PROB` | 0.1 | Probabilidad de responder por voz |
| `DUENDE_VOICE_IDLE_DISCONNECT_MS` | 300000 | Tiempo en voz tras la última respuesta |
| `DUENDE_TTS_VOICE` | `Charon` | Voz por defecto de `/tts` y del Duende |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` | Modelo de TTS. Los 3.x van por la Interactions API; los 2.x, por `generateContent` |
| `GEMINI_TTS_FALLBACK_MODELS` | `gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts` | Modelos que se prueban si el primero falla (siempre se prueba también el de por defecto) |
| `GEMINI_TTS_STYLE` | (vacío) | Tono para los modelos 3.x ("natural, en español de España"...) |
| `GEMINI_TTS_TIMEOUT_MS`, `GEMINI_TTS_TOTAL_TIMEOUT_MS` | `20000`, `45000` | Por petición, y en total con reintentos y respaldos |
| `DUENDE_TEMPERATURE` | 0.7 | Creatividad (también en el panel) |
| `DUENDE_PROMPT_MSG_MAX_CHARS` | 280 | Recorte de cada mensaje del historial |
| `DUENDE_LOG_FULL_PROMPT` | 0 | `1` = guarda el prompt completo en el log |
| `DUENDE_ESPONTANEO_PROB` | 0.15 | Probabilidad de mensaje espontáneo por hora (11:00-23:00); canal y activado en el panel |
| `DUENDE_ESPONTANEO_QUIET_MS` | 7200000 (2h) | Tiempo sin mensajes de verdad en el canal para considerarlo "parado" |
| `IMAGE_GEN_MODEL`, `IMAGE_GEN_TIMEOUT_MS`, `IMAGE_GEN_MAX_RETRIES`, `IMAGE_GEN_RETRY_BASE_MS`, `IMAGE_GEN_COOLDOWN_MS` | | `/imagen` |

### Voz (STT)

| Variable | Por defecto | Qué controla |
|---|---|---|
| `STT_ENABLED` | 1 | `0` = no arrancar Vosk en Docker |
| `LOCAL_STT_URL` | `http://127.0.0.1:5001/transcribe` | Servidor Vosk |
| `VOSK_MODEL_PATH` | modelo español pequeño | Modelo |
| `STT_LISTEN_TIMEOUT_MS`, `STT_ONLY_USER_ID`, `STT_FIXED_USER_ID` | | Ajustes de `/escuchar` (el detalle de STT sale con `LOG_LEVEL=debug`; `STT_VERBBOSE` ya no se usa) |

### Voz en directo (Gemini Live, `/conversación`)

| Variable | Por defecto | Qué controla |
|---|---|---|
| `DUENDE_LIVE_MODEL` | `gemini-3.8-live` | Modelo de audio bidireccional en tiempo real (no confundir con `GEMINI_TTS_MODEL`, que es por lotes) |
| `DUENDE_LIVE_VOICE` | `DUENDE_TTS_VOICE` o `Charon` | Voz de `/conversación` |
| `DUENDE_LIVE_IDLE_DISCONNECT_MS` | 300000 (5 min) | Corta la conversación tras este tiempo sin que nadie hable — se cobra mientras la conexión esté abierta, no solo al hablar |
| `DUENDE_LIVE_MAX_DURATION_MS` | 1800000 (30 min) | Tope duro de duración, haya actividad o no |

### Otros

| Variable | Por defecto | Qué controla |
|---|---|---|
| `MIN_BET_AMOUNT` / `MAX_BET_AMOUNT` | 10 / 1000 | Límites de apuestas deportivas y quiniela |
| `BACKUP_KEEP` / `BACKUP_DIR` | 7 / `data/backups/` | Copias diarias de la BD que se conservan y dónde |
| `QUINIELA_LOCK_MINUTES` | 15 | Bloqueo de la quiniela antes del primer partido |
| `ODDS_CACHE_MINUTES` | 30 | Cuánto se reutilizan las cuotas de la Odds API antes de volver a pedirlas (cada mercado de cada petición gasta 1 crédito de 500 al mes) |
| `ODDS_MERCADOS` | `h2h,totals,spreads` | Mercados que se piden a la Odds API: 1X2, goles y hándicap. Con `h2h` solo, cada actualización cuesta 1 crédito en vez de 3 |
| `ODDS_MERCADOS_EXTRA` | vacío (apagado) | `btts,double_chance` activa ambos marcan y doble oportunidad (#532). Se piden partido a partido: 1 crédito por mercado y partido |
| `ODDS_EXTRA_HORAS` / `ODDS_EXTRA_MAX` / `ODDS_EXTRA_MINUTOS` | `48` / `10` / `360` | Ventana de partidos, tope de partidos por actualización y cada cuánto se repite la consulta de un mismo partido |
| `ODDS_CREDITOS_AVISO` | 50 | Por debajo de estos créditos de la Odds API se avisa por DM a los admins |
| `LOG_LEVEL` | info | Nivel mínimo en los ficheros: `debug`, `info`, `warn` o `error`. También se cambia en caliente en `/paneladmin` → 🩺 Sistema |
| `LOG_CONSOLE_LEVEL` | warn | Nivel mínimo que sale por consola (`docker logs`); `off` para nada |
| `LOG_MAX_BYTES` / `LOG_MAX_FILES` | 5 MB / 5 | Rotación de logs |
| `LOG_MAX_ENTRY_CHARS` | 8000 | Tamaño máximo de una entrada (se recorta) |
| `DB_PATH`, `DATA_DIR`, `LOG_DIR` | `data/banco.db`, `data/`, `logs/` | Rutas (los tests las cambian) |
| `XP_SLOWED_USER_ID`, `XP_SLOWED_USER_COST_MULTIPLIER` | | Obsoletas: solo siembran el multiplicador de un usuario la primera vez |

---

## 16. Datos, logs y despliegue

| Ruta | Contenido |
|---|---|
| `data/banco.db` | Base de datos SQLite (WAL): economía, XP, logros, casino, apuestas, cripto, ajustes, auditoría, apodos, personalidades y perfiles del Duende |
| `data/backups/` | Copia diaria de la BD a las 04:30 (`banco-AAAA-MM-DD.db`, se guardan 7). A mano: `npm run db:backup` |
| `data/backups/tablas-antiguas-*.json` | Contenido de las tablas antiguas que borró la migración 007 (juego de roles, prototipo del pase de batalla) |
| `data/duende-history.json` | Historial reciente de conversación por canal |
| `data/duende-personalities.json`, `data/duende-config.json` | Ya no se usan: personalidades, perfiles y personalidad por canal están en la BD. Si existen al arrancar se importan una vez y se renombran a `.importado` |
| `data/duende-apodos.seed.json` | Opcional: apodos a importar una vez (luego se renombra a `.importado`); ver `docs/DEPLOY.md` |
| `logs/app-log.txt` | Log completo en orden cronológico (desde `LOG_LEVEL` hacia arriba) |
| `logs/warn-log.txt`, `logs/error-log.txt` | Solo avisos / solo errores. Todos rotan a `.1.txt`, `.2.txt`... |

**Qué queda registrado**: cada comando (con subcomando y opciones), botón, menú y formulario, con quién,
dónde, cuánto tardó y el error con traza si falló; cada respuesta del Duende; los movimientos de dinero
(apuestas, premios, compras, transferencias, cripto, recompensas de logros, reembolsos); las acciones de
administración (también en la auditoría); las llamadas a Gemini, Tautulli y Seerr que fallan; las tareas
programadas que fallan o tardan; y el estado de la conexión con Discord (caídas, reconexiones, rate limits).
Las claves de API y el token se ocultan automáticamente. Cada línea: `fecha NIVEL [Módulo] mensaje`.

**Despliegue**: Docker en el servidor `elements` (OMV/Portainer), stack en `/compose/duende-bot` con `data/` y
`logs/` montados como volúmenes. El contenedor registra los comandos, arranca Vosk y el bot; se para
limpiamente con `docker stop`. Ver `docs/DEPLOY.md`.

**Esquema de la BD**: lo crean y actualizan las migraciones de `src/core/migrations/` al arrancar (quedan
registradas en la tabla `schema_migrations`). Los usuarios se dan de alta solos en la tabla `usuarios` al
crearles cuenta, historial, inventario o partidas.

**Tests**: `npm test` (Jest) usa una BD en memoria y carpetas temporales; nunca toca los datos reales.
`npm run check` pasa además ESLint y Prettier.

**Comprobar Plex contra el Tautulli de verdad**: `npm run plex:check` (`scripts/plex-check.js`, solo lee y no toca
la BD). Coge la URL y la clave de Tautulli de la BD (`--bd ruta`, por defecto `data/banco.db`; con varios servidores,
`--guild <id>`) o de `TAUTULLI_URL`/`TAUTULLI_API_KEY`, y comprueba cada supuesto de los logros de Plex: conexión,
bibliotecas y cuáles son anime, que la lista de películas pagina, los idiomas de las últimas reproducciones
(`--muestra 40`) y los nombres que no se reconocen, la ficha de una serie (temporadas, episodios y fecha de llegada)
y las horas del historial contra las de Tautulli. ✓ / ⚠ / ✗ por paso; sale con 1 si algo falla. Dentro del
contenedor: `docker exec -it duende-bot npm run plex:check`.

**Estructura del código**: ver el [README](../README.md) (carpetas, convenciones y cómo añadir un comando).

---

## 17. Referencia rápida de comandos

| Comando | Sección |
|---|---|
| `/avisos` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/ayuda` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/bola8` | [IA y multimedia](#3-ia-y-multimedia) |
| `/conectar` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/conversación` | [IA y multimedia](#3-ia-y-multimedia) |
| `/cripto` | [Cripto](#10-criptomonedas) |
| `/cumpleaños` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/recordar` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/encuesta` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/prestamo` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/subastas` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/loteria` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/elecciones` | [Utilidades](#️-elecciones-a-la-presidencia) |
| `/presidente` | [Utilidades](#️-elecciones-a-la-presidencia) |
| `/duende` | [El Duende](#2-el-duende-ia-conversacional) |
| `/escuchar` | [IA y multimedia](#3-ia-y-multimedia) |
| `/imagen` | [IA y multimedia](#3-ia-y-multimedia) |
| `/imagenes` | [IA y multimedia](#3-ia-y-multimedia) |
| `/resumen` | [IA y multimedia](#3-ia-y-multimedia) |
| `/juegos` | [Casino](#8-casino) · [Apuestas](#9-apuestas-deportivas-y-quinielas) · [Retos](#retos-entre-jugadores) |
| `/javier` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/mensaje` 🔒 | [Administración](#12-administración) |
| `/paneladmin` 🔒 | [Administración](#12-administración) |
| `/pase` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/perfil` | [Perfil](#6-perfil) |
| `/ping` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/plex` | [Plex y Seerr](#11-plex-y-seerr) |
| `/presentacion` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/robar` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/sonidos` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/sugerencia` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/tienda` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/trabajar` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/tts` | [IA y multimedia](#3-ia-y-multimedia) |
