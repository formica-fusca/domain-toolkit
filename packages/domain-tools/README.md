# domain-tools-ts

The published package: TypeScript building blocks for domain-driven design.

For installation and the one compiler option `@Handle` needs, see the
[repo-root README](../../README.md). For every exported signature, see the
**[API reference](https://formica-fusca.github.io/domain-tools/)**, regenerated
from these sources on each push to `main`.

## The building blocks

| Export                                   | What it is                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Entity`                                 | A domain object defined by **who it is**, not what it holds. Records events; never publishes them.              |
| `AggregateRoot`                          | An `Entity` that is also a consistency boundary — the only way in, and the unit of persistence and publication. |
| `Identifier`                             | An entity's identity. A class rather than a `string`, so two id types cannot be transposed.                     |
| `ValueObject`                            | Defined entirely by its attributes. No identity, no lifecycle, frozen on construction.                          |
| `DomainEvent`                            | Something that has already happened, in the ubiquitous language. Past tense, immutable, carries ids.            |
| `@Handle` / `HandleRegistry`             | Binds an event to the aggregate method that reacts to it, keyed by `eventName`.                                 |
| `Repository`                             | A collection-like interface over **whole aggregates** — one per root, never per entity.                         |
| `DomainError` and friends                | Errors the business refuses, as distinct from bugs.                                                             |
| `State`, `RequiredKeys`, `RequiredState` | Re-exported from [`@domain-tools/state`](../state/README.md), which is bundled into this package's `dist`.      |

## Design notes

Each source file keeps the contract in its doc comments — what the thing is and
how to call it, which is what the API reference renders. The reasoning behind the
implementation lives here, one file per source file:

| Notes                                                    | Covers                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/entity.md`](./docs/entity.md)                     | Why an entity _holds_ a state manager instead of extending one; the `this`-parameter and `prototype` machinery behind `create`; why `mutate` wraps the operation and not the event. |
| [`docs/aggregate-root.md`](./docs/aggregate-root.md)     | The cycle guard; why `hasPendingEvents` is overridden at all; `fromEvents` and the abstractness check that was traded away.                                                         |
| [`docs/identifier.md`](./docs/identifier.md)             | Nominal typing by hand — the `_tag` field, and why it should be `declare`d.                                                                                                         |
| [`docs/value-object.md`](./docs/value-object.md)         | Why the freeze is enforced rather than recommended, and why `equals` is deliberately shallow.                                                                                       |
| [`docs/domain-event.md`](./docs/domain-event.md)         | Why ordering uses a counter and not a timestamp; why `eventName` is static and cannot be checked.                                                                                   |
| [`docs/handle-decorator.md`](./docs/handle-decorator.md) | Why registration keys on `eventName` rather than the class name, and what broke when it did not.                                                                                    |
| [`docs/handle-registry.md`](./docs/handle-registry.md)   | Dropping `reflect-metadata` for a `WeakMap`; the prototype walk; why `AggregateRootClass` avoids a construct signature.                                                             |

Repo-root [`docs/`](../../docs/) holds the investigation records these refer
back to — a change that was made, what it cost, and what it fixed:
[`inheritance-to-composition.md`](../../docs/inheritance-to-composition.md),
[`state-manager-init.md`](../../docs/state-manager-init.md),
[`operation-atomicity.md`](../../docs/operation-atomicity.md),
[`abstract-base-construction.md`](../../docs/abstract-base-construction.md).

It also holds two reference notes on how the building blocks divide up:

- [`domain-event-ownership.md`](../../docs/domain-event-ownership.md) — where
  `Entity` stops and `AggregateRoot` starts, event-wise. Start there if you are
  unsure whether something should `record` or `apply`.
- [`entity-aggregate-membership.md`](../../docs/entity-aggregate-membership.md)
  — which entities may exist where. Start there if you are unsure whether
  something should be a child entity, its own aggregate root, or a value object.

## Tests

`test/` mirrors the concerns rather than the files: `construction.test.ts`,
`identity.test.ts`, `events.test.ts`, `boundary.test.ts`, `atomicity.test.ts`,
and `state.test.ts` — which holds the `Entity`/`StateManager` seam, the part of
the state contract that cannot be tested inside `@domain-tools/state` itself.

Models the suites are written against live in `test/models/`.
