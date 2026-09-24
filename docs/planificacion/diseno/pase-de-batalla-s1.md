# Pase de Batalla — Temporada S1 (15 días, 20 niveles)

## 1) Resumen de diseño

- Duración: **15 días**
- Niveles: **20**
- Moneda de recompensa: **TTCL Coins**
- Filosofía: progresión atractiva + permisos controlados + trazabilidad total.
- Todos los perks de temporada son **temporales** y se revocan al reset.

---

## 2) Progresión de niveles

### XP de Pase por nivel

Fórmula sugerida:

- `XP_nivel(n) = 280 + (n - 1) * 40`

Total aproximado para completar temporada:

- `sum_{n=1..20} XP_nivel(n) = 13,200 XP`

### Fuentes de XP Pase (con caps)

- Mensaje válido XP: +2 BP XP (cap diario 120)
- Voz activa: +1 BP XP/min (cap diario 120)
- Minijuegos/casino: +8 por partida cerrada (cap diario 260)
- Victoria casino: +4 extra (incluido en cap casino)
- Cripto compra/venta: +6 por operación (cap diario 180)
- Apuestas deportivas resueltas: +12 (cap diario 180)
- Tienda compra: +8 (cap diario 80)
- Logro completado: +20 (cap diario 120)

### Misiones diarias (3 activas)

- 3 misiones al día x 70 BP XP = **210 BP XP/día**
- Reset diario UTC
- Ejemplos:
  - Juega 5 partidas casino
  - Haz 2 operaciones cripto
  - Envía 25 mensajes válidos

---

## 3) Recompensas por nivel (S1)

> Formato: Nivel | TTCL | Recompensa principal | Límites/Notas

| Nivel | TTCL | Recompensa principal | Límites / Notas |
|---|---:|---|---|
| 1 | 80 | Inicio de temporada | Solo TTCL |
| 2 | 120 | Bonus XP normal +200 | Solo TTCL + XP |
| 3 | 160 | Rol: `bp_reaccionar` (añadir reacciones) | No en canales staff |
| 4 | 200 | Bonus XP normal +300 | Solo TTCL + XP |
| 5 | 240 | Rol: `bp_apodo_propio` (cambiar apodo propio) | Cooldown 10 min |
| 6 | 300 | Rol: `bp_panel_sonidos_basic` | Sonidos preaprobados |
| 7 | 360 | Bonus XP normal +500 | Solo TTCL + XP |
| 8 | 430 | Rol: `bp_mover_voz` (mover gente en voz) | 8 usos/día, no staff |
| 9 | 500 | Rol: `bp_expulsar_voz` (echar de voz) | 6 usos/día, no staff |
| 10 | 600 | Bonus XP normal +800 | Solo TTCL + XP |
| 11 | 700 | Rol: `bp_stickers_custom` | 1 upload/día |
| 12 | 820 | Rol: `bp_emojis_custom` | 1 upload/día |
| 13 | 950 | Bonus XP normal +1200 | Solo TTCL + XP |
| 14 | 1100 | Rol: `bp_apodo_ajeno` (cambiar apodos ajenos) | 3 usos/día, no staff |
| 15 | 1250 | Rol: `bp_silenciar_voz` | 4 usos/día, máx 10 min |
| 16 | 1400 | Rol: `bp_ensordecer_voz` | 4 usos/día, máx 10 min |
| 17 | 1600 | Bonus XP normal +1800 | Solo TTCL + XP |
| 18 | 1800 | Rol cosmético `bp_elite_s1` | Exclusivo temporada |
| 19 | 2100 | Rol: `bp_echar_servidor` (kick) | 1 uso/día, no staff, motivo obligatorio |
| 20 | 2500 | Rol: `bp_panel_sonidos_custom` + **Bonus final 2000 TTCL** | 2 uploads/día, validación |

**Total TTCL base niveles 1-20:** 16,210 TTCL  
**Total TTCL con bonus final:** 18,210 TTCLcual

---

## 4) Matriz de permisos y antiabuso

### Reglas globales

- Inmunes: owner, admins, mods, bots, roles protegidos.
- No ejecutar acciones en canales/categorías protegidas.
- Auditoría obligatoria por acción sensible.
- Cooldown por usuario + cooldown por objetivo.
- Revocación instantánea en panel admin.

### Límites sugeridos por acción

- `bp_mover_voz`: 8/día, cooldown 90s
- `bp_expulsar_voz`: 6/día, cooldown 120s
- `bp_apodo_ajeno`: 3/día, cooldown 300s
- `bp_silenciar_voz`: 4/día, cooldown 180s, duración máx 10 min
- `bp_ensordecer_voz`: 4/día, cooldown 180s, duración máx 10 min
- `bp_echar_servidor`: 1/día, cooldown 12h, motivo obligatorio >= 8 chars
- `bp_emojis_custom`: 1 subida/día
- `bp_stickers_custom`: 1 subida/día
- `bp_panel_sonidos_custom`: 2 subidas/día

---

## 5) UX / Comandos

### Usuario

- `/pase`
  - resumen de nivel y barra de progreso
  - próxima recompensa
  - tiempo restante de temporada
- `/pase recompensas`
  - tabla visual 1–20
- `/pase reclamar`
  - reclama nivel actual
- `/pase misiones`
  - diarias activas + progreso
- `/pase top`
  - ranking de nivel de pase

### Admin

- `/paneladmin` → sección `Pase`
  - activar/desactivar pase
  - fecha fin temporada
  - XP por nivel (base/incremento)
  - caps diarios por categoría
  - editar recompensas por nivel
  - roles protegidos e inmunidades
  - canal de anuncios
  - botón `reset temporada`

---

## 6) Integración técnica propuesta

### Archivos nuevos

- `src/systems/battlePassSystem.js`
- `src/commands/progresion/pase.js`

### Integraciones

- `src/systems/casinoTransactions.js` → `battlePass.applyEvent(..., "casino_match")`, `"casino_win"`
- `src/commands/economia/cripto.js` → `"cripto_trade"`
- `src/commands/economia/tienda.js` → `"tienda_buy"`
- `src/systems/xpSystem.js` → `"xp_message"`, `"xp_voice"`
- `index.js` → router de botones `pase_...`
- `src/systems/guildSettings.js` → keys `pase.*`
- `src/adminPanel/settings.js` → panel de configuración de pase

### Esquema DB mínimo

- `battlepass_seasons` (guildId, seasonId, startAt, endAt, active)
- `battlepass_rewards` (guildId, seasonId, level, type, payload)
- `battlepass_progress` (guildId, seasonId, userId, xp, level, updatedAt)
- `battlepass_claims` (guildId, seasonId, userId, level, claimedAt)
- `battlepass_daily_caps` (guildId, seasonId, userId, category, dayKey, amount)
- `battlepass_action_limits` (guildId, seasonId, userId, action, dayKey, used)

---

## 7) Visual elegante (Discord embed)

### Embed principal `/pase`

- Título: `🛡️ Pase de Batalla S1`
- Subtítulo: `Temporada termina en 6d 14h`
- Barra:
  - `██████░░░░ 63%`
- Campos:
  - Nivel actual
  - XP actual / XP próximo nivel
  - Próxima recompensa
  - Recompensas pendientes por reclamar
- Botones:
  - `🎁 Reclamar`
  - `📜 Ver niveles`
  - `🧩 Misiones`
  - `🏆 Top`

---

## 8) Política de reset de temporada

Al finalizar la temporada (cada 15 días):

1. Se desactivan/revocan roles temporales de pase.
2. Se congela ranking de temporada (snapshot opcional).
3. Se crea temporada nueva con nivel 1 para todos.
4. Se mantienen estadísticas históricas (opcional).

---

## 9) Recomendación de lanzamiento

- Semana 1: activar con caps conservadores.
- Semana 2: ajustar TTCL y caps según telemetría.
- Publicar changelog de temporada + reglas de uso de perks.

---

## 10) Nota de seguridad

Permisos críticos (`kick`, `mute/deafen`, `rename ajeno`) deben estar además protegidos por:

- rol de pase + validación backend,
- lista de inmunidad,
- anti-spam,
- auditoría permanente,
- revocación inmediata desde panel admin.
