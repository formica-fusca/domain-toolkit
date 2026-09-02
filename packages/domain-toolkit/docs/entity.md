# `Entity`

Design notes for [`../src/lib/entity.ts`](../src/lib/entity.ts).

The source keeps the contract — what an entity is, how to create one, what each
method promises. This file keeps the reasoning: why the class is shaped this
way, what it used to be, and what broke.

## Contents

- [`IdOf` and `StateOf` — why `any` in the unasked slot](#idof-and-stateof--why-any-in-the-unasked-slot)
- [An entity _has_ state; it is not a kind of state manager](#an-entity-has-state-it-is-not-a-kind-of-state-manager)
- [`abstractBase` — a runtime guard for a compile-time claim](#abstractbase--a-runtime-guard-for-a-compile-time-claim)
- [`create` — the `this` parameter and the `prototype` constraint](#create--the-this-parameter-and-the-prototype-constraint)
- [Why `RequiredState` and not the whole state](#why-requiredstate-and-not-the-whole-state)
- [`get` and `set` after the refactor](#get-and-set-after-the-refactor)
- [The mutation context](#the-mutation-context)
- [`mutate` — why the operation is the unit, and not the event](#mutate--why-the-operation-is-the-unit-and-not-the-event)
- [`markEvents` — a count, not a copy](#markevents--a-count-not-a-copy)
- [`assertConcrete` — why it lives in this file](#assertconcrete--why-it-lives-in-this-file)

---

## `IdOf` and `StateOf` — why `any` in the unasked slot

```ts
export type IdOf<E> = E extends Entity<infer TId, any> ? TId : never;
export type StateOf<E> = E extends Entity<any, infer S> ? S : never;
```

Both aliases are two-parameter conditionals that only ask about one parameter.
`IdOf` infers the id and ignores the state; `StateOf` does the reverse. The
`any` is the ignored slot.

`unknown` will not do there. It narrows what the `extends` clause matches, so a
concrete entity — whose state is some specific object type, not `unknown` —
stops satisfying the pattern, and both aliases collapse to `never`. That is what
the `no-explicit-any` disable on each line is for.

The `infer` is what lets `create` demand the _right_ identifier rather than any
`Identifier`: it reads the type argument back off the subclass's
`extends Entity<...>` clause, so `IdOf<BookStock>` is `TitleId`.

## An entity _has_ state; it is not a kind of state manager

This class used to read `extends StateManager<EntityState>`. That was code reuse
wearing an `is-a` claim.

`extends` donates three things — instance members, statics, and subtyping — and
only the first was wanted here. The other two were paid for anyway:

- `StateManager.init` became a factory on every aggregate, and it built the
  wrong class.
- `StateManager`'s public surface became every entity's public surface. An
  inherited surface can be widened and never narrowed, so there was no way to
  decide an entity's API here at all.

The state manager is now held in a `#state` field and the two methods that were
the point of the relationship are delegated.

`#private` and not merely `private`: this field is what makes the manager's
public `set` harmless, and a `private` field would be erased at emit and
reachable from plain JavaScript.

Full record: [`inheritance-to-composition.md`](../../../docs/inheritance-to-composition.md)
and [`state-manager-init.md`](../../../docs/state-manager-init.md). The other
half of the story — why the manager's constructor and `set` had to become public
— is in [`@domain-toolkit/state`'s README](../../state/README.md#why-the-constructor-and-set-are-public).

## `abstractBase` — a runtime guard for a compile-time claim

`abstract` alone cannot do this job. It is erased at emit, so it stops nobody at
runtime; and the `this` constraint on `create` is written in terms of
`prototype` — see below — which `typeof Entity` satisfies just as well as
`typeof BookStock` does.

`Entity.create(id, {})` therefore compiled _and_ ran, handing back a live
instance of an abstract class with none of the behaviour its abstract members
promise.

The check is `Object.hasOwn`, not a truth test. Statics are inherited, so
`BookStock.abstractBase` reads `true` off `Entity` too — only the class that
declares the field for itself is a base. That also makes the marker available to
model authors: an abstract intermediate of your own can declare it and get the
same protection.

`AggregateRoot` declares its own copy for exactly this reason. Without it,
`Object.hasOwn(AggregateRoot, "abstractBase")` is `false` and
`AggregateRoot.create(...)`, inherited from here, walks straight past the guard.

## `create` — the `this` parameter and the `prototype` constraint

```ts
static create<This extends { prototype: Entity<any, any> }>(
  this: This,
  id: IdOf<This["prototype"]>,
  initialState: RequiredState<StateOf<This["prototype"]>>,
): This["prototype"]
```

The whole signature exists to answer one question: how does a method declared on
the base class know it is producing a `BookStock`?

The answer is the `this` parameter — a parameter in name only, erased at emit,
whose sole job is to type the receiver. `BookStock.create(...)` binds `This` to
`typeof BookStock`, and every other type here is derived from it. A type
parameter that appeared _only_ in the return position would have no inference
site at all and would silently collapse to its constraint, handing back a bare
`Entity`.

### Why `prototype` and not `Newable<T>`

`This` is constrained by its `prototype` rather than by a construct signature —
the shape `Newable<T>` would express — because this class's constructor is
`protected`, and TypeScript refuses to assign a protected constructor type to a
public one (TS2684). A class's `prototype` property is typed as its instance
type, so reading it asks the same "which class?" question without ever putting a
construct signature under the assignability check.

That is also why the body still needs a cast: there is no way to _write_
"protected new".

### What that costs

**Constructor arguments go unchecked.** A subclass that declares its own
constructor with a different shape will have arguments passed to it that it
never asked for.

**Abstractness stops being tracked.** Reading `prototype` asks "which class?"
without asking "is it concrete?", which is the hole `abstractBase` repairs at
runtime. Worth naming precisely, because `Newable<TAggregate>` **would have
caught it** — a non-abstract construct signature rejects an abstract class,
TS2684 again. Switching to `prototype` to get past the _protected_-constructor
problem gave up that check as collateral.

(`abstract new (...) => T` does not help. It is the form that deliberately
_accepts_ abstract classes, for registries and mixin factories. It points the
wrong way.)

[`abstract-base-construction.md`](../../../docs/abstract-base-construction.md) §7
records the change that would hand the check back to the compiler.

## Why `RequiredState` and not the whole state

Creation takes the entity's **required** properties only:

```ts
BookStock.create(id, { title: "Dune", barcodes: [], copies: [] }); // ok
BookStock.create(id, {
  title: "Dune",
  barcodes: [],
  copies: [],
  author: "Herbert",
}); // TS2353
```

This is a strictness, not an ergonomic. A plain `S` already permits _omitting_
optional properties — that much TypeScript gives for free — so the only thing
`RequiredState` adds is the refusal, and the refusal is the point: an entity
begins life holding exactly what it cannot exist without, and everything else
arrives through behaviour that means something in the domain.

It depends on a convention — `?` means _deferred_, not _nullable_ — and exists
to prevent a specific trap: an optional property with no setter becomes silently
unwritable. Both are spelled out in
[`@domain-toolkit/state`'s README](../../state/README.md#requiredkeys-and-requiredstate).

The cast in the body is the one `RequiredState` has always needed: a value
carrying every required property of `S` and none of its optional ones _is_ a
valid `S`, but the compiler cannot prove that for an unresolved generic. It is
kept against the linter, which reads it as unnecessary only because `Newable`
has already erased the parameter to `any[]` — deleting it would drop the one
place that claim is written down.

## `get` and `set` after the refactor

`get` is public, as it was when inherited — but now because this class _chose_
it, in one line, rather than because a standalone attribute bag had a sensible
default that inheritance promoted into every aggregate's API.

`set` is `protected`, so state changes belong to the entity's own behaviour and
mean something in the domain. The manager's own `set` is public — it is an
internal type, deliberately absent from this package's exports — and that costs
nothing, because `#state` is the only reference to it in existence and it is
`#private`.

Both delegate to the held manager, which detaches on read and on write. Reading
does not hand out a live handle on state, at either overload; the aliasing
boundary and its one deliberate limit are described in
[`@domain-toolkit/state`'s README](../../state/README.md#detach--the-aliasing-guarantee).

## The mutation context

`#mutationDepth` is a depth rather than a boolean, because operations nest. A
domain method may legitimately call another, and a boolean would have the inner
one's `finally` close the outer one's context — after which the rest of the
outer operation would be refused.

`runInMutation` is separate from `mutate` because rehydration needs the context
without the check: `AggregateRoot.replay` reaches `set` through its handlers, and
a per-event `assertInvariants` would reject valid histories that pass through
states the domain forbids.

`assertInMutation` is what makes `mutate` mandatory rather than a convention.
The objection is not that the mutation is wrong in itself — it is that a change
made outside an operation is one **nothing will check and nothing can roll
back**, which is exactly the defect `mutate` exists to close. Refusing it at the
point of the mutation names the method that forgot; allowing it means finding
out later, from a corrupt aggregate whose history no longer explains it.

It is declared on `Entity` and overridden nowhere. Overriding a `protected`
member in `AggregateRoot` — the first shape this took — silently breaks
`BookStock`'s assignability to `Entity<any, any>`, which is the constraint every
factory in this library is written against. `src/` still compiled; every test
file stopped. See
[`operation-atomicity.md`](../../../docs/operation-atomicity.md) §4.

## `mutate` — why the operation is the unit, and not the event

The obvious place for atomicity is `AggregateRoot.apply`: mutate, record,
assert, roll back. Two facts rule that out.

**An aggregate is not valid at every instant.** `Member` is created with
`{ name: "" }` and acquires a name only on `join`, so its seed fails its own
`assertInvariants`. Creation and mid-replay are legitimately invalid; only the
boundaries _between completed operations_ are not.

**`apply` is not the only way state changes.** `BookStock.adopt` mutates through
`set` and applies no event at all. A check hung off `apply` would never see it —
which is why the guard is on `set` and why `apply` asks for it too.

So the invariant belongs at the operation boundary, and an operation is
something only the model can delimit — hence a wrapper the model calls rather
than a hook the framework fires. It also lets one operation apply several events
and be invalid in between, which per-event checking forbids.

### What rollback covers, and what it does not

This object's own state and event buffer. It does **not** rewind events recorded
by _child_ entities during the operation: their buffers are `#private` to each
`Entity`, and a root cannot reach a sibling's private field. Pinned by a test,
so the limit is known rather than a surprise.

The snapshot is `snapshotState`, detached one level deep — the same boundary as
every other copy in this library. `snapshotState` and `restoreState` are
`protected` and deliberately not part of the public surface: they exist for
`mutate`, not for callers to take savepoints with.

## `markEvents` — a count, not a copy

The buffer is append-only within an operation: nothing removes an event except a
drain, and a drain cannot interleave with a synchronous operation. Truncating
back to a length is therefore exact, and cheaper than snapshotting an array.

## `assertConcrete` — why it lives in this file

It is shared by `Entity.create` and `AggregateRoot.fromEvents`, both of which are
reachable on the abstract bases themselves.

It lives here rather than in a shared module because `aggregate-root.ts` already
imports this file, and a second import in the other direction would close a
cycle.
