# Reseñas de Plex — «Letterboxd» en el Duende

> **Diseño, sin implementar.** Sustituye a la idea original de la issue #536 (estrellas enteras, sin
> comentarios). Todo cuelga de `/plex` por botones: no hay comandos nuevos. Fecha: 2026-10-23.

## 1) Resumen

Cuando Tautulli da por terminada una película de alguien con Plex vinculado, el bot le manda **un DM** con la
portada del título y **estrellas de media en media**. Al pulsar una estrella se abre un **modal** con la nota ya
puesta, un «me gusta» opcional, el aviso de spoilers y un campo de opinión. Lo que se guarda aparece en
`/plex` → ⭐ Reseñas, cuenta en la media del servidor y **el Duende puede hablar de ello**.

Objetivo: que reseñar sea más fácil que ignorarlo. Un clic en el DM, dos si quieres escribir la opinión.

## 2) Lo que copiamos de Letterboxd

| Letterboxd | En el Duende |
|---|---|
| 5 estrellas con medias | 10 botones (½, ★, ★½ … ★★★★★) y nota en medias estrellas |
| Reseña con aviso de spoilers | Casilla ⚠️ en el modal; el texto queda detrás de un botón |
| «Me gusta» separado de la nota | Casilla ❤️ en el modal (puedes dar 2,5 y que te guste) |
| Diario con fecha real | La fecha de `plex_reproducciones.inicio`, sin pedirla |
| Watchlist | Ya existe: `/plex` → 📝 Quiero ver |
| Media del servidor y reparto de notas | Ficha del título: media, votos e histograma ½…5 |
| Mejor valoradas / populares | 🏆 Mejor valoradas (mínimo de votos) y 🆕 Últimas |
| Estadísticas y «Year in Review» | 📊 Mi cine + el Plex Wrapped que ya hay |
| Feed de amigos | Canal opcional de reseñas nuevas (fase 4) |
| Listas | Fase 4, lo último |
| Perfiles, seguimientos, comentarios anidados | **No**: el servidor ya es la red social; Discord ya tiene hilos |

## 3) Lo que copiamos de los bots de Discord

- **filmlinkd** (el bot de Letterboxd más usado): `/diary`, `/film`, `/logged`, `/roulette` y un **feed** de
  entradas del diario en un canal. De ahí salen el feed (fase 4), la ficha por título y la ruleta.
- **letterbotd** y los `letterboxd-discord-bot`: publican cada entrada nueva con **nota, reseña y ficha**. Confirman
  que lo que engancha es el aviso proactivo, no consultar a mano.
- Ninguno es un sistema de reseñas nativo: todos son puentes a Letterboxd. Aquí no hay Letterboxd al que
  apuntar, así que el diario vive en nuestra BD.

## 4) Decisiones cerradas

| Decisión | Valor |
|---|---|
| Nota | 1–5 estrellas **en medias** (se guarda en enteros de 1 a 10) |
| Unidad | **Película**; en fase 3, **temporada terminada** y serie completa. Nunca episodios |
| Qué cuenta como terminada | `visto = 1` **o** `porcentaje ≥ 90` |
| Desde cuándo se pregunta | Solo lo **empezado después de activar** (`plex.resenas_desde`): sin backfill |
| Repeticiones | Un aviso por título y persona; un revisionado no vuelve a preguntar |
| Tope | **5 DMs al día** por persona (configurable) |
| Texto | Opcional, máximo 500 caracteres |
| Visibilidad | Pública con nombre, con **🙈 Ocultar mis reseñas** |
| Moderación | 🚩 Reportar + 🗑️ Borrar desde el panel, con auditoría |
| Feed en canal | Apagado por defecto (fase 4) |

## 5) La experiencia

```
Tautulli: Alejandro termina Dune: Parte dos
        │
        ▼  (cron cada 30 min, después del historial)
DM:  🍿 Has terminado **Dune: Parte dos** (2024)
     ¿Qué te ha parecido?
     [ ½ ][ ★ ][ ★½ ][ ★★ ][ ★★½ ]
     [ ★★★ ][ ★★★½ ][ ★★★★ ][ ★★★★½ ][ ★★★★★ ]
     [ ⏭️ Ahora no ]
        │ pulsas ★★★★
        ▼
Modal:  Tu nota      (★, ★½, ★★ … ★★★★★, con ★★★★ marcada)
        ❤️ Me gusta  (casilla)
        ⚠️ Contiene spoilers (casilla)
        Tu opinión   (texto libre, 500)
        │ Guardar
        ▼
DM editado: ✅ Reseñada ★★★★ · [✏️ Cambiar] [🗑️ Borrar] [🌍 Ver la media]
```

## 6) Todo cuelga de `/plex`

```
/plex
└── ⭐ Reseñas
    ├── 📝 Mis reseñas ......... paginado; cada una abre su ficha
    ├── 🆕 Últimas ............. las del servidor, de la más reciente
    ├── 🏆 Mejor valoradas ..... mínimo de votos, con media
    ├── 🔍 Buscar .............. modal; abre la ficha de un título
    └── 📊 Mi cine ............. estadísticas personales (fase 3)
        │
        └── Ficha de título
            ├── ⭐ Puntuar / ✏️ Editar  → modal
            ├── 🗑️ Borrar
            ├── 🚩 Reportar
            ├── 📥 Pedir en Seerr (si no está en Plex)
            └── ⬅️ Volver
```

`/perfil` → 🏆 Rankings añade **⭐ Valoraciones** (mejor valoradas y quién más valora). Es el único sitio fuera de
`/plex`, porque ahí viven todos los rankings.

## 7) Datos

Migración **075** (la siguiente real; la última es la 074):

```sql
CREATE TABLE plex_resenas (
  guildId TEXT NOT NULL,
  userId TEXT NOT NULL,
  clave TEXT NOT NULL,          -- 'peli:<titulo normalizado>|<anio>' | 'serie:<titulo normalizado>[|t<n>]'
  tipo TEXT NOT NULL,           -- movie | show
  titulo TEXT NOT NULL,
  anio INTEGER,
  nota INTEGER NOT NULL,        -- medias estrellas: 1 = ½, 2 = ★, 10 = ★★★★★
  texto TEXT,                   -- NULL si solo nota
  spoilers INTEGER NOT NULL DEFAULT 0,
  me_gusta INTEGER NOT NULL DEFAULT 0,
  oculto INTEGER NOT NULL DEFAULT 0,
  creado_en INTEGER NOT NULL,
  actualizado_en INTEGER NOT NULL,
  PRIMARY KEY (guildId, userId, clave)
);
CREATE INDEX idx_plex_resenas_titulo ON plex_resenas (guildId, clave);
CREATE INDEX idx_plex_resenas_usuario ON plex_resenas (guildId, userId, actualizado_en DESC);

CREATE TABLE plex_resenas_pedidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- va en el customId del DM
  guildId TEXT NOT NULL,
  userId TEXT NOT NULL,
  clave TEXT NOT NULL,
  titulo TEXT NOT NULL,
  pedido_en INTEGER NOT NULL,
  decision TEXT,                          -- NULL | puntuada | pasada | cerrado
  UNIQUE (guildId, userId, clave)
);
```

- `plex_preferencias` gana `ocultar_resenas` (ALTER con `PRAGMA table_info`).
- Ajustes nuevos: `plex.resenas_activo`, `plex.resenas_max_dia`, `plex.resenas_min_votos`,
  `plex.resenas_desde`, `plex.resenas_canal`.
- Sin caché de medias: con 12 personas se calcula al vuelo.
- La clave estable es **título + año** (como los trofeos), no el `rating_key`, que cambia si se vuelve a añadir.

## 8) Piezas

| Pieza | Dónde |
|---|---|
| Lógica | `src/systems/plexResenas/` + fachada `plexResenas.js` |
| DM y modal | `src/discord/mensajes/resena.js` |
| Envío de DMs | `src/discord/envios/resenas.js` |
| Pantallas | `src/paneles/plexResenas.js` |
| Botones y modales | `src/commands/plex/plex.js` (`plex_resena_*`) |
| Cron | `src/app/tareas.js`, después de «Historial y logros de Plex» |
| Herramienta del Duende | `src/services/duende/herramientas/plex.js` |
| Panel admin | `src/adminPanel/plex/` → ⭐ Reseñas |
| `/avisos` | tipo `plex_resenas` en `avisosDm.TIPOS` |

## 9) Issues

| Issue | Título | Pts. | Depende |
|---|---|---|---|
| #564 | Refrescar las últimas 48 h del historial | 1 | — |
| #565 | Núcleo de reseñas con medias estrellas | 2 | #564 |
| #566 | DM al terminar con estrellas y opinión | 5 | #565 |
| #567 | Pantalla ⭐ Reseñas en `/plex` | 5 | #565 |
| #568 | Moderación y privacidad | 2 | #565, #567 |
| #569 | Rankings de valoraciones | 2 | #565 |
| #570 | El Duende y las reseñas | 2 | #565 |
| #571 | Panel admin ⭐ Reseñas | 2 | #565, #566 |
| #572 | Reseñar series y temporadas | 3 | #566 |
| #573 | Feed de reseñas en un canal | 2 | #567, #571 |
| #574 | 📊 Mi cine: diario y estadísticas | 3 | #565 |
| #575 | Listas de películas | 8 | #567 |
| #576 | 🎲 Ruleta de películas | 2 | #567 |

## 10) Fases

| Fase | Issues | Resultado | Estimación |
|---|---|---|---|
| 0 | #564 | El historial deja de perder finalizaciones | ½ día |
| 1 (MVP) | #565 → #566 → #567 → #568 | DM, nota, opinión y pantalla, ya usable | 4 días |
| 2 (social) | #569, #570, #571 | Rankings, Duende y ajustes | 1½ días |
| 3 (contenido) | #572, #574, #576 | Series, estadísticas y ruleta | 2½ días |
| 4 (opcional) | #573, #575 | Feed en canal y listas | 3½ días |

## 11) Riesgos

1. **El historial no se actualiza** (`INSERT OR IGNORE`): por eso 15a va primero.
2. **Texto libre**: reportar, borrar y auditoría desde el primer día; quitar menciones y enlaces.
3. **La nota solo se guarda al enviar el modal**: el modal abre con la estrella marcada y el texto es opcional.
4. **DMs cerrados**: se marca `cerrado` y se deja de intentar; se puede reseñar a mano desde `/plex`.
5. **Reinicios**: todo en BD, nada en memoria.
6. **Privacidad**: `ocultar_resenas` es un consentimiento aparte de «ocultar mis logros de Plex».

## 12) Tests

`tests/plexResenas.test.js` (núcleo, medias, privacidad, rankings) y `tests/plexResenasDm.test.js` (detección,
sin backfill, dedupe, tope, DMs cerrados, botones, modal, propiedad). Tautulli siempre con `jest.mock`.

## 13) Documentación al cerrar

`FUNCIONALIDADES.md` (sección 11 y `/avisos`), `docs/tecnico/PLEX_Y_SEERR.md` (sección nueva), `DEPLOY.md`
(migración 075), `CHANGELOG.md` y `TAREAS.md` (prueba manual en Discord).
