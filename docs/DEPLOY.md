# Despliegue

El bot corre en Docker en el servidor **elements** (OpenMediaVault + Portainer), gestionado como
stack de Portainer. En el servidor no se usa git: el código se copia a mano y la imagen se construye allí.

Todo lo del bot en el servidor vive en **`/compose/duende-bot`** (y solo ahí):

```
/compose/duende-bot/
├── .env       configuración y claves (plantilla: .env.example)
├── data/      BD y JSON del Duende → /app/data en el contenedor
└── logs/      logs → /app/logs en el contenedor
```

## Primera vez

1. Crear las carpetas y copiar el `.env`:

       mkdir -p /compose/duende-bot/data /compose/duende-bot/logs
       # copiar el .env a /compose/duende-bot/.env

2. Copiar el código al servidor (cualquier carpeta de trabajo) y construir la imagen desde ella:

       docker build -t el-duende:latest .

   El build necesita internet: descarga el modelo de voz (~40 MB) y las dependencias.

3. En Portainer → Stacks → Add stack → nombre `el-duende`, pegar `deploy/portainer-stack.yml` y desplegar.

4. Comprobar: `docker logs -f duende-bot` (muestra avisos y errores) y, dentro de Discord, `/diagnostico`.

## Actualizar

**En el PC** (Git Bash, en la carpeta del repo), con el bot local parado (si no, con el mismo token
responderían los dos):

    npm run check
    tar --exclude=./node_modules --exclude=./data --exclude=./logs --exclude=./models --exclude=./vosk/.venv \
        --exclude=./.env --exclude=./.git --exclude=./coverage -czf ../el-duende.tar.gz .
    scp ../el-duende.tar.gz usuario@elements:/compose/duende-bot/

**En el servidor** (`ssh usuario@elements`):

1. Parar el bot y hacer **copia de la BD**:

       docker stop duende-bot
       cp /compose/duende-bot/data/banco.db /compose/duende-bot/data/banco.db.bak-$(date +%F)

2. Código nuevo **en una carpeta limpia** (si se pega encima, ficheros viejos acaban en la imagen) y build:

       rm -rf /compose/duende-bot/codigo && mkdir /compose/duende-bot/codigo
       tar -xzf /compose/duende-bot/el-duende.tar.gz -C /compose/duende-bot/codigo
       cd /compose/duende-bot/codigo && docker build -t el-duende:latest .

3. En Portainer → Stacks → `el-duende` → **Update the stack** (o Containers → `duende-bot` → **Recreate**).
   Ojo: `docker restart` / `docker start` **no** sirven, siguen usando la imagen anterior.
4. `docker logs -f duende-bot` y probar en Discord (lista en [TAREAS.md](planificacion/TAREAS.md#t-02-desplegar-y-probar-en-discord)).

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
