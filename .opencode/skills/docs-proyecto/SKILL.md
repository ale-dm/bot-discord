---
name: docs-proyecto
description: Qué documento de docs/ de El Duende hay que actualizar y cómo. Cárgala al cerrar cualquier cambio (para saber qué anotar) o cuando la tarea sea escribir o reorganizar documentación, planificación, decisiones o el changelog.
---

La documentación vive en `docs/` y en la raíz (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`). Todo en español, directo y con fecha absoluta (`AAAA-MM-DD`), nunca «ayer» o «la semana pasada».

## Qué tocar según el cambio

| Si el cambio… | Actualiza |
|---|---|
| Sea cual sea | `docs/CHANGELOG.md`: entrada nueva arriba, `## AAAA-MM-DD (tema)`, viñetas con emoji y negrita en lo que cambia, y una última línea con migraciones y el resultado real de `npm run check`. |
| Cambia lo que ve o puede hacer el usuario | `docs/FUNCIONALIDADES.md`, en la sección del área (mantén el índice). |
| Hay que probarlo a mano en Discord | `docs/planificacion/TAREAS.md`, en la tarea `T-NN` abierta o en una nueva, con pasos y resultado esperado. |
| Añade migración, variable de entorno o cambio de despliegue | `docs/DEPLOY.md`: `### Qué (migración NNN, AAAA-MM-DD)`; y `.env.example` si hay variable nueva (nunca `.env`). |
| Cierra o cambia el estado de una tarea del plan | `docs/SIGUIENTES_PASOS.md` y el documento de `docs/planificacion/` que corresponda (`PLAN_ISSUES.md`, `FEATURES.md`…). |
| Resuelve o descubre un problema conocido | `docs/planificacion/ERRORES.md` o `DEUDA_TECNICA.md`. |
| Cambia agentes, skills o el flujo de trabajo | `AGENTS.md` (tabla de enrutado) y, si aplica, `CONTRIBUTING.md`. |

## Reglas

1. **No inventes estado**: cifras, números de tests, issues o fechas se comprueban en el repositorio o en la salida real de un comando.
2. **No dupliques**: si algo ya está explicado en otro documento, enlázalo en vez de copiarlo. Las reglas del repositorio viven solo en `AGENTS.md`.
3. Las ideas de funcionalidad viven en Issues con label `feature-idea`, no en markdown nuevo.
4. Decisiones del orquestador: contexto, opciones, decisión, consecuencias y siguiente paso.
5. Respeta la estructura y los encabezados que ya tiene cada fichero; no reordenes secciones sin motivo.
6. Cambios solo de documentación: rama `docs/algo-corto` (carga `git-pr` si hay que hacer commit).
