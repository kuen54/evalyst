import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Match Next.js build output at any depth — top-level only would
    // miss nested `.next/` dirs (e.g. inside .claude/worktrees/agent-*/),
    // which otherwise contribute tens of thousands of false-positive
    // warnings from generated build chunks.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    // Agent worktrees created by the EnterWorktree tool. Contain
    // checked-out copies of the repo plus their own build artifacts;
    // not project source.
    ".claude/**",
    // Coverage output from vitest --coverage.
    "coverage/**",
  ]),
  {
    // Underscore-prefixed identifiers are an explicit "intentionally
    // unused" convention (function params we must accept but ignore,
    // capture-rest variables, etc.). Default config flags them.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;

