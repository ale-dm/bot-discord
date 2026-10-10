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
        // Tamaño, en modo «que no empeore»: el límite es el máximo actual, no la meta. La meta de la puntuación
        // (docs/planificacion/PUNTUACION.md) es 60 líneas por función y 400 por fichero: al bajar cada máximo real,
        // se baja también la regla.
        files: ["src/**/*.js"],
        rules: {
            "max-lines-per-function": ["error", { max: 120, skipBlankLines: false, skipComments: false }],
            "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
            // Una variable interna con el mismo nombre que una de fuera: lo que lee cada línea depende de dónde esté.
            "no-shadow": "error",
        },
    },
    {
        // Catálogo de datos (logros): una lista larga por naturaleza, no lógica.
        files: ["src/systems/logros/catalogo.js"],
        rules: { "max-lines": "off" },
    },
];
