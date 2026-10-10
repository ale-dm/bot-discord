# El Duende

Bot de Discord para un grupo de amigos: un personaje con IA (Gemini) que participa en el chat y
habla por voz, XP y niveles, logros, economía con tienda, casino, apuestas de fútbol reales,
criptomonedas e integración con Plex/Seerr.

- **Si coges el proyecto ahora, empieza aquí:** [docs/SIGUIENTES_PASOS.md](docs/SIGUIENTES_PASOS.md) (dónde está, qué
  hacer primero y por dónde seguir)
- **Qué hace y todos sus comandos:** [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md)
- **Despliegue (Docker / Portainer):** [docs/DEPLOY.md](docs/DEPLOY.md)
- **Historial de cambios:** [docs/CHANGELOG.md](docs/CHANGELOG.md)
- **Qué falta:** [tareas](docs/planificacion/TAREAS.md) · [errores conocidos](docs/planificacion/ERRORES.md) · [deuda técnica](docs/planificacion/DEUDA_TECNICA.md) · [ideas de features](https://github.com/ale-dm/bot-discord/issues?q=is%3Aopen+label%3Afeature-idea) (issues con la etiqueta `feature-idea`)
- **Índice de toda la documentación:** [docs/README.md](docs/README.md)

## Cómo se usa

Casi todo está en **ocho paneles** con pestañas y botones, enlazados entre sí (21 comandos en total):

| Panel | Qué hay |
|---|---|
| `/perfil [usuario] [seccion]` | 👤 Perfil (nivel, racha, recompensas) · 💰 Economía (efectivo y banco, ingresar, sacar, transferir, movimientos, 🎁 recompensa diaria) · 🎲 Juegos · 🏅 Logros · 🏆 Rankings. El de otra persona se ve entero; los botones de acción, solo en el tuyo |
| `/juegos [seccion]` | 🎰 Casino (blackjack, tragaperras, ruleta, adivinar, PPT) · ⚽ Apuestas (partidos y quiniela) · ⚔️ Retos (1 contra 1 a un partido, duelos y porras) · 📋 Mis jugadas · 📊 Stats |
| `/tienda` | 🛒 Catálogo · 🎒 Inventario (con Usar) · 🧾 Mis compras. Sin subcomandos |
| `/cripto` | 📈 Mercado (precio, gráfica, pool y eventos) · 🛒 Comprar · 💸 Vender (ambas con vista previa antes de confirmar) · 💼 Cartera · 🧾 Historial. Solo $TTCL |
| `/duende` | 💬 Hablar · 🧠 Recuerdos · 🎭 Personalidad (las personalidades y los recuerdos de otros, solo admins) |
| `/plex` | 🎬 Sesión de cine · 🎯 Para ti (recomendaciones) · 🎞️ Wrapped (tu resumen, privado) · 🏅 Mi Plex |
| `/sonidos` | 🔊 El panel de sonidos del servidor: pulsa uno y el bot lo toca (en tu canal, o en el que esté con `/conectar`) |
| `/conectar` | 🔌 El bot entra a un canal de voz 30 minutos, para que `/sonidos` no entre y salga cada vez |
| `/paneladmin` 🔒 | Banco, niveles, configuración, apuestas, catálogo, sistema, Plex, Seerr y auditoría |

`/ayuda` explica cada parte y tiene botones que abren estos paneles. El dinero está en **efectivo** (con lo que se
juega y se compra) o en el **banco** (seguro; hay que sacarlo para gastarlo). De momento los paneles son públicos
(solo quien los abre puede pulsarlos); los avisos de error, `/paneladmin` y lo que el Duende recuerda, en privado.
Aparte: el Duende en el chat y por voz (`/imagen`, `/tts`, `/escuchar`, `/conversación`), `/robar`, `/trabajar`, `/pase` (pase de batalla), `/bola8`, `/ping`, `/javier` y `/ayuda`. `/mensaje` es solo para admins.

## Puesta en marcha (desarrollo)

```bash
npm install
cp .env.example .env        # y rellenar TOKEN, CLIENT_ID, GUILD_ID, GOOGLE_API_KEY, ODDS_API_KEY
npm run stt:setup           # solo la primera vez: Python + modelo de voz (Windows)
npm start                   # servidor de voz + registro de comandos + bot
```

Otros comandos: `npm run start:bot` (sin voz) · `npm run start:vosk` (solo el servidor de voz) · `npm test` · `npm run db:check` · `npm run db:backup` ·
`npm run commands` (solo registrar los slash commands) · `npm run stt:test ruta.wav` · `npm run plex:check`
(comprueba los logros de Plex contra el Tautulli de verdad, sin tocar la BD).

Antes de subir cambios: `npm run check` (ESLint + Prettier + tests). `npm run lint:fix` y `npm run format`
corrigen lo automático; `npm run format:check` solo comprueba el formato.

## Estructura

```
el-duende/
├── src/
│   ├── index.js            Arranque: carga comandos, eventos de Discord y tareas programadas
│   ├── core/               Infraestructura común (sin lógica del bot)
│   │   ├── paths.js          Rutas del proyecto (data/, logs/, models/, commands/, juegos/, perfil/)
│   │   ├── db.js             Conexión SQLite (data/banco.db)
│   │   ├── logger.js         Logs con niveles, rotación y ocultación de secretos
│   │   ├── componentRouter.js  Enruta botones/menús/formularios al módulo que los declara
│   │   ├── interactionLog.js   Registro uniforme de interacciones y tareas
│   │   ├── migrations/       Esquema de la BD: migraciones numeradas que se aplican solas al arrancar
│   │   └── registerCommands.js Registra los slash commands en Discord
│   ├── commands/           Un fichero por slash command, agrupados por tema
│   │   ├── duende/           /duende /imagen /bola8 /javier
│   │   ├── voz/              /tts /escuchar /conversación /sonidos /conectar
│   │   ├── juegos/           /juegos (casino, apuestas, mis jugadas y stats, en pestañas)
│   │   ├── economia/         /tienda (catálogo, inventario y compras) /cripto /robar /trabajar
│   ├── plex/             /plex (sesiones de cine, recomendaciones, Wrapped y perfil de Plex)
│   │   ├── progresion/       /perfil (perfil, economía, juegos, logros y rankings, en pestañas) /pase
│   │   ├── admin/            /paneladmin (banco, niveles, config, apuestas, catálogo, sistema...) /mensaje
│   │   └── general/          /ayuda /ping
│   ├── juegos/             Juegos del casino, apuestas y retos: no son comandos (se entra por /juegos), pero
│   │                         sus botones se registran igual (casino/: blackjack, ruleta, tragaperras,
│   │                         adivinar, ppt · apuestas/: partidos, quiniela, mis jugadas · retos/)
│   ├── perfil/             Botones de dinero de /perfil (ingresar, sacar, transferir, movimientos)
│   ├── paneles/            Mensajes de los paneles (embeds y botones) de /perfil, /juegos, /tienda, /cripto y /duende
│   ├── adminPanel/         Secciones de /paneladmin (banco, niveles, ajustes, apuestas, catálogo, sistema, Plex, Seerr, apodos y
│   │                         perfiles del Duende, auditoría)
│   ├── systems/            Lógica del bot que usan varios comandos
│   │                         XP, logros, apodos, ajustes por servidor, auditoría, transacciones del
│   │                         casino, partidas en curso, vínculos de Plex, historial, fichas e idiomas
│   │                         de Plex para los logros y trofeos, backups, reglas del blackjack,
│   │                         dinero (efectivo, banco y movimientos), recompensa diaria, retos entre
│   │                         jugadores (dinero retenido hasta resolverse), tienda, objetos,
│   │                         alertas por DM a los admins, avisos de lo pedido en Seerr; xp/ (niveles,
│   │                         rachas, roles), apuestas/ (liquidación, recordatorios y mis jugadas),
│   │                         duende/ (memoria, perfiles, personas) y cripto/ (mercado, eventos y gráficos)
│   └── services/           Clientes de servicios externos
│                             Gemini, Gemini TTS, Tautulli, Seerr, Odds API, Giphy, transcripción de
│                             voz (STT); duende/ (herramientas, llamada a Gemini, voz)
├── vosk/                   Servidor de transcripción de voz (Python) + requirements.txt
├── tests/                  Tests (Jest), con BD en memoria: nunca tocan datos reales
├── scripts/                Utilidades de desarrollo y mantenimiento (no corren en producción)
├── deploy/                 Docker: entrypoint, stack de Portainer y compose para probar en local
├── docs/                   Documentación (índice en docs/README.md)
│   ├── tecnico/              Detalle técnico de integraciones (Plex y Seerr)
│   └── planificacion/        Tareas, deuda técnica, ideas de features y diseños (diseno/)
├── Dockerfile
├── .env.example            Plantilla de configuración
│
├── data/    (no va a git)  BD y JSON del Duende — en Docker es un volumen
├── logs/    (no va a git)  app-log.txt, warn-log.txt, error-log.txt — en Docker es un volumen
└── models/  (no va a git)  Modelo de Vosk — lo descarga `npm run stt:setup` o el build de Docker
```

### Convenciones

- **Un comando nuevo** = un fichero en `src/commands/<tema>/` que exporte `data` (SlashCommandBuilder)
  y `run(client, interaction)`. Se carga y registra solo; no hay que tocar `index.js`.
- **Botones, menús y formularios**: el propio comando declara `componentHandlers` con los prefijos de
  `customId` que atiende (ver `src/core/componentRouter.js`). Los módulos de `src/juegos/` también, aunque
  no sean comandos. Un `customId` no puede repetirse en un mismo mensaje (Discord lo rechaza; hay un test que lo
  vigila).
- **Construir mensajes** (embeds, filas de botones) va a `src/paneles/`; los comandos solo reparten.
- **Dinero**: todo movimiento de monedas pasa por `src/systems/dinero.js` (cobrar, pagar, ingresar, sacar,
  transferir), que además lo apunta en el historial con su tipo. Solo `systems/casinoTransactions.js` (casino) y
  `adminPanel/bank.js` (ajustes de admin) escriben en la tabla `banco` por su cuenta.
- **Lógica compartida** entre comandos va a `src/systems/`; **llamadas a APIs externas** a `src/services/`.
  Las dependencias van `commands` → `systems`/`services`, nunca al revés.
- **Rutas**: siempre desde `src/core/paths.js`, nunca relativas al fichero o al directorio actual.
- **Base de datos**: ninguna tabla se crea desde un comando. Para cambiar el esquema, añadir una migración
  nueva `src/core/migrations/NNN_nombre.js` (nunca editar una ya aplicada).
- **Datos del servidor** (IDs de canales, roles, apodos): en la BD y editables desde el panel, no en el código.
- **Logs**: `const log = require("../../core/logger").createLogger("Módulo")`.
- Nada de escribir ficheros en la raíz del proyecto: datos en `data/`, logs en `logs/`, temporales
  en la carpeta temporal del sistema.
