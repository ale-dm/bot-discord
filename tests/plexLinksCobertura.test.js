// Vínculos entre cada persona de Discord y su cuenta de Plex (systems/plexLinks.js): crear y cambiar el vínculo,
// buscarlo por Discord o por nombre de Plex, borrarlo, y volver a emparejarlos con Tautulli cuando su ID interno
// cambia. Usa la BD en memoria real; la lista de Tautulli es un objeto simulado.
const db = require("../src/core/db");
const plex = require("../src/systems/plexLinks");

let n = 0;
const nuevoServidor = () => `g-plexlinks-${++n}`;

const importacion = (guildId, userId) =>
    db.prepare("SELECT COUNT(*) AS n FROM plex_importacion WHERE guildId = ? AND userId = ?").get(guildId, userId).n;

describe("setLink y las consultas de vínculos", () => {
    test("guarda el vínculo y devuelve el ID de Tautulli como texto", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", 7, "Ana");

        expect(plex.getLinkByDiscordId(g, "d1")).toEqual({ discordUserId: "d1", tautulliUserId: "7", plexUsername: "Ana" });
    });

    test("sin nombre de Plex se guarda como null", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "7", "");

        expect(plex.getLinkByDiscordId(g, "d1").plexUsername).toBeNull();
    });

    test("getLinks lista solo los de ese servidor, ordenados por nombre de Plex", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "carla");
        plex.setLink(g, "d2", "2", "ana");
        plex.setLink(g, "d3", "3", "bea");
        plex.setLink(nuevoServidor(), "d9", "9", "otra-casa");

        expect(plex.getLinks(g).map((l) => l.plexUsername)).toEqual(["ana", "bea", "carla"]);
    });

    test("una persona sin vínculo da null", () => {
        expect(plex.getLinkByDiscordId(nuevoServidor(), "nadie")).toBeNull();
    });

    test("buscar por nombre de Plex no distingue mayúsculas y solo mira ese servidor", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "8", "MarcosPlex");

        expect(plex.getLinkByPlexUsername(g, "marcosplex").discordUserId).toBe("d1");
        expect(plex.getLinkByPlexUsername(g, "MARCOSPLEX").discordUserId).toBe("d1");
        expect(plex.getLinkByPlexUsername(nuevoServidor(), "marcosplex")).toBeNull();
    });

    test("buscar con nombre vacío o inexistente da null", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "8", "Marcos");

        expect(plex.getLinkByPlexUsername(g, "")).toBeNull();
        expect(plex.getLinkByPlexUsername(g, undefined)).toBeNull();
        expect(plex.getLinkByPlexUsername(g, "nadie")).toBeNull();
    });

    test("volver a vincular a la misma persona reemplaza su vínculo", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "viejo");
        const antes = plex.getLinkByDiscordId(g, "d1");
        plex.setLink(g, "d1", "2", "nuevo");

        const ahora = plex.getLinkByDiscordId(g, "d1");
        expect(plex.getLinks(g)).toHaveLength(1);
        expect(ahora).toMatchObject({ tautulliUserId: "2", plexUsername: "nuevo" });
        expect(ahora).not.toEqual(antes);
    });
});

describe("cambiar de cuenta de Plex borra la importación de la anterior", () => {
    test("con otra cuenta de Tautulli se borra lo importado; con la misma se conserva", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "10", "ana");
        db.prepare("INSERT INTO plex_importacion (guildId, userId, inicio, fin) VALUES (?, ?, ?, NULL)").run(g, "d1", Date.now());

        plex.setLink(g, "d1", "10", "ana nueva");
        expect(importacion(g, "d1")).toBe(1);
        expect(plex.getLinkByDiscordId(g, "d1").plexUsername).toBe("ana nueva");

        plex.setLink(g, "d1", "11", "otra cuenta");
        expect(importacion(g, "d1")).toBe(0);
    });
});

describe("relinkAll: volver a emparejar tras reinstalar Tautulli", () => {
    test("cuando el ID de Tautulli cambia, lo actualiza buscando por nombre de usuario", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "Ana");

        const r = plex.relinkAll(g, [{ user_id: 99, username: "ana" }]);

        expect(r).toEqual({ total: 1, actualizados: ["Ana"], noEncontrados: [] });
        expect(plex.getLinkByDiscordId(g, "d1")).toMatchObject({ tautulliUserId: "99", plexUsername: "ana" });
    });

    test("también empareja por nombre visible (friendly_name), sin cambiar el nombre guardado", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "Bea Sánchez");

        const r = plex.relinkAll(g, [{ user_id: 5, friendly_name: "bea sánchez" }]);

        expect(r.actualizados).toEqual(["Bea Sánchez"]);
        expect(plex.getLinkByDiscordId(g, "d1")).toMatchObject({ tautulliUserId: "5", plexUsername: "Bea Sánchez" });
    });

    test("un vínculo que ya está bien no cuenta como actualizado", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "3", "Carla");

        const r = plex.relinkAll(g, [{ user_id: 3, username: "Carla" }]);

        expect(r).toEqual({ total: 1, actualizados: [], noEncontrados: [] });
    });

    test("los vínculos sin usuario en Tautulli se listan como no encontrados", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "Dani");
        plex.setLink(g, "d2", "4", null);

        const r = plex.relinkAll(g, [{ user_id: 2, username: "otro" }]);

        expect(r.total).toBe(2);
        expect(r.actualizados).toEqual([]);
        expect(r.noEncontrados.sort()).toEqual(["4", "Dani"]);
        expect(plex.getLinkByDiscordId(g, "d1").tautulliUserId).toBe("1");
    });

    test("sin lista de Tautulli no cambia nada y lo deja todo como no encontrado", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "Eva");

        expect(plex.relinkAll(g, undefined)).toEqual({ total: 1, actualizados: [], noEncontrados: ["Eva"] });
        expect(plex.getLinkByDiscordId(g, "d1").tautulliUserId).toBe("1");
    });
});

describe("removeLink", () => {
    test("quita el vínculo, y quitarlo dos veces no da error", () => {
        const g = nuevoServidor();
        plex.setLink(g, "d1", "1", "Fer");

        plex.removeLink(g, "d1");
        expect(plex.getLinkByDiscordId(g, "d1")).toBeNull();

        expect(() => plex.removeLink(g, "d1")).not.toThrow();
    });
});
