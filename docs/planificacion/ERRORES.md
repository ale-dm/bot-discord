# Errores conocidos

Fallos concretos encontrados en las revisiones que **aún no están corregidos**, normalmente porque hace
falta decidir cómo debe funcionar. Los ya corregidos están en el [CHANGELOG](../CHANGELOG.md) (sección
"Errores corregidos" de cada revisión). La deuda técnica está en [DEUDA_TECNICA.md](DEUDA_TECNICA.md).

Al corregir uno: borrarlo de aquí y apuntarlo en el CHANGELOG.

**Gravedad:** 🔴 pierde dinero o datos · 🟠 comportamiento incorrecto · 🟢 detalle.

Encontrados en el análisis de paneles del 2026-09-25 ([diseno/reorganizacion-paneles.md](diseno/reorganizacion-paneles.md)).

| ID | Error | Área | Gravedad | Falta |
|---|---|---|---|---|
| [E-14](#e-14-panel-cuenta-como-inactivo-a-quien-sí-está-activo) | `/panel` cuenta como inactivo a quien sí está activo | Admin | 🟢 | Nada |
| [E-15](#e-15-panel-relaciona-objetos-e-historial-por-el-nombre) | `/panel` relaciona objetos e historial por el nombre | Admin | 🟢 | Nada |

---

## E-14 `/panel` cuenta como inactivo a quien sí está activo

**Qué pasa.** "Inactivos (+30 días)" une `banco` con todo `historial` y cuenta a cualquiera que tenga
**algún** movimiento de hace más de 30 días, aunque también los tenga recientes. En la práctica sale casi
todo el mundo.
**Propuesta.** Usar el movimiento más reciente de cada uno (`MAX(fecha)`). Si se borra `/panel` (ver
[DT-13](DEUDA_TECNICA.md#dt-13-restos-sin-uso-de-versiones-anteriores)), no hace falta.

## E-15 `/panel` relaciona objetos e historial por el nombre

**Qué pasa.** "Objetos nunca usados" y "Top objetos más consumidos" buscan el nombre del objeto dentro de la
descripción de cada movimiento negativo (`LIKE '%nombre%'`). Un objeto llamado "Rol" coincidiría con
cualquier movimiento que contenga "rol". Además, lo que se cuenta son compras, no usos.
**Propuesta.** Contar desde `inventario` (compras) y, si interesan los usos, apuntarlos al usar un objeto. Lo
mismo que en E-14: si se borra `/panel`, no hace falta.
