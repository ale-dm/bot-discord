# Despliegue

El bot corre en Docker en el servidor **elements** (OpenMediaVault + Portainer), como stack de Portainer
**desde el repositorio de GitHub** (`ale-dm/bot-discord`, privado): Portainer clona el repo y construye la
imagen él mismo. En el servidor no hay que copiar código a mano.

Los datos del bot en el servidor viven en **`/compose/duende-bot`** (y solo ahí):

```
/compose/duende-bot/
├── data/      BD, backups y JSON del Duende → /app/data en el contenedor
└── logs/      logs → /app/logs en el contenedor
```

La configuración (`.env`) se guarda en el propio stack de Portainer, no en un fichero del servidor.

## Primera vez

1. **Token de GitHub** para que Portainer pueda leer el repo privado: GitHub → Settings → Developer
   settings → Personal access tokens → **Fine-grained tokens** → Generate. Repository access: *Only select
   repositories* → `bot-discord`. Permissions → Repository → **Contents: Read-only**. Copiar el token.
2. Carpetas de datos: `mkdir -p /compose/duende-bot/data /compose/duende-bot/logs`.
3. Portainer → Stacks → **Add stack** → nombre `el-duende` → **Repository**:
   - Repository URL: `https://github.com/ale-dm/bot-discord`
   - Repository reference: `refs/heads/main`
   - Compose path: `deploy/portainer-stack.yml`
   - **Authentication**: activado; usuario `ale-dm` y el token del paso 1.
   - Environment variables → **Load variables from .env file** → subir el `.env` (Portainer las guarda en `stack.env`, en la raíz del repo clonado).
4. **Deploy the stack**. La primera vez tarda varios minutos (dependencias del sistema, modelo de voz de
   ~40 MB, módulos de Node).
5. Comprobar: `docker logs -f duende-bot` y, en Discord, `/diagnostico`.

## Actualizar

1. En el PC: `npm run check` y `git push`. Para probar en Discord, con el bot local parado (con el mismo
   token responderían los dos).
2. **Copia de la BD** en el servidor:

       cp /compose/duende-bot/data/banco.db /compose/duende-bot/data/banco.db.bak-$(date +%F)

3. Portainer → Stacks → `el-duende` → **Pull and redeploy**. Baja el último commit de `main`, reconstruye
   la imagen (`pull_policy: build`) y recrea el contenedor. (`docker restart` no sirve: sigue con la
   imagen anterior.)
4. `docker logs -f duende-bot` y probar en Discord (lista en [TAREAS.md](planificacion/TAREAS.md#t-02-desplegar-y-probar-en-discord)).

Para cambiar una variable del `.env`: editarla en las Environment variables del stack y **Update the stack**.

Opcional: en el stack, **GitOps updates** → Polling (p. ej. cada 5 min) despliega solo cada `git push` a
`main`. Mejor no activarlo si se sube a menudo sin probar.

Al arrancar se aplican solas las **migraciones** de BD pendientes (`src/core/migrations/`); en
`docker logs` / `logs/app-log.txt` aparece cada una como `[Migraciones] Aplicada NNN_...`.

### Primera actualización a la versión con migraciones (2026-09-24)

Los apodos del Duende ya no están en el código sino en la BD. Para no perderlos, **antes de arrancar
esta versión** hay que copiar `data/duende-apodos.seed.json` del repo local a
`/compose/duende-bot/data/`. Al arrancar se importa (sin pisar apodos que ya existan) y se renombra a
`.importado`. Si se olvida, el Duende funciona pero sin apodos: basta con copiarlo después y reiniciar,
o añadirlos en Panel admin → Config Global → Duende → Apodos.

### Actualización con el Duende en la BD (migraciones 007 y 008)

- **007** borra 19 tablas antiguas que no usa nada (juego de roles, prototipo del pase de batalla...).
  Antes guarda su contenido en `data/backups/tablas-antiguas-AAAA-MM-DD.json`.
- **008** crea las tablas del Duende. Al arrancar, `data/duende-personalities.json` y
  `data/duende-config.json` (que ya están en el servidor) se importan a la BD y se renombran a
  `.importado`: no hay que copiar nada. En el log: `Importadas N personalidades y N perfiles`.
- Los perfiles antiguos iban por username; al conectar se vinculan a su Discord ID
  (`Perfiles del Duende: N vinculados`). Los que no se encuentren se vinculan cuando esa persona hable.
- Para volver atrás: restaurar el backup de la BD y quitar el `.importado` a los dos JSON.

### Recompensa diaria, avisos y alertas (migración 011, 2026-10-02)

- **011** crea `recompensa_diaria` (🎁 Diario) y `seerr_avisos` (peticiones de Seerr ya avisadas), y añade
  `recordado` a `apuestas_usuario`. No hay que copiar nada.
- La primera comprobación de Seerr tras desplegar solo fija la base (`Avisos de pedidos: base fijada...`): lo
  que ya estaba disponible no se avisa.
- Las alertas por DM van, sin configurar nada, al **dueño del servidor**. Para cambiarlo: `/paneladmin` →
  🩺 Sistema → 🔔 Alertas.
- Al conectar, el bot prueba el modelo de Gemini (`Modelo de Gemini ...: funciona y usa herramientas`).

### Retos entre jugadores (migración 012, 2026-10-02)

- **012** crea `retos` y `retos_participantes` (⚔️ Retos en `/juegos`). No hay que copiar nada.
- El comando `/juegos` cambia (opción `seccion: ⚔️ Retos`): se vuelve a registrar solo al arrancar.
- Si hay reglas de canales/roles (ACL) sobre `juegos`, también valen para los botones de los retos.

### Logros de Plex (migración 013, 2026-10-02)

- **013** crea `plex_reproducciones` (copia del historial de Tautulli) y `plex_sync`. No hay que copiar nada.
- Como mucho media hora después de arrancar (o al pulsar Panel admin → Plex → 📼 Sincronizar historial) se importa el historial entero
  de Tautulli: según cuánto haya, puede tardar un poco (en el log, `Historial de ...: N reproducciones nuevas ...
  (primera importación)`). Los logros de Plex que ya tenía cada vinculado se anuncian en el canal de logros, un
  mensaje por persona.

### Voz con DAVE y Node 22 (2026-10-02)

- Discord exige DAVE (cifrado de extremo a extremo) en los canales de voz desde marzo de 2026. El bot usa ahora
  `@discordjs/voice` 0.19.2, que lo trae, y la imagen pasa a **`node:22-bookworm-slim`**. Hay que **reconstruir la
  imagen** (`docker build`); no basta con reiniciar el contenedor.
- Para comprobarlo: `/tts hola` en un canal de voz. Si sigue fallando, con el nivel de log en `debug` (🩺 Sistema) sale
  el paso a paso de la conexión (`[Duende:Voz]`).

### Voz con Gemini 3.8 TTS (2026-10-02)

- Si en las variables del stack está `GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts`, **quitarla** (o poner
  `gemini-3.8-flash-tts`): ese modelo responde sin audio. Aunque se deje, el bot prueba también el nuevo.
- Para comprobarlo sin entrar a un canal de voz: `/paneladmin` → 🩺 Sistema → 🔊 Probar voz (adjunta el audio).

### Anuncio de logros (migración 014, 2026-10-02)

- **014** pone `874776941000020018` (el canal de las subidas de nivel) como canal de logros en el servidor que lo usa
  para los niveles (en el log, `...: los logros se anuncian en 874776941000020018`). Si sale el aviso de que ningún
  servidor lo usa, ponerlo a mano en `/paneladmin` → ⚙️ Config Global → 🏅 Logros.
- Desde esta versión se anuncian también los logros del casino y la cripto (antes se completaban sin aviso).

Al arrancar, el contenedor registra los slash commands (los nuevos o eliminados aparecen solos),
arranca el servidor de voz (Vosk) y después el bot. Si el bot se reinició con partidas de casino
a medias, devuelve lo apostado.

## Qué hace el contenedor

- `deploy/docker-entrypoint.sh`, bajo `tini`: registra comandos → Vosk en segundo plano → bot.
- `docker stop` y las actualizaciones lo paran limpio (vacía logs, cierra la BD). Si el bot se cae por
  un error no controlado, sale con código 1 y Docker (`restart: unless-stopped`) lo vuelve a levantar.
- Voz: `STT_ENABLED=0` en `.env` para no arrancar Vosk.
- Liquidación de apuestas automática cada hora (minuto 15); `ODDS_API_KEY` es obligatoria.
- Copia de la BD cada día a las 04:30 en `data/backups/banco-AAAA-MM-DD.db` (se guardan 7, `BACKUP_KEEP`).
  Está en el mismo disco: conviene copiar esa carpeta a otro sitio (ver
  [DT-01](planificacion/DEUDA_TECNICA.md#dt-01-las-copias-de-seguridad-están-en-el-mismo-disco)).
  Para restaurar: parar el stack, sustituir `data/banco.db` por la copia y borrar `banco.db-wal` / `banco.db-shm`.

## Logs

- `logs/app-log.txt` (todo), `warn-log.txt` y `error-log.txt`, con rotación (5 MB × 5 ficheros por defecto).
- `LOG_LEVEL` (por defecto `info`; `debug` para detalle paso a paso) y `LOG_CONSOLE_LEVEL` (por defecto
  `warn`: lo que sale en `docker logs`). El nivel también se cambia en caliente con `/diagnostico nivel_log`.
- Las claves de API y el token se ocultan automáticamente.

## Probar la imagen en local

    docker compose -f deploy/docker-compose.local.yml up --build

Usa `.env`, `data/` y `logs/` del propio repo.

## Variables antiguas que se pueden quitar del `.env`

- `OPENAI_API_KEY` — ya no se usa (la voz va con Vosk local).
- `XP_SLOWED_USER_ID` / `XP_SLOWED_USER_COST_MULTIPLIER` — solo se leían una vez para sembrar el
  multiplicador de XP de un usuario; ahora se gestiona en Panel admin → Niveles → Usuarios.
