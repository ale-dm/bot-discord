# Ciclos de dependencias (#479)

Se miden con `madge` (`npm run ciclos`; también lo comprueba `tests/ciclos.test.js`). Un ciclo nuevo hace fallar el test; un
ciclo que ya no existe también, así que la lista solo puede bajar. La lista exacta está en `ciclos-permitidos.json`.

- Ciclos actuales: **8**
- `require` dentro de funciones en `src/` (recuento por indentación): **126** (32 en `core/tareas.js`).

1. `juegos/apuestas/quiniela.js` ↔ `juegos/apuestas/quiniela/botones.js`
2. `paneles/juegos.js` ↔ `paneles/misJugadas.js`
3. `systems/dinero.js` ↔ `systems/prestamos.js`
4. `systems/presencia.js` ↔ `systems/sonidos.js`
5. 4 ciclos del grupo `plexTrofeos` / `plexHistorial` / `plexGordos` / `achievementsSystem`

Cada refactor de cimientos (#471–#480) debe reducir esta lista y actualizar este fichero y el JSON.
