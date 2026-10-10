// Panel admin → Duende → Perfiles con interacciones simuladas: los mensajes y el formulario se
// convierten a JSON con discord.js (así fallaría aquí cualquier límite de Discord, como un label
// demasiado largo o un embed de más de 6.000 caracteres).
const db = require("../src/core/db");
const perfiles = require("../src/systems/duende/perfiles");
const panel = require("../src/adminPanel/perfilesDuende");

const aJson = (payload) => ({
    ...payload,
    embeds: (payload.embeds || []).map((e) => e.toJSON()),
    components: (payload.components || []).map((c) => c.toJSON()),
});
const tamañoEmbed = (e) =>
    (e.title || "").length +
    (e.description || "").length +
    (e.footer?.text || "").length +
    (e.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);

function fake(customId, extra = {}) {
    const r = { customId, guildId: "g1", user: { id: "admin" }, respuestas: [] };
    r.update = async (p) => r.respuestas.push(["update", aJson(p)]);
    r.reply = async (p) => r.respuestas.push(["reply", aJson(p)]);
    r.showModal = async (m) => r.respuestas.push(["modal", m.toJSON()]);
    r.isFromMessage = () => true;
    return Object.assign(r, extra);
}

let id;
beforeEach(() => {
    db.exec("DELETE FROM duende_perfiles");
    perfiles.guardarDescripcion({ discordId: "123456789012345678", username: "raul_02", nombre: "Raúl", descripcion: "x".repeat(3900) });
    for (let i = 0; i < perfiles.MAX_NOTAS; i++) perfiles.anotar({ id: "123456789012345678", username: "raul_02" }, "n".repeat(200));
    id = perfiles.perfilPorDiscordId("123456789012345678").id;
});

test("la ficha muestra todo y cabe en un embed aunque el perfil esté lleno", async () => {
    const i = fake("paneladmin_perfiles_pick", { values: [String(id)] });
    expect(await panel.handlePerfilesStringSelect(i)).toBe(true);
    const [tipo, msg] = i.respuestas[0];
    expect(tipo).toBe("update");
    const e = msg.embeds[0];
    expect(tamañoEmbed(e)).toBeLessThanOrEqual(6000);
    const campos = Object.fromEntries(e.fields.map((f) => [f.name.split(" ")[0], f.value]));
    expect(campos.Discord).toContain("123456789012345678");
    expect(campos.Username).toContain("raul_02");
    expect(campos.Nombre).toBe("Raúl");
    expect(campos.Lo).toMatch(/se corta/);
});

test("Editar todo abre un formulario con los cinco campos rellenos", async () => {
    const i = fake(`paneladmin_perfiles_editar_${id}`);
    await panel.handlePerfilesButton(i);
    const [tipo, modal] = i.respuestas[0];
    expect(tipo).toBe("modal");
    const valores = Object.fromEntries(
        modal.components.map((r) =>
            r.component
                ? [r.component.custom_id, (r.component.default_values ?? []).map((d) => d.id).join(",")]
                : [r.components[0].custom_id, r.components[0].value],
        ),
    );
    expect(Object.keys(valores)).toEqual(["nombre", "username", "discordId", "descripcion", "notas"]);
    expect(valores.nombre).toBe("Raúl");
    expect(valores.notas.split("\n")).toHaveLength(perfiles.MAX_NOTAS);
});

test("guardar el formulario cambia todos los campos", async () => {
    const valores = {
        nombre: "Raúl Pérez",
        username: "raul_nuevo",
        discordId: "987654321098765432",
        descripcion: "Nueva descripción",
        notas: "primera\n\n  segunda  \n",
    };
    const i = fake(`paneladmin_perfiles_modal_${id}`, {
        fields: { getTextInputValue: (k) => valores[k], getSelectedUsers: (k) => (valores[k] ? new Map([[valores[k], {}]]) : null) },
    });
    await panel.handlePerfilesModal(i);
    expect(i.respuestas[0][0]).toBe("update");
    expect(perfiles.perfilPorId(id)).toMatchObject({
        name: "Raúl Pérez",
        username: "raul_nuevo",
        discordId: "987654321098765432",
        description: "Nueva descripción",
        notas: ["primera", "segunda"],
    });
});

test("un Discord ID inválido o de otro perfil no guarda nada", async () => {
    perfiles.guardarDescripcion({ discordId: "111111111111111111", nombre: "Otro", descripcion: "" });
    for (const discordId of ["abc", "111111111111111111"]) {
        const valores = { nombre: "Cambio", username: "", discordId, descripcion: "", notas: "" };
        const i = fake(`paneladmin_perfiles_modal_${id}`, {
            fields: { getTextInputValue: (k) => valores[k], getSelectedUsers: (k) => (valores[k] ? new Map([[valores[k], {}]]) : null) },
        });
        await panel.handlePerfilesModal(i);
        expect(i.respuestas[0][1].content).toMatch(/^❌/);
    }
    expect(perfiles.perfilPorId(id).name).toBe("Raúl");
});

test("elegir a alguien sin perfil se lo crea, y el selector lista los existentes", async () => {
    const sel = fake("paneladmin_perfiles_elegir");
    await panel.handlePerfilesButton(sel);
    expect(sel.respuestas[0][1].components[0].components[0].options[0].label).toBe("Raúl");

    const nuevo = { id: "222222222222222222", username: "ana", globalName: "Ana" };
    const i = fake("paneladmin_perfiles_user", { users: { first: () => nuevo } });
    await panel.handlePerfilesUserSelect(i);
    expect(perfiles.perfilPorDiscordId("222222222222222222")).toMatchObject({ name: "Ana", username: "ana" });
    expect(i.respuestas[0][1].content).toMatch(/Perfil creado/);
});

test("borrar pide confirmación y luego borra", async () => {
    const i = fake(`paneladmin_perfiles_borrar_${id}`);
    await panel.handlePerfilesButton(i);
    expect(perfiles.perfilPorId(id)).not.toBeNull();
    await panel.handlePerfilesButton(fake(`paneladmin_perfiles_borrarok_${id}`));
    expect(perfiles.perfilPorId(id)).toBeNull();
});
