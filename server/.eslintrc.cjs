/* eslint-env node */
module.exports = {
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended-type-checked",
        "prettier",
    ],
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint"],
    parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
    },
    root: true,
    /**
     * Generated output is not source. `coverage/` (jest's HTML reporter) and
     * `dist/` (tsc's build) were being linted, and three of the coverage
     * reporter's own vendored scripts accounted for three of the eight "parse
     * error" entries in the baseline — noise that made the count look worse
     * than the code is.
     */
    ignorePatterns: ["dist/", "coverage/", "node_modules/"],
    overrides: [
        {
            /**
             * Tooling that lives at the package root and is deliberately
             * outside `tsconfig.json`'s `include`. With `project: true` the
             * type-aware parser cannot resolve them and reports a parse error
             * per file — five of the eight in the baseline. They still get the
             * non-type-aware rules, which is all a config file needs.
             */
            files: [
                "*.config.ts",
                "*.config.js",
                "*.config.cjs",
                "jest.*.js",
                "jest.*.cjs",
                "scripts/*.cjs",
                "scripts/*.ts",
            ],
            // `disable-type-checked` is required, not decorative: an override's
            // `extends` ADDS to the root's, so without it the inherited
            // type-aware rules still run and demand the parser services this
            // block just took away — eslint then dies outright rather than
            // reporting anything.
            parserOptions: { project: null },
            // These are CommonJS: without `node`, `module.exports` is an
            // undefined global and every config file reports `no-undef`.
            env: { node: true },
            extends: ["plugin:@typescript-eslint/disable-type-checked"],
            rules: {
                // `const x = require(…)` is not a lapse in a `.cjs` file, it is
                // the module system. The rule exists to push ES modules on
                // TypeScript source; these are neither.
                "@typescript-eslint/no-var-requires": "off",
            },
        },
        {
            /**
             * The test suite — 312 files that were not linted at all
             * until P1, because `.eslintignore` excluded `tests/`
             * wholesale rather than solving the parser problem.
             *
             * They sit outside `tsconfig.json`'s include, so the same
             * `project: null` + `disable-type-checked` treatment as the
             * config files applies. That gives up the type-aware rules
             * (no-floating-promises and friends) and keeps everything
             * that finds real mistakes in a test: unused variables,
             * undefined identifiers, unreachable code, duplicate keys.
             */
            files: ["tests/**/*.ts"],
            parserOptions: { project: null },
            env: { node: true, jest: true },
            extends: ["plugin:@typescript-eslint/disable-type-checked"],
            rules: {
                // A test that prints while diagnosing is doing its job.
                "no-console": "off",
            },
        },
    ],
    rules: {
        "no-console": "error",
        "dot-notation": "error",
        "@typescript-eslint/no-misused-promises": "off",
        "@typescript-eslint/require-await": "off",
        /**
         * `_`-prefixed ARGUMENTS are intentional too, not just variables.
         * Express decides a handler is an error handler by its arity, so
         * `errorHandler(err, req, res, _next)` must keep a fourth parameter it
         * never calls — the default rule only forgives unused *variables*, so
         * the one piece of the framework's contract we cannot change was the
         * thing it flagged.
         */
        "@typescript-eslint/no-unused-vars": [
            "error",
            {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            },
        ],
    },
};
