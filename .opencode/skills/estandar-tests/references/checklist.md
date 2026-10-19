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
