import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // eve build output and workflow state:
    ".eve/**",
    ".output/**",
    // Generated vendor code installed by the shadcn CLI:
    "src/components/reui/**",
    "src/components/examples/**",
    // Vendored claude-motion toolkit seeded into the Docker sandbox:
    "agent/sandbox/workspace/**",
  ]),
]);

export default eslintConfig;
