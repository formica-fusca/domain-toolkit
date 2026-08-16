# Domain Tools

A small, dependency-free toolkit of TypeScript building blocks for
domain-driven design.

**[API reference](https://formica-fusca.github.io/domain-tools/)** — every
exported type, regenerated from source on each push to `main`.

## Installation

```sh
yarn add domain-tools
```

No peer dependencies, no polyfills, no import-order rules. `Entity`,
`AggregateRoot`, `Identifier`, `ValueObject`, `Repository`, `DomainEvent` and
the domain errors work as-is.

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
