# Ciclos de dependencias (#479)

Se miden con `madge` (`npm run ciclos`; también lo comprueba `tests/ciclos.test.js`). Un ciclo nuevo hace fallar el test; un
ciclo que ya no existe también, así que la lista solo puede bajar. La lista exacta está en `ciclos-permitidos.json`.

- Ciclos actuales: **6** (#474 quitó el de la quiniela; #499 quitó `presencia` ↔ `sonidos`: la presencia de /conectar mira quién ocupa el audio en `systems/ocupacion.js`, sin cargar esos módulos)
- `require` dentro de funciones en `src/` (recuento por indentación): **59** (eran 126; `app/tareas.js`, `herramientas/` y `perfil/dinero.js` ya no tienen).

1. `paneles/juegos.js` ↔ `paneles/misJugadas.js`
2. `systems/dinero.js` ↔ `systems/prestamos.js`
3. 4 ciclos del grupo `plexTrofeos` / `plexHistorial` / `plexGordos` / `achievementsSystem`

Los refactors de cimientos (#471–#480) ya están hechos y bajaron la lista de 12 a 6. A partir de ahora, cualquier cambio que
añada o quite un ciclo debe actualizar este fichero y `ciclos-permitidos.json` (el test `tests/ciclos.test.js` lo comprueba).
