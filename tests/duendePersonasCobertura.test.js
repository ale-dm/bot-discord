// Quién es quién para el Duende (systems/duende/personas.js): resolver nombres a personas reales (apodos, perfiles,
// usuario de Discord), convertir nombres en menciones y detectar de quién se habla. Los datos viven en la BD en
// memoria; los miembros del servidor son un Collection de discord.js. Ningún dato se lee ni escribe en data/.
process.env.DATA_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "el-duende-personas-"));

const { Collection } = require("discord.js");
const apodos = require("../src/systems/apodos");
const perfiles = require("../src/systems/duende/perfiles");
const db = require("../src/core/db");
const personas = require("../src/systems/duende/personas");

const G = "g-personas-cobertura";

// Miembro del servidor con la forma que usa personas.js (user.username, nickname y displayName).
const miembro = (id, username, { nickname = null, displayName = username } = {}) => ({
    id,
    user: { id, username },
    nickname,
    displayName,
});

// Servidor de prueba con los miembros dados en la caché.
function servidor(...miembros) {
    const cache = new Collection();
    for (const m of miembros) cache.set(m.id, m);
    return { id: G, name: "Servidor de prueba", members: { cache } };
}

const nombresDe = (lista) => lista.map((p) => p.name).sort();

beforeAll(() => {
    // Apodos del servidor: Raúl tiene nombre principal y un apodo; Marcos se conoce también como «el perro».
    apodos.anadir(G, "100000000000000002", "Raúl", true);
    apodos.anadir(G, "100000000000000002", "coneyo");
    apodos.anadir(G, "100000000000000003", "Marcos", true);
    apodos.anadir(G, "100000000000000003", "el perro");

    // Perfiles del Duende: Ana y Ana María (para comprobar que el nombre más largo gana), José con acento,
    // y Bruno importado solo con su usuario, sin Discord ID todavía.
    perfiles.asegurarPerfil({ id: "100000000000000001", username: "ana" }, "Ana");
    perfiles.guardarDescripcion({
        discordId: "100000000000000001",
        username: "ana",
        nombre: "Ana",
        descripcion: "  Le encanta el cine.  ",
    });
    perfiles.asegurarPerfil({ id: "100000000000000004", username: "anamaria" }, "Ana María");
    perfiles.asegurarPerfil({ id: "100000000000000005", username: "jose" }, "José");
    db.prepare(
        "INSERT INTO duende_perfiles (discord_id, username, nombre, notas, actualizado_en) VALUES (NULL, 'bruno', 'Bruno', '[]', 0)",
    ).run();
});

describe("resolveNameToDiscordId", () => {
    test("sin nombre o con solo espacios no resuelve nada", () => {
        expect(personas.resolveNameToDiscordId("", servidor())).toBeNull();
        expect(personas.resolveNameToDiscordId("   ", servidor())).toBeNull();
        expect(personas.resolveNameToDiscordId(undefined, servidor())).toBeNull();
    });

    test("sin servidor no resuelve ni siquiera un apodo conocido", () => {
        expect(personas.resolveNameToDiscordId("Raúl", undefined)).toBeNull();
    });

    test("un apodo se resuelve sin importar mayúsculas ni tildes", () => {
        const s = servidor();
        expect(personas.resolveNameToDiscordId("RAUL", s)).toBe("100000000000000002");
        expect(personas.resolveNameToDiscordId("raúl", s)).toBe("100000000000000002");
        expect(personas.resolveNameToDiscordId("coneyo", s)).toBe("100000000000000002");
    });

    test("un apodo precedido de artículo («el perro») también se reconoce", () => {
        expect(personas.resolveNameToDiscordId("el perro", servidor())).toBe("100000000000000003");
        expect(personas.resolveNameToDiscordId("el coneyo", servidor())).toBe("100000000000000002");
    });

    test("un perfil del Duende se resuelve al miembro del servidor que tiene ese Discord ID", () => {
        expect(personas.resolveNameToDiscordId("Ana", servidor(miembro("100000000000000001", "anita")))).toBe("100000000000000001");
    });

    test("un perfil sin Discord ID se resuelve por su usuario de Discord", () => {
        expect(personas.resolveNameToDiscordId("Bruno", servidor(miembro("100000000000000006", "bruno")))).toBe("100000000000000006");
    });

    test("si el miembro del perfil no está en el servidor, no se devuelve nada por ese perfil", () => {
        expect(personas.resolveNameToDiscordId("Ana", servidor())).toBeNull();
    });

    test("sin apodo ni perfil, busca por usuario, apodo del servidor o nombre visible", () => {
        const s = servidor(
            miembro("100000000000000007", "tomas_99"),
            miembro("100000000000000008", "lu", { nickname: "lucia" }),
            miembro("100000000000000009", "pp", { displayName: "pepe" }),
        );
        expect(personas.resolveNameToDiscordId("tomas_99", s)).toBe("100000000000000007");
        expect(personas.resolveNameToDiscordId("el lucia", s)).toBe("100000000000000008");
        expect(personas.resolveNameToDiscordId("pepe", s)).toBe("100000000000000009");
    });

    test("un nombre que nadie tiene en el servidor no se resuelve", () => {
        expect(personas.resolveNameToDiscordId("Nadie", servidor(miembro("100000000000000011", "x")))).toBeNull();
    });

    // Antes la búsqueda comparaba el texto del modelo sin tildes con el nombre del miembro con tildes, y «Raúl» no
    // se encontraba. Ahora se normalizan ambos lados (systems/duende/personas.js).
    test("un miembro con tildes en su nombre visible se encuentra escribiéndolo sin tildes", () => {
        const s = servidor(miembro("100000000000000010", "tx9", { displayName: "Tonín" }));
        expect(personas.resolveNameToDiscordId("Tonin", s)).toBe("100000000000000010");
    });
});

describe("mentionizeKnownNames", () => {
    test("sin servidor o sin texto, devuelve el texto tal cual", () => {
        expect(personas.mentionizeKnownNames("hola Raúl", undefined)).toBe("hola Raúl");
        expect(personas.mentionizeKnownNames("", servidor())).toBe("");
    });

    test("convierte en mención el nombre principal de quien está en el servidor, sin distinguir mayúsculas", () => {
        const s = servidor(miembro("100000000000000002", "raul_x"));
        expect(personas.mentionizeKnownNames("Hola RAÚL, ¿qué tal?", s)).toBe("Hola <@100000000000000002>, ¿qué tal?");
    });

    test("solo convierte palabras completas: «Raúles» se queda como está", () => {
        const s = servidor(miembro("100000000000000002", "raul_x"));
        expect(personas.mentionizeKnownNames("Raúles y Raúl", s)).toBe("Raúles y <@100000000000000002>");
    });

    test("un nombre cuyo miembro no está en el servidor no se convierte", () => {
        expect(personas.mentionizeKnownNames("Raúl llega", servidor())).toBe("Raúl llega");
    });

    test("un apodo que no es el nombre principal no se convierte (el apodo no es mención)", () => {
        const s = servidor(miembro("100000000000000002", "raul_x"));
        expect(personas.mentionizeKnownNames("el coneyo llega", s)).toBe("el coneyo llega");
    });

    test("un perfil sin Discord ID se convierte por su usuario de Discord", () => {
        const s = servidor(miembro("100000000000000006", "bruno"));
        expect(personas.mentionizeKnownNames("Bruno llega tarde", s)).toBe("<@100000000000000006> llega tarde");
    });

    test("con nombres que se solapan, gana el más largo", () => {
        const s = servidor(miembro("100000000000000001", "ana"), miembro("100000000000000004", "anamaria"));
        expect(personas.mentionizeKnownNames("Ana María y Ana", s)).toBe("<@100000000000000004> y <@100000000000000001>");
    });

    // Antes el patrón usaba \b sin la bandera «u», y las vocales acentuadas no contaban como letra: «José» nunca
    // se convertía. Ahora el límite de palabra es Unicode (systems/duende/personas.js, mentionizeKnownNames).
    test("un nombre que termina en tilde («José») también se convierte en mención", () => {
        const s = servidor(miembro("100000000000000005", "jose"));
        expect(personas.mentionizeKnownNames("hola José", s)).toBe("hola <@100000000000000005>");
    });
});

describe("buildPersonProfileText", () => {
    test("junta descripción y notas con « | » y las notas separadas por «; »", () => {
        expect(
            personas.buildPersonProfileText({ description: "  Le gusta el cine. ", notas: ["ojo con el spoiler", "vive en Sevilla"] }),
        ).toBe("Le gusta el cine. | ojo con el spoiler; vive en Sevilla");
    });

    test("solo descripción, solo notas o nada", () => {
        expect(personas.buildPersonProfileText({ description: "Solo texto" })).toBe("Solo texto");
        expect(personas.buildPersonProfileText({ notas: ["a", "b"] })).toBe("a; b");
        expect(personas.buildPersonProfileText({ description: "", notas: [] })).toBe("");
        expect(personas.buildPersonProfileText(null)).toBe("");
        expect(personas.buildPersonProfileText({ notas: "no es una lista" })).toBe("");
    });
});

describe("detectMentionedPersons", () => {
    test("sin texto no encuentra a nadie", () => {
        expect(personas.detectMentionedPersons("", servidor(), null)).toEqual([]);
    });

    test("una mención real de Discord trae el perfil de esa persona, con o sin «!»", () => {
        const s = servidor(miembro("100000000000000001", "ana"));
        expect(nombresDe(personas.detectMentionedPersons("oye <@100000000000000001>", s, null))).toEqual(["Ana"]);
        expect(nombresDe(personas.detectMentionedPersons("oye <@!100000000000000001>", s, null))).toEqual(["Ana"]);
    });

    test("una mención de alguien sin perfil no aporta nada", () => {
        expect(personas.detectMentionedPersons("<@999>", servidor(), null)).toEqual([]);
    });

    test("quien habla no se incluye, ni por mención ni por nombre", () => {
        const s = servidor(miembro("100000000000000001", "ana"));
        expect(personas.detectMentionedPersons("<@100000000000000001> Ana", s, "100000000000000001")).toEqual([]);
        expect(personas.detectMentionedPersons("Ana llega", s, "100000000000000001")).toEqual([]);
    });

    test("por nombre en el texto, sin distinguir tildes", () => {
        const found = personas.detectMentionedPersons("pregunta por jose de nuevo", servidor(), null);
        expect(nombresDe(found)).toEqual(["José"]);
    });

    test("un nombre dentro de otra palabra no cuenta (Ana dentro de Anabel)", () => {
        expect(personas.detectMentionedPersons("Anabel está aquí", servidor(), null)).toEqual([]);
    });

    test("la misma persona mencionada de dos formas aparece una sola vez", () => {
        const s = servidor(miembro("100000000000000001", "ana"));
        expect(nombresDe(personas.detectMentionedPersons("<@100000000000000001> le pregunté a Ana", s, null))).toEqual(["Ana"]);
    });

    test("sin servidor, la mención todavía se resuelve por el perfil del Discord ID", () => {
        expect(nombresDe(personas.detectMentionedPersons("<@100000000000000001>", undefined, null))).toEqual(["Ana"]);
    });
});
