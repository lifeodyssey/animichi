// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**", "eslint.config.mjs", "vitest.config.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { project: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 2],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
