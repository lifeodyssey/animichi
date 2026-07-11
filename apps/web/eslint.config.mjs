// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".output/**",
      ".nitro/**",
      ".tanstack/**",
      "coverage/**",
      "dist/**",
      "eslint.config.mjs",
      "vitest*.config.ts",
      "vite.config.ts",
      "**/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      complexity: ["error", 10],
      "max-depth": ["error", 2],
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
    },
  },
);
