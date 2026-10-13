# Ciclos de dependencias (#479)

Se miden con `madge` (`npm run ciclos`; también lo comprueba `tests/ciclos.test.js`). Un ciclo nuevo hace fallar el test; un
ciclo que ya no existe también, así que la lista solo puede bajar. La lista exacta está en `ciclos-permitidos.json`.

- Ciclos actuales: **7** (#474 quitó el de la quiniela)
- `require` dentro de funciones en `src/` (recuento por indentación): **126** (32 en `core/tareas.js`).

1. `paneles/juegos.js` ↔ `paneles/misJugadas.js`
2. `systems/dinero.js` ↔ `systems/prestamos.js`
3. `systems/presencia.js` ↔ `systems/sonidos.js`
4. 4 ciclos del grupo `plexTrofeos` / `plexHistorial` / `plexGordos` / `achievementsSystem`

Cada refactor de cimientos (#471–#480) debe reducir esta lista y actualizar este fichero y el JSON.
