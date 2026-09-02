import { defineConfig } from "tsup";

/**
 * The publishable artifact.
 *
 * `tsc` is not used for this build, and the reason is `@domain-toolkit/state`:
 * it is `private: true` and never reaches a registry, so any `import ... from
 * "@domain-toolkit/state"` surviving into `dist` is a specifier that resolves
 * here and nowhere else. `tsc` cannot fix that — it emits one file per input
 * and never inlines a dependency — so the bundler owns this step.
 *
 * `noExternal` is the whole point: it moves that package from "leave the import
 * alone" to "inline it", for the JavaScript *and* the declarations. Both halves
 * matter. Bundling only the JS still ships a `dist/index.d.ts` that imports a
 * package the consumer cannot install, and they get TS2307 the moment they
 * reach for `State` or `RequiredState`.
 *
 * Typechecking is not this build's job — `yarn typecheck` (`tsc -b`) does that
 * across the project graph.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "esnext",
  dts: {
    // The declaration half of `noExternal`, and it is a *separate* setting
    // because tsup runs two bundlers: esbuild for the JavaScript, which honours
    // `noExternal`, and rollup-plugin-dts for the types, which does not. Without
    // this the emitted `.d.ts` keeps `from "@domain-toolkit/state"` — a specifier
    // that resolves in this repo and in no consumer's node_modules.
    resolve: ["@domain-toolkit/state"],
    // tsup injects `baseUrl` into the compiler options it uses for the
    // declaration bundle. TypeScript 6 has demoted that option to a hard error
    // (TS5101) ahead of removing it in 7, and the injection is not ours to
    // remove — so the deprecation is acknowledged here rather than worked
    // around. Drop this once tsup stops setting it.
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  clean: true,
  sourcemap: false,
  noExternal: ["@domain-toolkit/state"],
});
