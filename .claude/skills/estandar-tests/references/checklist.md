# Checklist rápida de tests — El Duende

## Antes de escribirlo

- [ ] ¿Qué comportamiento quiero proteger?
- [ ] ¿Cuál es el camino feliz, el límite y el error?
- [ ] ¿Necesito BD, mocks, reloj o ficheros temporales?
- [ ] ¿El test pertenece a un archivo existente o a uno nuevo?
- [ ] ¿Hay un issue o una fase que referenciar en el `describe`?

## Mientras lo escribes

- [ ] `test(...)`, no `it(...)`.
- [ ] Nombre en español y orientado a comportamiento.
- [ ] `describe` por área, feature o issue.
- [ ] Arrange / Act / Assert claro.
- [ ] IDs únicos o limpieza en `beforeEach`.
- [ ] Datos preparados con SQL directo y helpers locales.
- [ ] Mocks en la frontera, no del módulo bajo test.
- [ ] Reloj y azar controlados.
- [ ] Sin red, Discord, BD real ni APIs reales.
- [ ] Sin `console.*`, `.only`, `.skip`, `test.failing` ni snapshots.
- [ ] Assertions sobre BD, saldo, inventario, fichero o payload.
- [ ] Caso de error comprueba que no hay efectos laterales.

## Limpieza

- [ ] `afterEach(() => jest.restoreAllMocks())`.
- [ ] `jest.useRealTimers()` si usaste fake timers.
- [ ] Restaurar `process.env` y `global.fetch`.
- [ ] Borrar directorios temporales en `afterAll`.
- [ ] Cerrar BDs independientes.
- [ ] Limpiar filas o cachés que puedan afectar a otros tests.

## Verificación

- [ ] `npx jest tests/tuArchivo.test.js`
- [ ] `npm test`
- [ ] `npm run check` si cambiaste código de producción
- [ ] Documentación actualizada si cambia el comportamiento

## Revisión

- [ ] ¿El test fallaría si se rompiera el comportamiento?
- [ ] ¿Hay un caso de límite y uno de error?
- [ ] ¿Se comprueba el efecto real y no solo la respuesta?
- [ ] ¿El test es independiente del orden?
- [ ] ¿Queda algún mock, timer o env sin restaurar?
- [ ] ¿Se respetan los límites de Discord y los `customId` únicos?
- [ ] ¿La cobertura nueva es de comportamiento, no de líneas ejecutadas?
- [ ] ¿El mock está en la frontera y no sustituye la lógica bajo test?
- [ ] ¿Se ha ejecutado `npm test` y, si aplica, `npm run check`?

## Definition of Done

Un cambio de tests está terminado cuando:

- [ ] El archivo está en `tests/` con el nombre correcto.
- [ ] El comentario de cabecera explica qué cubre y qué se mockea.
- [ ] Usa `test`, nombres en español y `describe` por área/issue.
- [ ] Cubre camino feliz, límites y errores/rollback relevantes.
- [ ] Asserta estado y efectos, no solo mensajes.
- [ ] No toca red, Discord, BD real ni APIs reales.
- [ ] Restaura mocks, timers, env, fetch y temporales.
- [ ] No tiene `.only`, `.skip`, `test.failing` ni `console.*`.
- [ ] `npm test` pasa.
- [ ] Si tocó código, `npm run check` pasa.
- [ ] La documentación asociada está actualizada.
