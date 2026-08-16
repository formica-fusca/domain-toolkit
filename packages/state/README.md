# @domain-tools/state

The attribute bag a `domain-tools` entity **holds**, and the two types that make
creating one strict.

This package is `private: true`. It is never published: `domain-tools` inlines it
— JavaScript and declarations both — into its own `dist` at build time, which is
what lets that package keep advertising itself as dependency-free. See
`packages/domain-tools/tsup.config.ts` for how, and why it takes two settings.

`src/index.ts` is deliberately bare. Everything below used to live there as doc
comments; it is the reasoning behind the code, not a description of it, and this
is where it belongs.

## Contents

- [`State` — why `any`](#state--why-any)
- [`RequiredKeys` and `RequiredState`](#requiredkeys-and-requiredstate)
- [`detach` — the aliasing guarantee](#detach--the-aliasing-guarantee)
  - [The built-ins were wrong until 2026-08-18](#the-built-ins-were-wrong-until-2026-08-18)
- [`StateManager`](#statemanager)
- [Where the tests are](#where-the-tests-are)

---

## `State` — why `any`

```ts
export type State = Record<string, any>;
```

The `any` is the point, not an omission. A state bag holds whatever a model
declares, and this type exists only as the constraint every concrete `S`
satisfies. `unknown` would push a cast onto every read in every entity.

That is what the `no-explicit-any` disable on that line is for.

---

## `RequiredKeys` and `RequiredState`

### `RequiredKeys<T>`

The union of the keys of `T` that are **not** optional.

```ts
export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];
```

It maps every key to either its own name (keep) or `never` (drop), then indexes
with `[keyof T]` to collapse the result into a union of the surviving names.

The `-?` modifier is required here. Without it, optional source keys stay
optional in the map and the lookup folds `undefined` into the union.

`{} extends Pick<T, K>` is true exactly when `K` may be absent, since an
all-optional object type accepts `{}`. It deliberately asks about the property
**slot** rather than the value, so a required `deletedAt: Date | undefined` stays
required.

That `{}` is load-bearing, which is why the `no-empty-object-type` disable sits
on it: the rule's advice — use `object`, or `unknown` — would both answer a
different question.

The slot-versus-value distinction is not a detail. It is what gives a model two
separate ways to say "this might not have a value", which `RequiredState` then
treats differently.

### `RequiredState<S>`

The subset of `S` made of its required properties only — the state an entity may
be **created** with.

```ts
export type RequiredState<S extends State = State> = Pick<S, RequiredKeys<S>>;
```

Used by `Entity.create` and `AggregateRoot.fromEvents`, and nowhere else. It is a
strictness, not a convenience: a plain `S` already lets a caller _omit_ optional
properties, so if that were the goal this type would be doing nothing. What it
adds is the refusal — creation may not _supply_ one.

### The convention that makes this coherent

`?` is asked to mean one thing:

```ts
type BookStockState = {
  title: string; // required — creation must supply it
  author?: string; // DEFERRED — creation may not; behaviour fills it in
  deletedAt: Date | null; // SPARSE — required slot, may hold nothing
};
```

- **Deferred** (`prop?: T`): not knowable at creation, and some domain method or
  event handler later sets it. Excluded from `RequiredState`.
- **Sparse** (`prop: T | null`): may genuinely never have a value, and that is
  known at creation. The _slot_ is required, so it survives `RequiredKeys` and
  the caller passes `null` deliberately.

### The trap this convention exists to prevent

Mark a property `?` when it is really sparse, give it no setter, and it becomes
**silently unreachable** — creation may not supply it and nothing else ever will.
No error, just a property no code can write.

Every `?` in a state type is therefore a promise that behaviour exists to fill
it.

---

## `detach` — the aliasing guarantee

Copy a **container**, and nothing else. This is the one decision behind
`StateManager`'s aliasing guarantee, so it is worth stating what it does and does
not clone.

**Copied:** arrays and plain objects — values whose prototype is
`Object.prototype` or `null` — plus `Date`, `Map` and `Set`, rebuilt with their
own constructors. These are containers: what matters about them is their
contents, and sharing one is how a caller ends up holding a live handle on an
aggregate's state.

The built-ins are matched by `value.constructor === Date` rather than
`instanceof`. A subclass rebuilt by `new Map(m)` comes back a plain `Map`, which
is the same lookalike problem the prototype check avoids, so a subclass is
declined rather than downgraded.

**Not copied:** everything else, and the omission is the important half. A `Copy`
entity, an `Identifier`, a `Money` value object, a user-defined class — cloning
any of those produces a broken lookalike: it loses the prototype, so the methods
go; it cannot carry `#private` fields at all; and for an entity it would destroy
the identity that _is_ the entity. `BookStock` holds `Copy[]`, and cloning those
would hand the aggregate root a set of children whose recorded events are dropped
on the floor. So the array is copied and its elements are passed through by
reference.

The rule that falls out: **the container is the aggregate's, the elements are
whoever's they already were.**

Passing those through is safe as well as necessary, which is the half that makes
the rule sit still:

- a `ValueObject` is `Object.freeze`d at construction, so nobody can mutate one
  you are holding;
- an `Entity` holds its own `StateManager`, so its reads detach in turn — the
  membrane composes through it rather than stopping at it.

The one edge that survives: `pullDomainEvents` is public on `Entity`, so a caller
handed a child can drain its buffer and the root then publishes nothing.

### The built-ins were wrong until 2026-08-18

`Date` and `Map` used to sit on the not-copied side, on the argument that a
shallow spread of either produces a broken lookalike. That is true of _spreading_
and beside the point: `new Date(d)` and `new Map(m)` are exact. The reasoning
defeated a bad implementation and concluded the goal was unreachable, and a
mutable `Date` in state — `deletedAt: Date | null` is this README's own example
of a sparse property — stayed shared. The full argument is in
[`docs/detach-and-aliasing.md`](./docs/detach-and-aliasing.md).

### One level deep, deliberately

An array of plain objects yields a _fresh array holding the same objects_, so
mutating one of those elements still reaches the state.

The same boundary applies to a rebuilt `Map` or `Set`: the container is fresh,
the values in it are not.

Deeper is a modelling smell — a nested value wants to be a class, which `detach`
then passes through untouched by design — and `structuredClone` would close the
gap at the cost of breaking every entity in the bag. Deliberate, and tested.

It propagates outward, too. `Entity.mutate` rolls back through `snapshotState` /
`restoreState`, both of which go through `detach`, so the atomicity guarantee
inherits exactly this boundary — see
`packages/domain-tools/test/atomicity.test.ts:274`.

`detachAll` is simply `detach` applied to every property of a state bag.

One implementation note: `Object.getPrototypeOf` is typed `any`, and the
narrowing has to happen in the expression rather than on the variable —
annotating the variable leaves the `any` on the right-hand side.

---

## `StateManager`

An attribute bag. Nothing extends this class.

### Why it is not `Entity`'s base

It used to be, which is where three defects came from: a `static init` on this
class became a factory on every aggregate and built the wrong class, and this
class's public surface became every entity's public surface. `init` has since
been deleted and the types that served it now live on `Entity.create`, where they
make creation strict.

An entity _has_ state; it is not a kind of state manager, and the `extends` was
only ever there to donate `get` and `set`. `Entity` now holds one of these in a
`#private` field and delegates.

See `docs/inheritance-to-composition.md`.

### Why the constructor and `set` are public

That change is the reason. A class that _holds_ a `StateManager` is not a
subclass of it, so `protected` members are out of its reach (TS2445) —
composition cannot work without opening them up.

The encapsulation does not weaken, it relocates. The guarantee was `set is
protected`, erased at emit and addressed only to the compiler. It is now _nobody
can reach the manager_, which holds at runtime because `Entity` keeps it behind
`#state`.

`Entity` re-exposes writing as its own `protected set`.

### `get` and the implementation signature

```ts
get(): S;
get<K extends keyof S>(key: K): S[K];
get(key?: keyof S): S[keyof S] | S;
```

The implementation signature is checked against the overloads above for
_compatibility_ and never for soundness. Whatever the body returns, the call site
believes the overload — so the discrimination between "no key" and "a key" has to
be exactly right there, or the return type is a lie no one can see.

Hence `=== undefined` rather than `!key`. `""` and `0` are perfectly good property
keys and both are falsy, so the earlier check handed back the whole state bag to a
caller who had been promised `S[""]`.

### `set` and the key/value correlation

Write one property. `K` is what makes this safe, and it is worth reading closely
against the signature it replaced:

```ts
set(key: keyof S, value: S[keyof S]): void; // before
set<K extends keyof S>(key: K, value: S[K]): void; // after
```

`S[keyof S]` is an indexed access whose index is a _union_, so it distributes to
the union of every value type in `S`. The two parameters were then typed
independently of each other — nothing tied the value to the key it was being
filed under, and `set("count", "not a number")` type-checked.

Naming the key's type once, as `K`, and reusing it in `S[K]` is what correlates
them: `K` is inferred from the first argument, narrows to the literal `"count"`,
and `S[K]` resolves to `number` alone.

Note this is the same shape as the `get` overload above, which had it right all
along.

### `restore`

Replaces the whole bag, for rolling an operation back.

It detaches on the way in like every other write, so a snapshot handed here
cannot become a live handle on the restored state — which matters, because the
caller took that snapshot from `get` and may still be holding it.

---

## Where the tests are

`test/state-manager.test.ts` covers two of this class's three promises: that
`get` hands out state without handing out control, and that writing belongs to
the object's own behaviour.

The third — that creation is strict — cannot be tested here. It is enforced by
`Entity.create` and `AggregateRoot.fromEvents`, which live one package _up_ the
dependency arrow, so its tests are in
`packages/domain-tools/test/state.test.ts` alongside the two reachability
assertions, which need a real `Entity` for the same reason.

## Related reading

- `docs/inheritance-to-composition.md` — why this stopped being `Entity`'s base
- `docs/state-manager-init.md` — the deleted `static init` and the defects it hid
- `docs/operation-atomicity.md` — how `restore` is used to roll an operation back
