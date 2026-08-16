import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * One flat config for every workspace.
 *
 * The rules are type-checked (`recommendedTypeChecked`), which is the reason
 * `projectService` is on: it hands each linted file the tsconfig that actually
 * owns it, so `packages/state/test/*` is checked against `tsconfig.test.json`
 * and `packages/*\/src/*` against `tsconfig.json`, without listing either here.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.test-build/**",
      "typedoc/site/**",
      "packages/domain-tools/tsup.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The type-utility modules are `any` by construction. Every occurrence sits
    // in a generic constraint or an `infer` position — `Newable<T> = new
    // (...args: any[]) => T`, `AggregateRoot<any, any>` — where `any` means
    // "this parameter is not what I am asking about". `unknown` answers a
    // different question and stops concrete subclasses from satisfying the
    // constraint at all, so the rule has nothing to offer these files.
    files: ["packages/domain-tools/src/lib/types/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // This file, and any other plain JS. Type-aware rules need a tsconfig that
    // owns the file, and no tsconfig here does — nor should one, since none of
    // this is compiled. Turning the type-checked rules off is what typescript-
    // eslint prescribes for exactly this case; leaving them on yields a parsing
    // error rather than a finding.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    // Declared by hand rather than pulling in `globals` for two names. These
    // are the only Node globals anything here touches; add to the list rather
    // than reaching for a dependency.
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    // Tests assert against the compiler as much as against the runtime: a
    // `@ts-expect-error` here IS the assertion, and several fixtures exist
    // precisely to be called wrongly.
    files: ["**/test/**/*.ts"],
    rules: {
      // `node:test`'s `test()` returns a promise, and the runner is what
      // awaits it — a top-level `test(...)` call is the documented usage, not
      // a dropped promise. Leaving this on would mean `void test(...)` on
      // every single case in the suite, which says nothing true.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
);
