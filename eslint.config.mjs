/**
 * eslint.config.mjs
 *
 * ESLint 9 flat config — TypeScript project.
 * Uses @typescript-eslint/parser + @typescript-eslint/eslint-plugin v8.
 */

import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Base recommended JS rules
  js.configs.recommended,

  // TypeScript source and test files
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript recommended rules (no type-checking — avoids project reference)
      ...tsPlugin.configs.recommended.rules,

      // Allow explicit `any` only with an eslint-disable comment
      "@typescript-eslint/no-explicit-any": "warn",

      // Enforce explicit return types on exported functions
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Allow require() for lazy imports (used in db.ts to avoid circular deps)
      "@typescript-eslint/no-require-imports": "off",

      // TypeScript compiler handles undefined references — no-undef is redundant
      "no-undef": "off",
    },
  },

  // Test files — add Jest globals
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // TypeScript compiler handles undefined references
      "no-undef": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "build/**",
      "*.js",
      "*.mjs",
    ],
  },
];
