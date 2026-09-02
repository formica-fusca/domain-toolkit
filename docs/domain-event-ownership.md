# Domain-event ownership — where `Entity` stops and `AggregateRoot` starts

**Status:** reference — describes the design as it stands; no change proposed.
**Date:** 2026-08-17
**Scope:** `packages/domain-toolkit/src/lib/entity.ts` (the buffer, `record`,
`pullDomainEvents`, `markEvents`/`rewindEvents`),
`packages/domain-toolkit/src/lib/aggregate-root.ts` (`childEntities`, `apply`,
`replay`, `fromEvents`, the two overrides),
`packages/domain-toolkit/src/lib/event-sourcing/` (`@Handle`, `HandleRegistry`),
`packages/domain-toolkit/test/events.test.ts`, and the models in
`packages/domain-toolkit/test/models/`.

---

## Contents

- [Summary](#summary)
- [1. Who owns what](#1-who-owns-what)
- [2. Why the buffer lives on `Entity`](#2-why-the-buffer-lives-on-entity)
- [3. The line, precisely — `record` versus `apply`](#3-the-line-precisely--record-versus-apply)
- [4. Three asymmetries that follow](#4-three-asymmetries-that-follow)
- [5. The discipline the compiler cannot enforce](#5-the-discipline-the-compiler-cannot-enforce)
- [6. A trace through the models](#6-a-trace-through-the-models)
- [7. The heuristic](#7-the-heuristic)
- [Related](#related)

---

## Summary

The split is not "events belong to aggregates". Domain events are divided
_across_ the two classes, with a different half on each:

> **`Entity` can say what happened to it. `AggregateRoot` decides what leaves —
> and can be rebuilt from what left.**

Knowledge is local; authority is central. Everything below falls out of that one
sentence.

`Entity` is the **unit of memory**. `AggregateRoot` is the **unit of consistency
and publication**. Events are recorded at the unit of memory and published at the
unit of consistency — and everything awkward about the split (§4) is a
consequence of those two units not being the same object.

## 1. Who owns what

| Member                        | `Entity`              | `AggregateRoot`                                  |
| ----------------------------- | --------------------- | ------------------------------------------------ |
| `#recordedEvents` buffer      | **owns it**           | inherits; cannot reach it (`#private`)           |
| `record(event)`               | **`protected`**       | inherits                                         |
| `pullDomainEvents()`          | drains **own** buffer | `override` — own **+ declared children**, sorted |
| `hasPendingEvents`            | own buffer only       | `override` — own ‖ any child                     |
| `markEvents` / `rewindEvents` | **owns them**         | inherits                                         |
| `childEntities()`             | —                     | **declares the boundary**                        |
| `apply()` / `replay()`        | —                     | **routing via `@Handle`**                        |
| `fromEvents()`                | —                     | **rehydration**                                  |

The buffer, the recording, and the rollback marks all live on `Entity`. The root
adds exactly four things: **routing, collection, ordering, rehydration.**

## 2. Why the buffer lives on `Entity`

If the buffer lived on the root, a `Copy` would need a back-reference to its
`BookStock` in order to record anything — and a child holding a pointer to its
own root is precisely the coupling the aggregate pattern exists to forbid.

Putting the buffer on the child means the child needs to know nothing about who
owns it. The root does the reaching, in one direction only, through
`childEntities()`.

## 3. The line, precisely — `record` versus `apply`

This is the part that is genuinely easy to miss, because both put an event into
the same buffer.

```ts
// Entity — available to any entity
protected record(event) { this.#recordedEvents.push(event); }

// AggregateRoot — only here
protected apply(event) {
  this.assertInMutation("apply");
  this.#invokeHandler(event);   // ← route to the @Handle method
  this.record(event);           // ← then record
}
```

`record` **describes**. `apply` **causes, then describes** — one call produces
both the state change and the history, which is why the two cannot drift apart.

A child entity cannot have `apply`, and this is structural rather than a
convention: `@Handle` writes into `WeakMap<AggregateRootClass, HandleHandler>`,
and `AggregateRootClass` is `{ prototype: AggregateRoot<any, any>; name: string }`.
A `Copy` does not satisfy it.

**Event sourcing is an aggregate-root capability. A child entity gets event
_reporting_ only.**

`Copy` shows the consequence sharply:

```ts
export class Copy extends Entity<CopyId, { damaged: boolean }> {
  damage(): void {
    // Records the fact. Note what it does *not* do: set `damaged` to true.
    this.record(new CopyDamaged(this.id.value));
  }
}
```

The event says the copy was damaged; `get("damaged")` still returns `false`.
Nothing is wrong with the code — that is exactly what "record without apply"
means. A child that wants state _and_ history has to write both by hand, and
nothing checks that it did. That guarantee belongs to `apply`, which lives one
class up.

## 4. Three asymmetries that follow

### 4.1 The mutation guard covers `set` and `apply` — not `record`

`assertInMutation` is called from `set` and from `apply`. `record` pushes
unguarded, which is why `Copy.damage()` works with no `mutate()` wrapper.

Defensible — recording a fact is not a state change, so there is no invariant to
check — but it means a child can record outside any operation, and nothing will
roll that back.

### 4.2 Rollback stops at the boundary

`mutate` lives on `Entity` and rewinds `this.#recordedEvents`. `#private` means
per-instance, so a root physically cannot rewind a child's buffer.

Roll back a root operation that touched a child, and the child's events survive.
This is pinned by a test and recorded in
[`operation-atomicity.md`](./operation-atomicity.md) §6 — a known limit rather
than a bug, but the sharpest edge in the design.

### 4.3 `pullDomainEvents()` is `public` on `Entity`

Anyone holding a `Copy` can drain it directly. Those events then never pass
through the root — gone, unpublished.

`childEntities()` is the _only_ thing that makes a child reachable. Forget to
list one and its events are silently dropped, with no error and no warning:

```ts
const orphan = Copy.create(new CopyId("LIB-9")); // never adopt()ed
orphan.damage();
assert.equal(stock.pullDomainEvents().length, 0);
assert.equal(orphan.hasPendingEvents, true, "silently stranded, by design");
```

## 5. The discipline the compiler cannot enforce

Rule (1) of `AggregateRoot`'s class comment — "nothing outside the aggregate may
hold a reference to a child entity" — reads like DDD boilerplate. It is in fact
the **only** thing standing between the model and the two failure modes in §4.2
and §4.3.

TypeScript enforces none of it:

- `pullDomainEvents` is `public`;
- `Copy` is exported;
- `childEntities()` returning an incomplete list type-checks perfectly.

Worth knowing explicitly, rather than assuming the types have it covered.

## 6. A trace through the models

From `test/events.test.ts`, "child events are drained through the root, in causal
order":

<!-- prettier-ignore -->
```text
stock.adopt(copy)        root:  mutate → set("copies", …)      no event at all
copy.damage()            child: record(CopyDamaged)           seq = N
stock.addCopy("LIB-2")   root:  mutate → apply(CopyAdded)      seq = N+1
                                  → @Handle routes to onCopyAdded
                                  → onCopyAdded calls set("barcodes", …)
                                  → then records

stock.pullDomainEvents()
    drains its own    → [CopyAdded]
    then children's   → [CopyDamaged]
    sorts by sequence → [CopyDamaged, CopyAdded]     ← causal order restored
```

The sort is the fourth thing the root adds. Without it, every child event lands
after every root event, and the log would claim the copy was damaged _after_ the
second copy was added — which is false.

Note also that `adopt` mutates through `set` and applies no event at all. That is
the case a check hung off `apply` would never see, and one of the two reasons the
invariant guard sits on the operation rather than on the event — see
[`operation-atomicity.md`](./operation-atomicity.md) §2.

## 7. The heuristic

When modelling and unsure which side of the line you are on:

- **Does something outside need to know?** → it is an event, and it exits through
  the root, always.
- **Does the event change this object's own state?** → `apply`, so the object
  must be an aggregate root.
- **Does it just report what happened here?** → `record`, and any entity can do
  it.
- **Does it own the rule?** → root. Children hold data and describe their own
  history; they do not guard invariants.

## Related

- [`entity-aggregate-membership.md`](./entity-aggregate-membership.md) — the
  companion question: which entities are allowed to exist where, and why an
  unadopted child is a bug rather than a style choice
- [`operation-atomicity.md`](./operation-atomicity.md) — §2 why the operation is
  the unit and not the event; §6 what rollback does not cover
- [`../packages/domain-toolkit/docs/aggregate-root.md`](../packages/domain-toolkit/docs/aggregate-root.md)
  — the cycle guard, and why `hasPendingEvents` is overridden at all
- [`../packages/domain-toolkit/docs/entity.md`](../packages/domain-toolkit/docs/entity.md)
  — `markEvents` as a count rather than a copy
- [`../packages/domain-toolkit/docs/domain-event.md`](../packages/domain-toolkit/docs/domain-event.md)
  — why ordering uses a counter and not `occurredAt`
- [`../packages/domain-toolkit/docs/handle-registry.md`](../packages/domain-toolkit/docs/handle-registry.md)
  — why the registry is keyed by `AggregateRootClass`
