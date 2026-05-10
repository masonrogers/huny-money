import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  {
    rules: {
      // react-hooks v7 (new) flags hydration / clear-on-open patterns that are
      // idiomatic and correct in our context. Keep visible as warnings rather
      // than blocking CI on legitimate uses.
      "react-hooks/set-state-in-effect": "warn",
      // Honor _-prefixed args/vars (TS convention for "intentionally unused").
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
];

export default config;
