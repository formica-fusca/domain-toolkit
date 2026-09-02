# Domain Tools

A small, dependency-free toolkit of TypeScript building blocks for
domain-driven design.

**[API reference](https://formica-fusca.github.io/domain-tools/)** — every
exported type, regenerated from source on each push to `main`.

## Installation

```sh
yarn add domain-tools-ts
```

No peer dependencies, no polyfills, no import-order rules. `Entity`,
`AggregateRoot`, `Identifier`, `ValueObject`, `Repository`, `DomainEvent` and
the domain errors work as-is.

### Module format

The package is **ESM only**. It ships a single `dist/index.js` as an ES module,
and its `exports` map declares only an `import` entry, so `require()` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` on every Node version. Load it with `import`
from an ES module, a TypeScript project using `nodenext` or `bundler` module
resolution, or any bundler. There is no CommonJS build.

### Using `@Handle`

`@Handle` is a decorator, so consumers compiling with TypeScript need one
compiler option:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

That is the whole setup. The registry backing `@Handle` keeps its event-to-method
map in a module-private `WeakMap`, not in `reflect-metadata` — so there is no
global `Reflect` patch to install and nothing that must be imported before your
aggregates are defined.
