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
            eqeqeq: ["warn", "smart"],
        },
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
    },
];
