// Minimal ESLint config — Next.js 15 requires this file to avoid interactive prompt.
export default [
  {
    ignores: ["**/node_modules/**", ".next/**", "out/**"],
  },
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "off",
    },
  },
];
