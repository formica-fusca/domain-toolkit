# Atomic operations — `mutate` and the invariant boundary

**Status:** done — `mutate` is mandatory; 78 tests passing.
**Date:** 2026-08-15
**Scope:** `packages/domain-tools/src/lib/aggregate-root.ts` (`mutate`, `fromEvents`),
`packages/domain-tools/src/lib/entity.ts` (snapshot/restore, event mark/rewind),
`packages/state/src/index.ts` (`restore`), `packages/domain-tools/test/atomicity.test.ts`, and the models.

---

## Contents

- [Summary](#summary)
- [1. The defect](#1-the-defect)
- [2. Why the operation is the unit, not the event](#2-why-the-operation-is-the-unit-not-the-event)
- [3. `mutate`](#3-mutate)
- [4. The primitives it needs](#4-the-primitives-it-needs)
- [5. `fromEvents` asserts once, at the end](#5-fromevents-asserts-once-at-the-end)
- [6. What rollback does not cover](#6-what-rollback-does-not-cover)
- [7. Optional, not mandatory](#7-optional-not-mandatory)
- [Related](#related)

---

## Summary

A domain operation now either completes with the aggregate's invariants intact,
or leaves no trace — no state change, and no event waiting to publish.

Before, a handler mutated, the event was recorded, and _then_ `assertInvariants()`
threw. The caller caught the error and believed nothing had happened, while the
aggregate sat in an illegal state holding an event describing it. The next
`save()` would have published that event to the rest of the system.

The fix is a wrapper the model calls, `mutate(fn)`, not a hook the framework
fires — for reasons in §2 that are properties of this codebase rather than
preferences.

## 1. The defect

```ts
protected apply(event: DomainEvent): void {
  this.#invokeHandler(event); // mutates
  this.record(event);         // buffers
}

// and in the model:
addCopy(barcode: string): void {
  this.apply(new CopyAdded(barcode));
  this.assertInvariants();    // ← too late, and easy to forget
}
```

Adding a duplicate barcode left:

```
barcodes = ["LIB-1", "LIB-1"]   ← state mutated
hasPendingEvents = true          ← CopyAdded still buffered
```

Two failures at once: an object that violates its own rule, and a fact about the
world queued for broadcast that never truthfully happened.

## 2. Why the operation is the unit, not the event

The obvious fix is to put snapshot-assert-rollback inside `apply`. Two facts in
this codebase rule that out, and both are verified in `packages/domain-tools/test/atomicity.test.ts`.

**An aggregate is not valid at every instant.** `Member` is created with
`{ name: "" }` and acquires a name only on `join`, so its seed fails its own
`assertInvariants`:

```
seed FAILS assertInvariants: invariant "a joined member has a name" violated
```

Creation and mid-replay are legitimately invalid states. Only the boundaries
_between completed operations_ are not. A framework-fired check at construction
or between replayed events would reject valid models.

**`apply` is not the only way state changes.** `BookStock.adopt` mutates through
`set` and applies no event at all — and, before this change, checked nothing:

```ts
adopt(copy: Copy): void {
  this.set("copies", [...this.get("copies"), copy]); // no assertInvariants
}
```

A check hung off `apply` would never have seen it.

So the invariant belongs at the **operation** boundary, and an operation is
something only the model can delimit. That also buys a property per-event
checking would forbid: an operation may apply several events and be invalid in
between, as long as it is valid when it returns.

## 3. `mutate`

```ts
protected mutate(operation: () => void): void {
  const stateBefore = this.snapshotState();
  const eventMark = this.markEvents();

  try {
    operation();
    this.assertInvariants();
  } catch (error) {
    this.restoreState(stateBefore);
    this.rewindEvents(eventMark);
    throw error;
  }
}
```

At the call sites:

```ts
addCopy(barcode: string): void {
  this.mutate(() => this.apply(new CopyAdded(barcode)));
}

adopt(copy: Copy): void {
  this.mutate(() => this.set("copies", [...this.get("copies"), copy]));
}
```

The manual `assertInvariants()` calls in the models are gone — `mutate` makes
them redundant, and it also covers the methods that never had one.

Note that this is **rollback, not poisoning.** A caught error leaves an object
you can keep using; the alternative design — "state stays mutated, discard and
reload the aggregate" — relies on a contract the type system cannot express, and
would relocate the trap rather than remove it. There is a test asserting the
aggregate still works after a failed operation.

## 4. The primitives it needs

Four `protected` members on `Entity`, added for `mutate` and deliberately not
part of the public surface:

| Member               | Why it is what it is                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snapshotState()`    | Returns `#state.get()`, which is already detached — so the snapshot cannot change under the operation it is protecting.                                                                                                                    |
| `restoreState(s)`    | Delegates to a new `StateManager.restore`, which detaches on the way in like every other write, so the snapshot cannot become a live handle on the restored state.                                                                         |
| `markEvents()`       | A **count**, not a copy of the buffer. Within an operation the buffer is append-only — nothing removes an event except a drain, and a drain cannot interleave with synchronous code — so truncating back to a length is exact and cheaper. |
| `rewindEvents(mark)` | `#recordedEvents.length = mark`.                                                                                                                                                                                                           |

## 5. `fromEvents` asserts once, at the end

```ts
aggregate.replayAll(events);
aggregate.assertInvariants();
return aggregate;
```

Once, and never between events — §2's first fact says replay walks through
states the domain would reject. What this stops is a corrupt or truncated stream
rebuilding **silently** into an aggregate that then passes every later check:

```ts
Member.fromEvents(new MemberId("m-1"), { name: "" }, []);
// throws: a joined member has a name
```

An empty stream cannot produce a joined member, and now says so at the point of
rehydration rather than at some unrelated call later.

## 6. What rollback does not cover

Both limits are pinned by tests, so they are known rather than assumed.

- **A child entity's own event buffer is not rewound.** Each `Entity` keeps its
  events in a `#private` field, and a root cannot reach a sibling's private
  state — `childEntities()` is typed as `Entity`, and TypeScript only permits
  protected access through the accessing class's own type. In practice a root
  that mutates a child does so through the child's method, and the child keeps
  its event.
- **Restoration is one level deep**, the same boundary as every other copy in
  this library (see `detach` in `@domain-tools/state`). A mutation reaching _inside_
  a nested element is not rolled back, for the same reason it is not isolated on
  read.

## 7. Optional, not mandatory

`mutate` is a wrapper the model chooses to call. It could be made impossible to
forget — `apply` and `set` could throw when called outside a `mutate` block —
which would guarantee no unguarded mutation ever ships, at the cost of a rule
every model author has to learn, and of turning today's unguarded methods into
runtime errors rather than silent gaps.

Not built. Every mutating method in the current models now uses `mutate`, so the
question is about what a _future_ model author can get wrong, and it is worth
deciding on its own rather than as a side effect of this change.

## Related

- `docs/inheritance-to-composition.md` — the refactor that made `Entity` hold
  its state, which is what `snapshotState` / `restoreState` delegate through.
- `docs/state-manager-init.md` — the neighbouring finding, and the `detach`
  boundary that §6's second limit inherits.
- `docs/domain-event-ownership.md` — why §6's limit exists at all: the event
  buffer belongs to each `Entity`, not to the root that drains it.
