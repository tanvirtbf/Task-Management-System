import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    // `dist` is build output; `src/mocks` + `src/lib/mock-api.ts` are the dead
    // legacy mock layer — excluded from the tsconfig build (never imported by any
    // live screen), so exclude them from lint too for consistency.
    globalIgnores(["dist", "src/mocks", "src/lib/mock-api.ts"]),
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        rules: {
            // Honour the `_`-prefix convention used across the codebase to mark
            // intentionally-unused bindings (destructure-to-drop, ignored args,
            // caught errors) — e.g. `const { workspaceId: _workspaceId, ...rest }`.
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
        },
    },
]);
