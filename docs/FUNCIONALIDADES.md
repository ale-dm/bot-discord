# El Duende — Qué hace el bot

Documentación funcional de todo lo que hace El Duende: comandos, sistemas automáticos,
configuración y datos. Refleja el código a fecha 2026-09-24.

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
- **Economía virtual**: banco, tienda de objetos, casino, apuestas de fútbol reales y criptomonedas
  (una propia, $TTCL, y reales con precio de CoinGecko).
- **Integración con Plex** (vía Tautulli) y **Seerr** para consultar y pedir películas/series.
- **Panel de administración** para configurarlo todo desde Discord.

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
- **Límite diario**: 50 respuestas al día en total (`DUENDE_DAILY_LIMIT`). Al llegar, lo avisa.
- **Mensajes duplicados** (reconexiones de Discord) se ignoran para no ejecutar dos veces una acción.

### Cómo responde

- Respuestas cortas (1–2 frases), en el tono de la **personalidad** activa en el canal.
- Recuerda los últimos 20 mensajes de cada canal (`history_limit`); el historial de un canal se borra
  tras 24 h sin actividad.
- Usa los **perfiles de personas** (descripción escrita por un admin en Panel admin → Config Global → Duende →
  🧠 Perfiles, más las notas de `/duende recuerda`) para tratar a cada uno según lo que sabe de él, y relaciona
  a quien habla con quien se menciona. Cada perfil va ligado al **Discord ID**: cambiar de username no lo pierde.
- Convierte en **menciones reales** de Discord el nombre de la gente cuando lo escribe en una respuesta
  (el nombre principal de sus apodos, no los motes).
- **Apodos** (Panel admin → Config Global → Duende → Apodos): el nombre con el que llama a cada uno y otras
  formas de referirse a esa persona ("el perro", "coneyo"...), para entender de quién habláis.
- A veces (8 %, `DUENDE_GIF_PROB`) acompaña la respuesta con un **GIF** de Giphy.
- **Voz**: si quien le habla está en un canal de voz, a veces (10 %, `DUENDE_VOICE_REPLY_PROB`) entra y
  dice la respuesta en voz alta (Gemini TTS). Se queda conectado 5 min por si sigue la charla.
- Si Gemini bloquea la respuesta por contenido, reintenta con un tono neutro manteniendo las herramientas.

### Herramientas (datos reales)

Durante una respuesta, el Duende puede consultar datos del bot. Las de solo lectura sobre el propio usuario
nunca permiten mirar datos de otro (el usuario sale del contexto de Discord, no del texto).

| Grupo | Herramientas | Dónde |
|---|---|---|
| Básicas | Nivel, XP y racha · saldo · precio de TTCL · logros · tirar un dado | Siempre |
| Plex (Tautulli) | Qué ha visto alguien · qué se ve ahora · horas vistas · última conexión · novedades · comparar a dos personas · top del servidor · buscar en Plex · ranking de quién más ve · bibliotecas · día/hora de más actividad | Solo en canales permitidos para Plex |
| Seerr | Buscar contenido · **pedir** película/serie (también "en nombre de" otra persona) · ver peticiones recientes | Solo en canales permitidos para Seerr |

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
| `recuerda usuario* nota*` | Guarda una nota sobre alguien (máx. 15 notas por persona, 200 caracteres cada una) | Todos |
| `olvida usuario*` | Borra las notas guardadas con `recuerda` (no el perfil base escrito a mano) | La propia persona, o un admin para cualquiera |
| `personas` | Lista lo que recuerda de cada persona | Todos |

---

## 3. IA y multimedia

| Comando | Qué hace |
|---|---|
| `/ia prompt* [agente] [generar_imagen]` | Consulta a un agente de IA especializado. Agentes: Asistente General, Técnico, Creativo, Profesor, Negocios, Coach Personal, Científico y Filósofo. Puede generar además una imagen ilustrativa. Respuestas largas se parten en varios embeds. Cooldown de 15 s por usuario. |
| `/imagen descripcion* [imagen1..5] [estilo]` | Genera una imagen con IA (Gemini), o edita/combina hasta 5 imágenes adjuntas. Estilos: realista, óleo, lápiz, anime, pixel art, cyberpunk, fantasía épica, caricatura. Reintenta si la API está saturada; timeout de 2 min; cooldown de 45 s por usuario. |
| `/tts texto* [voz]` | El bot entra en tu canal de voz y lee el texto (Gemini TTS). Voces: Puck, Kore, Charon, Fenrir, Algenib, Sulafat, Despina. El idioma se detecta solo. Los textos se ponen en cola por servidor. |
| `/escuchar [usuario]` | El bot escucha a un usuario en el canal de voz, transcribe lo que dice (Vosk, local) y le responde **por voz** como el Duende, encadenando turnos mientras la conversación siga activa. |
| `/bola8 pregunta*` | Respuesta al azar de la bola 8 mágica. |

---

## 4. Niveles y XP

### Cómo se gana XP

| Fuente | XP | Condiciones |
|---|---|---|
| Mensaje | 15 + hasta 10 según longitud (máx. a los 200 caracteres) | Máximo un mensaje cada 15 s. Las letras repetidas ("aaaaa") no cuentan para la longitud. |
| Voz | 5 XP por minuto | Sin mute ni ensordecer, y con al menos otra persona (no bot) en el canal. |
| Multiplicadores | × multiplicador global del servidor · × bonus de racha | Configurables en el panel. |

- Los **canales ignorados** no dan XP (ni por texto ni por voz).
- Cada persona puede tener un **multiplicador de coste** propio (subir de nivel le cuesta más o menos).

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

- Cada día (hora de Madrid) en que ganas XP suma un día de racha; si fallas un día, vuelve a 1.
- Bonus de XP: +2 % por día de racha, con un máximo de +50 %.
- A partir del segundo día, te avisa por DM de que la racha sigue.
- ⏱️ A las 17:00 avisa por DM a quien tenga racha de 2 días o más y aún no haya ganado XP ese día.

### Comando

| Comando | Qué hace |
|---|---|
| `/nivel [usuario]` | Nivel, XP, progreso, rango, racha, puesto en el ranking y últimas subidas de nivel. Tiene botones para navegar. |

---

## 5. Logros

36 logros en 5 categorías que se completan solos al hacer cosas; la recompensa en monedas se reclama a mano.

| Categoría | Logros (objetivo → recompensa) |
|---|---|
| Social | 1 mensaje → 100 · 100 → 400 · 1.000 → 1.500 · 2.500 → 2.500 · 5.000 → 5.000 |
| XP | Voz 60 min → 300 · 300 min → 1.200 · 1.000 min → 3.500 · XP total 1.000 → 300 · 5.000 → 1.500 · 20.000 → 5.000 · Nivel 10 → 500 · 25 → 1.500 · 40 → 3.500 · 60 → 7.000 |
| Casino | Primera apuesta → 150 · 10.000 apostadas → 800 · 50.000 → 3.500 · 25 victorias → 1.200 · 100 → 4.500 · 5.000 netas ganadas → 2.000 · 20.000 → 7.500 · *(oculto)* 50 derrotas → 1.800 |
| Cripto | Primera compra → 150 · 10 operaciones → 900 · 50 → 4.000 · 20.000 movidas → 1.500 · 100.000 → 7.000 · 25 ventas → 2.500 · *(ocultos)* tener 500 TTCL → 1.800 · 2.000 TTCL → 9.000 |
| Tienda | Primera compra → 120 · 20 compras → 1.100 · 50 → 3.200 · 5.000 gastadas → 1.300 · 20.000 → 6.000 |

Las recompensas se multiplican por `logros.reward_multiplier` y se pueden desactivar categorías enteras.

| Comando | Qué hace |
|---|---|
| `/logros ver` | Tus logros y progreso |
| `/logros reclamar id*` | Cobra la recompensa de un logro completado |
| `/logros reclamar_todo` | Cobra todas las pendientes |
| `/logros top` | Ranking de logros completados |

---

## 6. Perfil

`/perfil [usuario]` muestra un perfil unificado con botones de navegación:

- **👤 Perfil**: nivel, racha, saldo, logros, estadísticas.
- **🎰 Casino**: estadísticas de juego (partidas, juego favorito, últimas partidas) y acceso a la ruleta.
- **🏅 Logros**, **🏆 Top** (rankings) y **🎭 Recompensas** (roles por nivel).

---

## 7. Economía: banco, tienda e inventario

### Banco

- Todo el mundo empieza con **1.000 monedas** en el banco (se crea la cuenta al usarla por primera vez).
- Hay dos saldos: **banco** (con el que se juega y se compra) y **en mano**.
- El banco es único para todo el bot (no es por servidor).

| Comando | Qué hace |
|---|---|
| `/banco saldo` | Tu saldo en banco y en mano |
| `/banco depositar cantidad*` | Pasa dinero de la mano al banco (máx. 1.000.000 por operación) |
| `/banco retirar cantidad*` | Pasa dinero del banco a la mano (máx. 1.000.000) |
| `/banco transferir usuario* cantidad*` | Envía dinero en mano a otra persona (máx. 1.000.000) |
| `/banco top` | Ranking de los más ricos |
| `/banco historial` | Tus movimientos |
| `/banco historialglobal` | 🔒 Movimientos de todo el mundo |

### Objetos, tienda e inventario

Los admins crean **objetos** en un catálogo y los ponen a la venta en la **tienda** con precio y stock.

Tipos de objeto:
- **rol**: al comprarlo (o usarlo) te da un rol de Discord (por ID o por nombre igual al del objeto).
- **consumible**: al usarlo aplica su efecto — `monedas:N` (te da N monedas) o `mensaje:texto`.
- Cada objeto puede tener categoría, rareza, imagen y ser **único** (solo se puede comprar una vez).

| Comando | Qué hace |
|---|---|
| `/tienda ver [busqueda] [solo_disponibles] [categoria] [rareza]` | Catálogo de la tienda con botones de compra (paginado) |
| `/tienda historial` | Tus compras |
| `/tienda añadir objeto_id* precio* [stock]` | 🔒 Pone un objeto a la venta (sin stock = ilimitado) |
| `/tienda editar id* [precio] [stock]` | 🔒 Cambia precio/stock |
| `/tienda eliminar id*` | 🔒 Lo quita de la tienda |
| `/tienda config [canal]` | 🔒 Canal donde se anuncian las compras |
| `/objeto crear nombre* descripcion* [imagen] [tipo] [categoria] [rareza] [unico] [rol] [efecto]` | 🔒 Crea un objeto. `tipo`: rol, consumible o coleccionable · `rol`: el rol que da · `efecto` (consumibles): `monedas:N` o `mensaje:texto` |
| `/objeto editar id* ...` · `/objeto eliminar id*` · `/objeto ver [busqueda]` | 🔒 Gestiona el catálogo |
| `/inventario [categoria] [rareza]` | Tus objetos |
| `/usar id*` | Usa un objeto del inventario |

Una compra es atómica: o se cobra y se entrega el objeto, o no pasa nada. Se puede limitar con cooldown y
cupo diario de compras.

---

## 8. Casino

### Reglas comunes

- Se juega con el saldo del **banco**. Apuesta mínima 10 y máxima 100.000 (configurable).
- Opcionalmente: cooldown entre jugadas y cupo diario de jugadas. Una apuesta rechazada (sin saldo, fuera
  de límites) no gasta cupo.
- **RTP** configurable por juego (blackjack, tragaperras, ruleta, adivinar): escala solo el premio neto,
  nunca la probabilidad ni la apuesta devuelta en un empate.
- **Partidas a medias**: no puedes tener dos partidas del mismo juego a la vez. Una partida sin tocar
  15 minutos se da por perdida. Si el bot se reinicia a mitad de partida, **se devuelve lo apostado**.
- Todo queda registrado en el historial y cuenta para los logros de casino.

### Juegos

| Comando | Juego | Pagos |
|---|---|---|
| `/blackjack apuesta*` | Blackjack contra el crupier con 4 barajas: pedir, plantarse, doblar y separar (split, con regla especial para ases). El crupier pide hasta 17 y comprueba su blackjack al repartir. | Victoria ×2 · Blackjack natural ×2,5 · Empate: recuperas la apuesta |
| `/tragaperras [apuesta]` | 3 carretes con jackpot progresivo (el 10 % de cada apuesta va al bote; empieza en 10.000). Sin apuesta muestra el menú. Apuesta 50–5.000. Botones de repetir tirada. | 3 iguales: 🍒×2 🍋×3 🍊×4 🍇×5 🔔×8 💎×15 ⭐×25 · 3×7️⃣ = JACKPOT · 2 iguales: valor/3 (mín. ×1) |
| `/ruleta apuesta* [tipo] [numero]` | Ruleta europea (0–36). También accesible desde el perfil → Casino. | Rojo/negro, par/impar, bajo/alto ×2 · Docenas ×3 · Número exacto ×36 |
| `/adivinar` | "Ride the bus": 4 rondas con una apuesta fija de 500 — color, mayor/menor, dentro/fuera, palo. Te puedes retirar desde la ronda 3. | Acumulado ×2 → ×3 → ×4 → **×20** si aciertas las 4 |
| `/ppt jugada* cantidad*` | Piedra, papel o tijera contra el Duende | Victoria ×2 · Empate: recuperas la apuesta |

---

## 9. Apuestas deportivas y quinielas

Usa cuotas y resultados reales de **The Odds API** para LaLiga, Premier League y Champions League.

| Comando | Qué hace |
|---|---|
| `/apuestas [deporte]` | Próximos partidos con sus cuotas (1/X/2) y escudos. Eliges partido y resultado y apuestas (10–1.000). No se puede repetir la misma apuesta, y un partido que ya ha empezado no admite apuestas aunque se pulse un botón de un mensaje antiguo. Las cuotas se reutilizan 30 min para no gastar créditos de la API. |
| `/misapuestas [tipo]` | Tus apuestas: activas, historial (ganada con su premio, perdida o reembolsada) o estadísticas. También desde el botón "Ver mis apuestas" de `/apuestas` |
| `/quiniela [deporte]` | Quiniela de la jornada: pronósticos 1/X/2 para 10 partidos. Un admin la crea con un botón; se bloquea 15 min antes del primer partido (también se rechaza un formulario enviado después). |
| `/pagarapuestas` | 🔒 Fuerza la liquidación ahora (normalmente no hace falta) |

**Liquidación** ⏱️ cada hora (minuto 15): cierra los partidos terminados (empezados hace más de 2 h),
paga las apuestas ganadoras (apuesta × cuota) y liquida las quinielas completas: el 90 % del bote se reparte
entre quienes más aciertos tengan. Los resultados de la quiniela se guardan partido a partido según se conocen.
Los ganadores reciben un DM.

La API solo da resultados de los **últimos 3 días**: un partido (o una quiniela con partidos) que empezó hace
más y sigue sin resultado se marca como caducado y **se devuelve lo apostado** (con aviso por DM).

---

## 10. Criptomonedas

`/cripto` abre un panel con botones: precios, gráfico (24 h / 7 días / 30 días / todo), comprar, vender,
cartera, historial, top de inversores e información de $TTCL.

- **Criptos reales**: BTC, ETH, SOL, BNB, XRP y DOGE, con el precio real de CoinGecko en euros
  (1 € = 1.000 monedas). Se cachea 1 minuto.
- **$TTCL** (moneda del servidor): el precio depende de cuántos TTCL hay en circulación —
  `precio = base × e^(circulación / 1.000.000 × volatilidad / 10)` (base 100, volatilidad 40). Comprar sube
  el precio y vender lo baja. ⏱️ El precio se registra cada 10 minutos para el gráfico.
- Configurable: comisiones de compra/venta, cooldowns y mínimos/máximos por operación.

`/ttcl-diagnostico` muestra el estado del registro de precios de TTCL.

---

## 11. Plex y Seerr

### Plex (vía Tautulli)

- ⏱️ **Novedades**: cada 30 minutos publica en el canal de novedades lo que se haya añadido a Plex.
- El Duende puede responder preguntas sobre Plex (ver [herramientas](#herramientas-datos-reales)) en los
  canales permitidos.
- Un admin **vincula** cada cuenta de Plex con su usuario de Discord (Panel admin → Plex), necesario para las
  consultas sobre personas concretas.

### Seerr

- Pedir películas/series hablando con el Duende ("pídeme Dune", "pide X para Raúl").
- El usuario de Seerr se identifica por el Discord ID de su perfil en Seerr o, si no, por su vínculo de Plex.
- Límite diario de peticiones por persona (`seerr.daily_request_limit`, 5 por defecto).
- Solo funciona en los canales permitidos, que se eligen en Panel admin → Seerr.

---

## 12. Administración

### `/paneladmin` 🔒

Panel con botones, todo en mensajes efímeros. Cada cambio queda en la **auditoría**.

| Sección | Qué se puede hacer |
|---|---|
| 🏦 Banco | Modificar saldo (banco o en mano) · resetear usuario (a 1.000) · borrar historial · historial global · buscar usuario |
| 📈 Niveles / XP | **Config**: XP por mensaje/voz, cooldown, fórmula de niveles, multiplicador global, canal de anuncios, racha (bonus y tope), vista previa de la curva · **Recompensas**: roles por nivel y qué desbloquea cada uno (📝 Descripción, se muestra en `/nivel`) · **Usuarios**: ver perfil, ± XP, multiplicador de coste individual, reset de XP (con confirmación) · **Ignorados**: canales sin XP |
| ⚙️ Config Global | **🤖 Duende**: modelo, temperatura, historial, canal permitido, **🏷️ Apodos** y **🧠 Perfiles** (ficha completa de cada persona —Discord ID, username, nombre, apodos, descripción, notas y cuánto de todo eso recibe el Duende— y edición de todos los campos en un formulario; borrar notas o el perfil entero) · **📈 Cripto**: precio base y volatilidad de TTCL, comisiones, límites y cooldowns · **🎰 Casino**: apuesta mín./máx., cooldown, cupo diario, RTP por juego · **🛒 Tienda**: activar, cooldown, cupo diario, canal de avisos · **🔐 Comandos**: activar/desactivar comandos y restringirlos por canal o rol · **🏅 Logros**: activar, canal de avisos, multiplicador de recompensas, categorías desactivadas |
| 🧾 Auditoría | Registro paginado de acciones de administración |
| 🎬 Plex | Vincular cuentas de Plex, canales permitidos para las herramientas de Plex, canal de novedades |
| 🍿 Seerr | Canales permitidos para pedir contenido |

### Control de comandos (ACL)

Para cada comando se puede: desactivarlo en el servidor, limitarlo a ciertos canales y/o exigir ciertos roles.
Se aplica también a los botones (por ejemplo, los botones de la tienda respetan el ACL de `/tienda`).

### Otros comandos de admin

| Comando | Qué hace |
|---|---|
| `/panel` 🔒 | Panel de administración del banco (menú desplegable) |
| `/diagnostico [nivel_log]` 🔒 | Estado interno: uptime, memoria, comandos, servidores, DB, errores y avisos desde el arranque, último error, consumo de Gemini (llamadas, errores por cuota, tokens) y ajustes de Duende/cripto/logros/tienda. Con `nivel_log` cambia el nivel de log sin reiniciar |
| `/pagarapuestas` 🔒 | Ver [apuestas](#9-apuestas-deportivas-y-quinielas) |

---

## 13. Tareas automáticas

| Cuándo | Qué |
|---|---|
| Al arrancar | Registra los slash commands · crea índices de BD · **devuelve lo apostado en partidas interrumpidas** · asigna roles de nivel que falten |
| Cada minuto | XP de voz |
| Cada 5 minutos | Liquida como perdidas las partidas de casino abandonadas (>15 min) |
| Cada 10 minutos | Registra el precio de $TTCL |
| Cada 30 minutos | Novedades de Plex |
| Cada hora (min. 15) | Liquidación de apuestas deportivas y quinielas + DM a ganadores |
| Cada hora | Limpia historiales de conversación del Duende sin actividad en 24 h |
| Cada 90 minutos | Cambia el estado ("Viendo ...") del bot, de la lista `ESTADOS` |
| 04:30 (Madrid) | Copia de seguridad de la BD en `data/backups/` (se guardan 7) |
| 17:00 (Madrid) | Aviso de "racha en peligro" por DM |

---

## 14. Utilidades y comandos varios

| Comando | Qué hace |
|---|---|
| `/ayuda` | Guía de los comandos principales, con botones por sección |
| `/ping` | Latencia del bot y de la API de Discord |
| `/javier` | Contesta "Eres un mierdas." |

---

## 15. Configuración (.env)

### Obligatorias

| Variable | Para qué |
|---|---|
| `TOKEN`, `CLIENT_ID`, `GUILD_ID` | Conexión a Discord y registro de comandos |
| `GOOGLE_API_KEY` | Gemini (Duende, `/ia`, `/imagen`, TTS) |
| `ODDS_API_KEY` | Apuestas deportivas y quinielas |

### Integraciones (opcionales)

| Variable | Para qué |
|---|---|
| `TAUTULLI_URL`, `TAUTULLI_API_KEY` | Plex (también configurable en el panel) |
| `SEERR_URL`, `SEERR_API_KEY` | Seerr (también configurable en el panel) |
| `GIPHY_API_KEY` | GIFs del Duende |
| `ESTADOS` | Lista separada por comas de estados del bot |

### Ajustes del Duende y la IA

| Variable | Por defecto | Qué controla |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo del Duende y de `/ia` |
| `GEMINI_TIMEOUT_MS` | 20000 | Timeout de cada llamada (cancela la petición) |
| `DUENDE_MAX_TOKENS` / `DUENDE_MAX_TOKENS_FALLBACK` | 1024 / 512 | Longitud máxima de respuesta |
| `DUENDE_HISTORY_LIMIT` | 20 | Mensajes de contexto por canal |
| `DUENDE_DAILY_LIMIT` | 50 | Respuestas al día (0 = sin límite) |
| `DUENDE_TEXT_REPLY_PROB` | 0.25 | Probabilidad de responder sin que le hablen |
| `DUENDE_ACTIVE_TEXT_REPLY_PROB` / `DUENDE_ACTIVE_WINDOW_MS` | 1 / 180000 | Conversación activa |
| `DUENDE_INTERVENE_PROB` | 0.5 | Probabilidad de meterse cuando hablan entre ellos |
| `DUENDE_GIF_PROB` | 0.08 | Probabilidad de GIF |
| `DUENDE_VOICE_REPLY_PROB` | 0.1 | Probabilidad de responder por voz |
| `DUENDE_VOICE_IDLE_DISCONNECT_MS` | 300000 | Tiempo en voz tras la última respuesta |
| `DUENDE_TTS_VOICE`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_TIMEOUT_MS` | | Voz y modelo de TTS |
| `DUENDE_TEMPERATURE` | 0.7 | Creatividad (también en el panel) |
| `DUENDE_PROMPT_MSG_MAX_CHARS` | 280 | Recorte de cada mensaje del historial |
| `DUENDE_LOG_FULL_PROMPT` | 0 | `1` = guarda el prompt completo en el log |
| `IMAGE_GEN_MODEL`, `IMAGE_GEN_TIMEOUT_MS`, `IMAGE_GEN_MAX_RETRIES`, `IMAGE_GEN_RETRY_BASE_MS`, `IMAGE_GEN_COOLDOWN_MS` | | `/imagen` e imágenes de `/ia` |
| `IA_COOLDOWN_MS` | 15000 | Cooldown de `/ia` |

### Voz (STT)

| Variable | Por defecto | Qué controla |
|---|---|---|
| `STT_ENABLED` | 1 | `0` = no arrancar Vosk en Docker |
| `LOCAL_STT_URL` | `http://127.0.0.1:5001/transcribe` | Servidor Vosk |
| `VOSK_MODEL_PATH` | modelo español pequeño | Modelo |
| `STT_LISTEN_TIMEOUT_MS`, `STT_ONLY_USER_ID`, `STT_FIXED_USER_ID` | | Ajustes de `/escuchar` (el detalle de STT sale con `LOG_LEVEL=debug`; `STT_VERBBOSE` ya no se usa) |

### Otros

| Variable | Por defecto | Qué controla |
|---|---|---|
| `MIN_BET_AMOUNT` / `MAX_BET_AMOUNT` | 10 / 1000 | Límites de apuestas deportivas y quiniela |
| `BACKUP_KEEP` / `BACKUP_DIR` | 7 / `data/backups/` | Copias diarias de la BD que se conservan y dónde |
| `QUINIELA_LOCK_MINUTES` | 15 | Bloqueo de la quiniela antes del primer partido |
| `ODDS_CACHE_MINUTES` | 30 | Cuánto se reutilizan las cuotas de la Odds API antes de volver a pedirlas (cada petición gasta 1 crédito de 500 al mes) |
| `LOG_LEVEL` | info | Nivel mínimo en los ficheros: `debug`, `info`, `warn` o `error`. También se cambia en caliente con `/diagnostico nivel_log` |
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

**Estructura del código**: ver el [README](../README.md) (carpetas, convenciones y cómo añadir un comando).

---

## 17. Referencia rápida de comandos

| Comando | Sección |
|---|---|
| `/adivinar` | [Casino](#8-casino) |
| `/apuestas` | [Apuestas](#9-apuestas-deportivas-y-quinielas) |
| `/ayuda` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/banco` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/blackjack` | [Casino](#8-casino) |
| `/bola8` | [IA y multimedia](#3-ia-y-multimedia) |
| `/cripto` | [Cripto](#10-criptomonedas) |
| `/diagnostico` 🔒 | [Administración](#12-administración) |
| `/duende` | [El Duende](#2-el-duende-ia-conversacional) |
| `/escuchar` | [IA y multimedia](#3-ia-y-multimedia) |
| `/ia` | [IA y multimedia](#3-ia-y-multimedia) |
| `/imagen` | [IA y multimedia](#3-ia-y-multimedia) |
| `/inventario` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/javier` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/logros` | [Logros](#5-logros) |
| `/misapuestas` | [Apuestas](#9-apuestas-deportivas-y-quinielas) |
| `/nivel` | [Niveles](#4-niveles-y-xp) |
| `/objeto` 🔒 | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/pagarapuestas` 🔒 | [Apuestas](#9-apuestas-deportivas-y-quinielas) |
| `/panel` 🔒 | [Administración](#12-administración) |
| `/paneladmin` 🔒 | [Administración](#12-administración) |
| `/perfil` | [Perfil](#6-perfil) |
| `/ping` | [Utilidades](#14-utilidades-y-comandos-varios) |
| `/ppt` | [Casino](#8-casino) |
| `/quiniela` | [Apuestas](#9-apuestas-deportivas-y-quinielas) |
| `/ruleta` | [Casino](#8-casino) |
| `/tienda` | [Economía](#7-economía-banco-tienda-e-inventario) |
| `/tragaperras` | [Casino](#8-casino) |
| `/ttcl-diagnostico` | [Cripto](#10-criptomonedas) |
| `/tts` | [IA y multimedia](#3-ia-y-multimedia) |
| `/usar` | [Economía](#7-economía-banco-tienda-e-inventario) |
