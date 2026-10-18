# Documentación

| Documento | Para qué |
|---|---|
| [SIGUIENTES_PASOS.md](SIGUIENTES_PASOS.md) | **Empezar aquí** si coges el proyecto: dónde está, qué hacer primero, qué comprobar con datos reales y por dónde seguir |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | Qué hace el bot: todos los comandos, sistemas, tareas programadas y variables de configuración |
| [DEPLOY.md](DEPLOY.md) | Desplegar y actualizar en el servidor (Docker / Portainer), logs y backups |
| [CHANGELOG.md](CHANGELOG.md) | Historial de cambios |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Flujo de trabajo: ramas, commits, PRs, CI y protección de ramas |
| [../README.md](../README.md) | Puesta en marcha en local, estructura del código y convenciones |

## Técnico

| Documento | Para qué |
|---|---|
| [tecnico/PLEX_Y_SEERR.md](tecnico/PLEX_Y_SEERR.md) | Cómo funciona la integración con Plex (Tautulli) y Seerr |
| [tecnico/MEDICION_BD.md](tecnico/MEDICION_BD.md) | Medición de la BD con volumen realista (#281): consultas, planes e índices |

## Planificación

Lo que falta por hacer, separado por tipo. Cada entrada tiene un ID para poder referirse a ella.

| Documento | Qué contiene | IDs |
|---|---|---|
| [planificacion/PLAN_ISSUES.md](planificacion/PLAN_ISSUES.md) | El plan de las 185 issues (fases 0 a 15) y los refactors de cimientos: **terminado y cerrado** | `#NNN` |
| [planificacion/TAREAS.md](planificacion/TAREAS.md) | Tareas manuales: subir a git, desplegar, probar en Discord | `T-xx` |
| [planificacion/ERRORES.md](planificacion/ERRORES.md) | Fallos encontrados que aún no están corregidos (casi siempre, pendientes de una decisión) | `E-xx` |
| [planificacion/DEUDA_TECNICA.md](planificacion/DEUDA_TECNICA.md) | Problemas del código y los datos que ya existen, con prioridad y propuesta | `DT-xx` |
| [planificacion/FEATURES.md](planificacion/FEATURES.md) | Redirección: las ideas son issues con la etiqueta `feature-idea` (por área y esfuerzo) | — |
| [planificacion/CICLOS.md](planificacion/CICLOS.md) | Ciclos de dependencias entre módulos (#479), medidos con `madge` | — |
| [planificacion/MODALES.md](planificacion/MODALES.md) | Análisis de los modales y propuestas de mejora (selectores, radios, horas) | — |
| [planificacion/PUNTUACION.md](planificacion/PUNTUACION.md) | Línea base (2026-10-10) para comparar la calidad del código con la misma escala | — |
| [planificacion/diseno/](planificacion/diseno/) | Diseños detallados: pase de batalla y reorganización de paneles | |

Al terminar algo: borrarlo del documento de planificación y apuntarlo en el CHANGELOG.
