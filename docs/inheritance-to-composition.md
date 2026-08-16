# From `extends StateManager` to holding one

**Status:** done — applied, 54 tests passing, no behaviour change intended or observed.
**Date:** 2026-08-15
**Scope:** `packages/state/src/index.ts`, `packages/domain-tools/src/lib/entity.ts`,
`packages/state/test/state-manager.test.ts`, `packages/domain-tools/test/state.test.ts`.

---

## Contents

- [Summary](#summary)
- [1. The change](#1-the-change)
- [2. What it closed](#2-what-it-closed)
- [3. What it forced](#3-what-it-forced)
- [4. Why that is not a weakening](#4-why-that-is-not-a-weakening)
- [5. What deliberately did not change](#5-what-deliberately-did-not-change)
- [6. The test that moved](#6-the-test-that-moved)
- [7. Consequences for the open items](#7-consequences-for-the-open-items)
- [Related](#related)

---

## Summary

`Entity` no longer extends `StateManager`; it holds one in a `#private` field
and delegates `get` and `set`. Six lines of delegation.

`extends` donates three things — instance members, statics, and subtyping — and
only the first was ever wanted here. The other two were paid for anyway: a
factory that built the wrong class on every aggregate, and a public read surface
no model chose. Neither is now expressible.

This was a **structural** change. The existing suite passes unaltered except for
one assertion that was being made at the wrong boundary (§6).

## 1. The change

```ts
// before
export abstract class Entity<TId, S> extends StateManager<S> {
  protected constructor(id: TId, state: S) {
    super(state);
    this.id = id;
  }
}

// after
export abstract class Entity<TId, S> {
  readonly #state: StateManager<S>;

  protected constructor(id: TId, state: S) {
    this.id = id;
    this.#state = new StateManager<S>(state);
  }

  get(): S;
  get<K extends keyof S>(key: K): S[K];
  get(key?: keyof S) {
    return key === undefined ? this.#state.get() : this.#state.get(key);
  }

  protected set<K extends keyof S>(key: K, value: S[K]): void {
    this.#state.set(key, value);
  }
}
```

`AggregateRoot extends Entity` is untouched — that edge is genuine subtyping.
Every aggregate root _is_ an entity, and code that takes an `Entity` should
accept one.

## 2. What it closed

Against the compiled tree:

```
BookStock.init                     undefined
Entity.init                        undefined
AggregateRoot.init                 undefined
stock instanceof StateManager      false
proto chain of BookStock           Entity
own keys of a stock                id
(stock).state                      undefined
state reachable by reflection      false
```

Line by line:

- **`init` is gone from every entity class.** Not guarded, not renamed —
  _absent_. At the time of this refactor `StateManager` still declared it, but
  nothing inherited from that class any more, so it was no longer a method on
  `BookStock`; it has since been deleted outright. The defect in
  `docs/state-manager-init.md` has no expression left in this codebase.
- **`StateManager` is off the prototype chain.** The chain is
  `BookStock → Entity → (nothing)`.
- **The state bag is unreachable.** `Object.keys` used to print
  `["state", "id"]` and `(stock as any).state.title = "X"` worked from plain
  JavaScript. `#state` is a true private field; no reflection reaches it.

That last one is worth an honest note: **it is `#` doing the work, not
composition.** The old `private state: S` could have been `#state` inside
`StateManager` and produced the same result. It is bundled here because the
refactor touched the field anyway, not because `extends` was preventing it.

## 3. What it forced

`StateManager`'s constructor and `set` are now **public**. This was not
optional. A class that _holds_ a `StateManager` is not a subclass of it, and
`protected` does not reach across a composition boundary:

```
error TS2445: Property 'set' is protected and only accessible
              within class 'Manager<S>' and its subclasses.
```

`protected` is a subclass-boundary word. Any move from inheritance to
composition surfaces every `protected` member the subclass was relying on, and
each one must be opened up or delegated. Here there were exactly two.

## 4. Why that is not a weakening

Look at where the manager lives. `Entity` holds the only reference in existence,
in a `#private` field, so no caller can obtain the object to call the public
method on.

|                    | before               | after                        |
| ------------------ | -------------------- | ---------------------------- |
| The rule           | `set` is `protected` | nobody can reach the manager |
| Enforced by        | the compiler         | the runtime                  |
| Survives plain JS? | no — erased at emit  | yes                          |
| Survives a cast?   | no                   | yes                          |

A strictly stronger guarantee, delivered by a strictly weaker-looking
declaration. The general form: **encapsulation is a property of reachability,
not of keywords.** `private` and `protected` are claims addressed to the
compiler and erased before anything runs.

`Entity` re-exposes writing as its own `protected set`, so application code sees
exactly what it saw before.

## 5. What deliberately did not change

- **`Entity.get` is still public.** Composition makes `protected get`
  _available_ (an inherited surface can be widened, never narrowed, so under
  `extends` the decision could not be made here at all), but the decision taken
  on that defect was a different one — copy on read and copy on construct — and
  it has since been implemented on top of this refactor. `get` stays public and
  is no longer a write channel.
- **Aliasing was left untouched _by this commit_.** The constructor still stored
  its seed by reference and `get()` still copied one level deep when the
  refactor landed, so that the diff stayed structural and the suite stayed the
  control. Both were closed immediately afterwards; see §7.
- **`init`, `RequiredKeys` and `RequiredState` were still in
  `@domain-tools/state`** when this refactor landed. Settled since: `init` is
  deleted, and the two types moved onto `Entity.create` and
  `AggregateRoot.fromEvents` to make creation strict. See
  `docs/state-manager-init.md` §7.
- **The `abstractBase` guard stays.** It addresses a different hole, and
  `docs/abstract-base-construction.md` §7 has its own open question.

Keeping behaviour fixed is what makes the refactor reviewable: the diff is
structural, and the suite is the control.

## 6. The test that moved

One assertion broke, and it broke correctly. `packages/domain-tools/test/state.test.ts` had:

```ts
test("set is not reachable from outside the entity", () => {
  const shelf = Shelf.of("A1"); // a bare StateManager subclass
  // @ts-expect-error `set` is protected
  shelf.set("label", "B2");
});
```

With `set` public on `StateManager`, the directive became unused — which is
itself an error (TS2578), so the build failed and named the line.

The test's _title_ was always right and its _subject_ was always wrong: it says
"outside the entity" and asserts against something that is not an entity. It now
takes a `BookStock`, where `set` is `protected` on `Entity` and the guarantee
actually lives. A second test was added alongside it, asserting the manager is
unreachable by reflection — the runtime half of §4.

> A test that verifies a rule at the wrong boundary passes for years and
> protects nothing.

## 7. Consequences for the open items

- **Hole 4 (`init`)** — **done.** The refactor downgraded it from a footgun to
  a tidy-up by removing the inheritance that put `init` on every aggregate;
  `init` was then deleted outright, and `RequiredKeys` / `RequiredState` were
  moved to `Entity.create` and `AggregateRoot.fromEvents`, where they make
  creation strict rather than sitting on a path nothing called.
- **Holes 1 and 2 (`get` as a write channel, constructor aliasing)** — **done,
  immediately after this refactor.** A `detach` helper in `@domain-tools/state`
  copies containers — arrays and plain objects — on construction, on read and on
  write, so nothing enters or leaves the bag by reference. Deliberately it does
  _not_ clone anything else: a shallow spread of a `Copy`, an `Identifier` or a
  `Date` produces a broken lookalike with no prototype and no `#private` fields,
  and for an entity it would destroy the identity that _is_ the entity. The rule
  is **the container is the aggregate's, the elements are whoever's they already
  were** — which is what lets `BookStock` keep handing its `Copy` children to
  the root for draining. Verified: the child-event drain still works unchanged.
- **Hole 3 (`apply()` atomicity)** — unaffected. It is about `AggregateRoot`,
  not about who owns state.
- **Hole 5 (`abstractBase`)** — unaffected here, but note the parallel: §7 of its
  document asks whether the `protected` constructors are worth what they cost,
  and this refactor is a data point. Composition already forced two `protected`
  members open with no loss.

## Related

- `docs/state-manager-init.md` — the defect this refactor makes inexpressible,
  and the still-open decision about the code it lived in.
- `docs/abstract-base-construction.md` — the neighbouring finding, and the same
  compile-time-versus-runtime question from the other direction.
- `atlas/courses/inheritance-vs-composition-entity-state/` — the full treatment,
  including a two-workspace monorepo holding both designs side by side, and an
  honest scoring of which improvements composition actually earned.
