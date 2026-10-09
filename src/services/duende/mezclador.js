// Mezcla el audio de varias personas que hablan a la vez en un único flujo de 16 kHz mono, 16 bits, que es lo que espera
// Gemini Live (modo tertulia de /conversación, #16). Cada 20 ms se toma un trozo de lo que tenga cada persona, se suman
// las muestras (recortadas al rango de 16 bits) y sale un único trozo. Si nadie tiene audio, no sale nada.
const SAMPLE_RATE = 16000;
const FRAME_MS = 20;
const FRAME_BYTES = ((SAMPLE_RATE * FRAME_MS) / 1000) * 2; // 640 bytes
// Lo que se guarda por persona sin mandarlo: si Gemini va lento, se descarta lo más viejo, para no añadir retraso sin límite.
const MAX_COLA_BYTES = SAMPLE_RATE * 2; // 1 segundo

class Mezclador {
    constructor() {
        this.colas = new Map(); // userId -> Buffer pendiente
    }

    /** Añade audio de una persona (PCM 16 kHz mono, 16 bits, little-endian). */
    empujar(userId, pcm) {
        const cola = Buffer.concat([this.colas.get(userId) || Buffer.alloc(0), pcm]);
        this.colas.set(userId, cola.length > MAX_COLA_BYTES ? cola.subarray(cola.length - MAX_COLA_BYTES) : cola);
    }

    /** Deja de tener en cuenta a una persona (y lo que tuviera pendiente). */
    quitar(userId) {
        this.colas.delete(userId);
    }

    /**
     * El siguiente trozo de 20 ms mezclado, o null si nadie tiene audio pendiente. Quien tiene menos de 20 ms
     * se completa con silencio.
     * @returns {Buffer|null}
     */
    tick() {
        const suma = new Int32Array(FRAME_BYTES / 2);
        let hayAudio = false;
        for (const [userId, cola] of this.colas) {
            if (!cola.length) continue;
            hayAudio = true;
            const trozo = cola.subarray(0, Math.min(FRAME_BYTES, cola.length));
            for (let i = 0; i + 1 < trozo.length; i += 2) suma[i / 2] += trozo.readInt16LE(i);
            const resto = cola.subarray(trozo.length);
            if (resto.length) this.colas.set(userId, resto);
            else this.colas.delete(userId);
        }
        if (!hayAudio) return null;
        const salida = Buffer.alloc(FRAME_BYTES);
        for (let i = 0; i < suma.length; i++) salida.writeInt16LE(Math.max(-32768, Math.min(32767, suma[i])), i * 2);
        return salida;
    }
}

module.exports = { Mezclador, FRAME_BYTES, FRAME_MS, MAX_COLA_BYTES };
