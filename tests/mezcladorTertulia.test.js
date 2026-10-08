// Mezclador de la tertulia (#16): varias personas a la vez se suman en un único flujo de 20 ms a 16 kHz, sin pasarse del
// rango de 16 bits, sin retraso acumulado, y sin salida cuando nadie habla.
const { Mezclador, FRAME_BYTES, MAX_COLA_BYTES } = require("../src/services/duende/mezclador");

/** Un trozo de PCM de `muestras` muestras, todas con el mismo valor. */
const constante = (muestras, valor) => {
    const b = Buffer.alloc(muestras * 2);
    for (let i = 0; i < muestras; i++) b.writeInt16LE(valor, i * 2);
    return b;
};
const muestrasDe = (buf) => Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(i * 2));

test("sin audio pendiente no sale nada", () => {
    const m = new Mezclador();
    expect(m.tick()).toBeNull();
});

test("una sola persona sale tal cual, en trozos de 20 ms", () => {
    const m = new Mezclador();
    m.empujar("ana", constante(FRAME_BYTES / 2, 1000));
    const trozo = m.tick();
    expect(trozo.length).toBe(FRAME_BYTES);
    expect(muestrasDe(trozo).every((v) => v === 1000)).toBe(true);
    expect(m.tick()).toBeNull();
});

test("dos personas a la vez se suman muestra a muestra", () => {
    const m = new Mezclador();
    m.empujar("ana", constante(FRAME_BYTES / 2, 1000));
    m.empujar("luis", constante(FRAME_BYTES / 2, 250));
    expect(muestrasDe(m.tick()).every((v) => v === 1250)).toBe(true);
});

test("la suma se recorta al rango de 16 bits", () => {
    const m = new Mezclador();
    m.empujar("ana", constante(FRAME_BYTES / 2, 30000));
    m.empujar("luis", constante(FRAME_BYTES / 2, 30000));
    expect(muestrasDe(m.tick()).every((v) => v === 32767)).toBe(true);
    const n = new Mezclador();
    n.empujar("ana", constante(FRAME_BYTES / 2, -30000));
    n.empujar("luis", constante(FRAME_BYTES / 2, -30000));
    expect(muestrasDe(n.tick()).every((v) => v === -32768)).toBe(true);
});

test("quien tiene menos de 20 ms se completa con silencio, y el resto sigue en el siguiente trozo", () => {
    const m = new Mezclador();
    m.empujar("ana", constante(100, 500)); // 200 bytes
    m.empujar("luis", constante(FRAME_BYTES / 2 + 50, 100)); // 20 ms y un poco más
    const primero = muestrasDe(m.tick());
    expect(primero[0]).toBe(600); // ana + luis
    expect(primero[150]).toBe(100); // ana ya no tiene audio: solo luis
    const segundo = muestrasDe(m.tick());
    expect(segundo[0]).toBe(100); // lo que le sobró a luis
    expect(m.tick()).toBeNull();
});

test("no se acumula retraso: si se va quedando atrás, se descarta lo más viejo", () => {
    const m = new Mezclador();
    m.empujar("ana", constante(MAX_COLA_BYTES, 1)); // justo 1 s
    m.empujar("ana", constante(FRAME_BYTES / 2, 9)); // 20 ms más: se tira lo más viejo
    expect(m.colas.get("ana").length).toBe(MAX_COLA_BYTES);
    expect(muestrasDe(m.colas.get("ana").subarray(-FRAME_BYTES)).every((v) => v === 9)).toBe(true);
});

test("quitar a alguien tira lo que tuviera pendiente", () => {
    const m = new Mezclador();
    m.empujar("ana", constante(FRAME_BYTES / 2, 700));
    m.quitar("ana");
    expect(m.tick()).toBeNull();
});
