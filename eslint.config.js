// ESLint (flat config). `npm run lint` · `npm run lint:fix`.
// Solo reglas que detectan fallos reales (variables sin definir o sin usar, código
// inalcanzable...); el formato lo lleva Prettier (.prettierrc.json).
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    { ignores: ["node_modules/", "data/", "logs/", "models/", "vosk/.venv/", "coverage/"] },
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
        rules: {
            "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "no-constant-condition": ["warn", { checkLoops: false }],
            "prefer-const": "warn",
            "no-var": "error",
            eqeqeq: ["error", "always", { null: "ignore" }],
        },
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
    },
    {
        // Tamaño: 60 líneas por función y 400 por fichero, que son la meta de la puntuación
        // (docs/planificacion/PUNTUACION.md). El repositorio ya cumple ambos; el catálogo de logros queda fuera.
        files: ["src/**/*.js"],
        rules: {
            "max-lines-per-function": ["error", { max: 60, skipBlankLines: false, skipComments: false }],
            "max-lines": ["error", { max: 400, skipBlankLines: false, skipComments: false }],
            // Una variable interna con el mismo nombre que una de fuera: lo que lee cada línea depende de dónde esté.
            "no-shadow": "error",
        },
    },
    {
        // core/ no depende de Discord (#477): lo que sí es de Discord (respuestas, registro de comandos) vive en src/discord/.
        files: ["src/core/**/*.js", "src/systems/**/*.js"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "discord.js",
                            message: "core/ y systems/ no pueden importar discord.js: lo que pinta mensajes va en src/discord/.",
                        },
                    ],
                },
            ],
            "no-restricted-modules": [
                "error",
                {
                    paths: [
                        {
                            name: "discord.js",
                            message: "core/ y systems/ no pueden importar discord.js: lo que pinta mensajes va en src/discord/.",
                        },
                    ],
                },
            ],
        },
    },
    {
        // Catálogo de datos (logros): una lista larga por naturaleza, no lógica.
        files: ["src/systems/logros/catalogo.js"],
        rules: { "max-lines": "off" },
    },
];
