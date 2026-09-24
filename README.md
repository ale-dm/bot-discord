# El Duende

Bot de Discord para un grupo de amigos: un personaje con IA (Gemini) que participa en el chat y
habla por voz, XP y niveles, logros, economía con tienda, casino, apuestas de fútbol reales,
criptomonedas e integración con Plex/Seerr.

- **Qué hace y todos sus comandos:** [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md)
- **Despliegue (Docker / Portainer):** [docs/DEPLOY.md](docs/DEPLOY.md)
- **Historial de cambios:** [docs/CHANGELOG.md](docs/CHANGELOG.md)
- **Qué falta:** [tareas](docs/planificacion/TAREAS.md) · [errores conocidos](docs/planificacion/ERRORES.md) · [deuda técnica](docs/planificacion/DEUDA_TECNICA.md) · [ideas de features](docs/planificacion/FEATURES.md)
- **Índice de toda la documentación:** [docs/README.md](docs/README.md)

## Puesta en marcha (desarrollo)

```bash
npm install
cp .env.example .env        # y rellenar TOKEN, CLIENT_ID, GUILD_ID, GOOGLE_API_KEY, ODDS_API_KEY
npm run stt:setup           # solo la primera vez: Python + modelo de voz (Windows)
npm start                   # servidor de voz + registro de comandos + bot
```

Otros comandos: `npm run start:bot` (sin voz) · `npm test` · `npm run db:check` · `npm run db:backup` ·
`npm run commands` (solo registrar los slash commands) · `npm run stt:test ruta.wav`.

Antes de subir cambios: `npm run check` (ESLint + Prettier + tests). `npm run lint:fix` y `npm run format`
corrigen lo automático.

## Estructura

```
el-duende/
├── src/
│   ├── index.js            Arranque: carga comandos, eventos de Discord y tareas programadas
│   ├── core/               Infraestructura común (sin lógica del bot)
│   │   ├── paths.js          Rutas del proyecto (data/, logs/, models/, commands/)
│   │   ├── db.js             Conexión SQLite (data/banco.db)
│   │   ├── logger.js         Logs con niveles, rotación y ocultación de secretos
│   │   ├── componentRouter.js  Enruta botones/menús/formularios al módulo que los declara
│   │   ├── interactionLog.js   Registro uniforme de interacciones y tareas
│   │   ├── migrations/       Esquema de la BD: migraciones numeradas que se aplican solas al arrancar
│   │   └── registerCommands.js Registra los slash commands en Discord
│   ├── commands/           Un fichero por slash command, agrupados por tema
│   │   ├── duende/           /duende /ia /imagen /bola8 /javier
│   │   ├── voz/              /tts /escuchar
│   │   ├── casino/           /blackjack /tragaperras /ruleta /adivinar /ppt
│   │   ├── apuestas/         /apuestas /quiniela /misapuestas /pagarapuestas
│   │   ├── economia/         /banco /tienda /objeto /inventario /usar /cripto /ttcl-diagnostico
│   │   ├── progresion/       /nivel /logros /perfil
│   │   ├── admin/            /paneladmin /panel /diagnostico
│   │   └── general/          /ayuda /ping
│   ├── adminPanel/         Secciones de /paneladmin (banco, niveles, ajustes, Plex, Seerr, apodos y
│   │                         perfiles del Duende, auditoría)
│   ├── systems/            Lógica del bot que usan varios comandos
│   │                         XP, logros, apodos, ajustes por servidor, auditoría, transacciones del
│   │                         casino, partidas en curso, vínculos de Plex, backups, reglas del blackjack,
│   │                         cobro de la tienda; duende/ (memoria, perfiles, personas) y cripto/
│   │                         (mercado y gráficos)
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
  `customId` que atiende (ver `src/core/componentRouter.js`).
- **Lógica compartida** entre comandos va a `src/systems/`; **llamadas a APIs externas** a `src/services/`.
  Las dependencias van `commands` → `systems`/`services`, nunca al revés.
- **Rutas**: siempre desde `src/core/paths.js`, nunca relativas al fichero o al directorio actual.
- **Base de datos**: ninguna tabla se crea desde un comando. Para cambiar el esquema, añadir una migración
  nueva `src/core/migrations/NNN_nombre.js` (nunca editar una ya aplicada).
- **Datos del servidor** (IDs de canales, roles, apodos): en la BD y editables desde el panel, no en el código.
- **Logs**: `const log = require("../../core/logger").createLogger("Módulo")`.
- Nada de escribir ficheros en la raíz del proyecto: datos en `data/`, logs en `logs/`, temporales
  en la carpeta temporal del sistema.
