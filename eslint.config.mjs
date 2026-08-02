// ESLint flat config — Next.js plugin (core-web-vitals) + React Hooks plugin.
// Wired manually instead of via eslint-config-next because this repo runs
// ESLint 10, which eslint-config-next does not support yet.
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/node_modules/**",
      ".next/**",
      "out/**",
      ".venv/**",
      "data/**",
      // Ad-hoc test harnesses (excluded from tsconfig too — AGENTS.md testing notes)
      "test_*",
      "corpus/**",
    ],
  },
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat["recommended-latest"],
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "off",
      // MenuLens deliberately renders photos with plain <img>: scan previews
      // are blob: object URLs and dish photos come from external providers
      // (Unsplash/Pexels/…) — next/image is not applicable there.
      "@next/next/no-img-element": "off",
    },
  },
];
