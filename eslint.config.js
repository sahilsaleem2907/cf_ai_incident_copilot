import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".wrangler", "node_modules", "worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Unawaited promises in Workers silently drop work; keep these on everywhere.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // The Agents SDK runs SQL as a tagged template statement: this.sql`UPDATE …`.
      "@typescript-eslint/no-unused-expressions": ["error", { allowTaggedTemplates: true }],
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
    languageOptions: { globals: globals.browser },
  },
  { files: ["*.config.{js,ts}", "scripts/**/*.ts"], languageOptions: { globals: globals.node } },
);
