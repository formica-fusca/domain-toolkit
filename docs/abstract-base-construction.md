# Constructing the abstract bases

**Status:** fixed — guard in place, but see §7 for the change that would make it unnecessary.
**Date:** 2026-08-15
**Scope:** `packages/domain-toolkit/src/lib/entity.ts` (`Entity.create`, `abstractBase`, `assertConcrete`),
`packages/domain-toolkit/src/lib/aggregate-root.ts` (`AggregateRoot.fromEvents`, `abstractBase`).

---

## Contents

- [Summary](#summary)
- [1. What compiled, and what it did](#1-what-compiled-and-what-it-did)
- [2. `abstract` is erased](#2-abstract-is-erased)
- [3. Why the constraint let it through](#3-why-the-constraint-let-it-through)
- [4. The comment that was wrong](#4-the-comment-that-was-wrong)
- [5. The fix](#5-the-fix)
- [6. What the fix does not cover](#6-what-the-fix-does-not-cover)
- [7. The change that would delete the guard](#7-the-change-that-would-delete-the-guard)
- [Appendix — reproducing this](#appendix--reproducing-this)
- [Related](#related)

---

## Summary

`Entity.create(...)` and `AggregateRoot.fromEvents(...)`, called on the abstract
base classes themselves, **compiled and ran**, returning live instances of
classes that exist only to be extended.

Two independent facts had to combine. `abstract` is erased at emit, so it stops
nothing at runtime. And the `this` constraint on both factories is written in
terms of `prototype`, which `typeof Entity` satisfies exactly as well as
`typeof BookStock` does — so nothing stopped it at compile time either.

The interesting part is §3. The obvious constraint, `Newable<T>`, **would have
caught this**: TypeScript refuses to assign an abstract constructor type to a
non-abstract one. It was abandoned for an unrelated reason — the base classes
declare `protected` constructors, which makes `Newable<T>` reject every
legitimate subclass too. So the defect is the price of a workaround for a
restriction the codebase imposed on itself, and §7 is about removing the cause
rather than the symptom.

Fixed with a runtime guard. The guard is correct and it is a workaround.

---

## 1. What compiled, and what it did

```ts
Entity.create(new TitleId("x"), {}); // compiles, does not throw
AggregateRoot.fromEvents(new TitleId("x"), {}, []); // compiles, does not throw
```

No cast, no `any`, no suppressed error. Both returned an object.

For `AggregateRoot` that object is an instance of a class whose
`assertInvariants` is declared `abstract` and therefore does not exist on the
prototype — an aggregate root that cannot check its own invariants, and will
throw `TypeError` the first time anything asks it to.

There was a third door, which the original probe missed: `AggregateRoot.create`.
`create` is declared on `Entity` and inherited by `AggregateRoot`, so it is
callable on `AggregateRoot` too. Any fix that only knows about `Entity` walks
straight past it. There is a test pinning this specifically.

## 2. `abstract` is erased

`abstract` is a compile-time annotation with no runtime representation. From
the emitted `packages/domain-toolkit/dist/lib/entity.js`:

```js
export class Entity extends StateManager {
```

No modifier survives, and there is nothing in the emitted class to consult. This
is why the guard has to be a value the runtime can see, and why it cannot be
inferred from the class itself.

The same erasure is why `assertInvariants` being `abstract` is no help: an
abstract method emits nothing at all, so the constructed object simply lacks it.

## 3. Why the constraint let it through

Both factories constrain their receiver like this:

```ts
static create<This extends { prototype: Entity<any, any> }>(
  this: This,
  id: IdOf<This["prototype"]>,
  initialState: StateOf<This["prototype"]>,
): This["prototype"]
```

`{ prototype: Entity<any, any> }` asks _which class is this?_ — and answers it by
reading the `prototype` property, which is typed as the class's instance type.
`typeof Entity` has a `prototype` of type `Entity`, so it satisfies the
constraint. Nothing in the shape asks whether the class is constructible.

The natural alternative is a construct signature:

```ts
type Newable<T> = new (...args: any[]) => T;
static create<T extends Entity<any, any>>(this: Newable<T>, ...): T
```

**This form does track abstractness.** Verified against four receivers:

| Receiver                                        | `this: Newable<T>`   | `this: { prototype: T }` |
| ----------------------------------------------- | -------------------- | ------------------------ |
| Subclass with a **public** constructor          | accepts              | accepts                  |
| Subclass **inheriting a protected** constructor | **rejects** — TS2684 | accepts                  |
| The **abstract base**                           | **rejects** — TS2684 | **accepts** ← the defect |

Both rejections are TS2684, and the sub-messages are different, which is what
makes the diagnosis clean:

```
Cannot assign a 'protected' constructor type to a 'public' constructor type.
Cannot assign an abstract constructor type to a non-abstract constructor type.
```

So the causal chain is:

1. The base classes declare **`protected` constructors**.
2. A subclass that declares no constructor of its own inherits that visibility,
   so `typeof BookStock` carries a protected construct signature.
3. A protected construct signature is not assignable to a public one, so
   `this: Newable<T>` is **uncallable on every aggregate in the model** — not on
   unusual ones, on all of them.
4. The constraint was therefore rewritten in terms of `prototype`, which asks the
   same "which class?" question without putting a construct signature under the
   assignability check.
5. `prototype` says nothing about abstractness. **That is the defect.**

Row 3 of the table is the one to keep. The `prototype` constraint did not merely
_fail to express_ abstractness — it **gave up a check the other form already
performed**. The defect was introduced by the fix to a different problem, which
is the ordinary way this happens.

For completeness: TypeScript does have `abstract new (...args: any[]) => T`, but
it points the wrong way. It is the signature that **accepts** abstract classes,
for code that legitimately handles them (a registry, a mixin factory). Plain
`new (...) => T` is already the one that rejects them.

## 4. The comment that was wrong

`aggregate-root.ts` carried this, in the doc block on `fromEvents`:

> It also means the call must be made on a subclass — `AggregateRoot.fromEvents(...)`
> does not compile.

It compiles. It ran. The claim was written carefully, by someone reasoning
correctly about what the `this` parameter was _for_, and it was still false —
the `this` parameter does type the receiver as the class actually called, and
that has no bearing on whether the base class is among the classes it accepts.

**The first correction was wrong too.** It replaced the false claim with an
assertion that `abstract new (...) => T` was "the form that would have expressed
it", unavailable for the same TS2684 reason. Both halves are false: `abstract
new` is the form that _accepts_ abstract classes (§3), and the form that would
have caught this — plain `Newable<T>` — is unavailable because of the
**protected** constructor, which is a different problem with a different TS2684
sub-message. Written while the correct table in §3 was already on screen.

The comment now carries the verified account, and both errors are recorded in
it. It is kept in the file as a standing reminder rather than quietly deleted: a
confidently-worded comment that contradicts the compiler is worth more as a
documented near-miss than as an absence — and this one has now missed twice, in
the same three lines, in the same direction. The recurring failure is reasoning
about assignability from what a signature is _for_ rather than compiling it.

## 5. The fix

A marker the runtime can see, on each class that is a base **in its own right**:

```ts
// entity.ts
protected static readonly abstractBase: boolean = true;

// aggregate-root.ts
protected static override readonly abstractBase: boolean = true;
```

and a shared check:

```ts
export function assertConcrete(target: unknown, method: string): void {
  if (typeof target !== "function" || !Object.hasOwn(target, "abstractBase")) {
    return;
  }
  throw new Error(
    `${target.name}.${method}() must be called on a concrete subclass.\n` +
      `${target.name} exists to be extended — building one directly ` +
      `produces an object with none of the behaviour its abstract members promise.`,
  );
}
```

called at the top of `Entity.create` and `AggregateRoot.fromEvents`.

Three details carry the design:

**`Object.hasOwn`, not a truth test.** Statics are inherited, so
`BookStock.abstractBase` reads `true` off `Entity`. A plain `if
(target.abstractBase)` would reject every legitimate call. Only the class that
**declares the field for itself** is a base.

**`AggregateRoot` re-declares it.** Not redundant. Without its own copy,
`Object.hasOwn(AggregateRoot, "abstractBase")` is `false`, and
`AggregateRoot.create(...)` — inherited from `Entity` — walks past the guard.
This is the same static-inheritance mechanic that caused the problem, used
deliberately.

**It lives in `entity.ts`, not a shared module.** `aggregate-root.ts` already
imports from `entity.ts`; a separate module imported by both would be cleaner in
the abstract, but an import in the other direction would close a cycle. It is
exported for `aggregate-root.ts` to use and is **not** re-exported from
`packages/domain-toolkit/src/index.ts` — it is internal.

A side effect worth having: a model author with an abstract intermediate of their
own can declare `abstractBase` on it and get the same protection. Tested.

## 6. What the fix does not cover

- **An abstract subclass that does not declare the marker.** `abstract class
DraftAggregate extends AggregateRoot {}` is constructible through `create`
  unless it opts in. The guard cannot detect abstractness — nothing can, at
  runtime — so it detects _declared intent_ instead.
- **Direct `new`.** `new (Entity as any)(id, state)` is unaffected. The guard is
  on the factories, which are the only supported construction path.
- **Subclasses that override `create`.** `Copy.create` builds directly and never
  reaches `assertConcrete`. Correct — it is a concrete class — but it means the
  guard is a property of the base factory, not of construction in general.

None of these are reachable by accident from ordinary use, which is the standard
the guard is written to.

## 7. The change that would delete the guard

Follow §3 back to step 1. **The protected constructors are the cause.**

With a public constructor on the abstract base, `Newable<T>` becomes usable
again — and it rejects the abstract base at compile time, for free:

```ts
abstract class Base {
  constructor(public n: number) {} // public
  static viaNewable<T extends Base>(this: Newable<T>, n: number): T {
    return new this(n);
  }
}
class Inherits extends Base {}

Inherits.viaNewable(1); // compiles
Base.viaNewable(1); // TS2684 — abstract ctor not assignable to non-abstract
```

Verified. Both expectations hold.

So the marker, `assertConcrete`, and their tests exist to compensate for a
constraint the codebase chose. Making the constructors public would move the
guarantee from runtime back to compile time, where it costs nothing and cannot
be forgotten by an abstract intermediate.

Whether that is the right call is a separate question with its own answer
already written up: `atlas/lib/2026-08-14_protected-constructors-on-abstract-classes-in-typescript.md`
concludes that on an **abstract** class, `abstract` already prevents
`new Base(...)`, so `protected` adds nothing to the base — its only remaining
effect is on subclasses, which stay un-instantiable until each redeclares a
constructor, and that redeclaration is public by default. The restriction is
undone by the boilerplate it forces.

If that argument holds, this document describes a runtime guard protecting
against a hole opened by a modifier that was not buying anything. That is worth
deciding deliberately rather than inheriting.

**Not changed here**, because it touches all four base classes and the test
model, and it is a design decision rather than a defect fix.

---

## Appendix — reproducing this

The constraint comparison in §3 — save as a file and compile. `--ignoreConfig`
is required, or `tsc` refuses to run with a `tsconfig.json` present alongside a
named file.

```ts
type Newable<T> = new (...args: any[]) => T;

abstract class Base {
  protected constructor(public n: number) {}
  static viaNewable<T extends Base>(this: Newable<T>, n: number): T {
    return new this(n);
  }
  static viaPrototype<This extends { prototype: Base }>(
    this: This,
    n: number,
  ): This["prototype"] {
    return new (this as unknown as Newable<This["prototype"]>)(n);
  }
}

class Inherits extends Base {} // inherits the protected constructor
class Public extends Base {
  constructor(n: number) {
    super(n);
  }
}

Inherits.viaNewable(1); // TS2684 — protected ctor
Public.viaNewable(1); // ok
Base.viaNewable(1); // TS2684 — abstract ctor
Inherits.viaPrototype(1); // ok
Base.viaPrototype(1); // ok  ← the defect
```

```bash
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target esnext my.probe.ts
# expect exactly two TS2684 diagnostics, with different sub-messages
```

The runtime behaviour, against the current tree:

```bash
yarn test   # includes packages/domain-toolkit/test/construction.test.ts
grep -n "class Entity" packages/domain-toolkit/dist/lib/entity.js   # no `abstract` survives the emit
```

## Related

- `docs/state-manager-init.md` — the neighbouring finding. Same `this`-parameter
  and `prototype`-constraint machinery, a different failure: there the technique
  cannot be transplanted at all, because a static factory does not survive being
  inherited by classes with a different constructor arity.
- `packages/domain-toolkit/src/lib/entity.ts` — `Entity.create`, the `abstractBase` marker, and
  `assertConcrete`.
- `packages/domain-toolkit/test/construction.test.ts` — the guard's tests, including the
  `AggregateRoot.create` door and the marker's own-property semantics.
- `atlas/lib/2026-08-14_protected-constructors-on-abstract-classes-in-typescript.md`
  — the argument that the protected constructors are not earning their place,
  which is §7's premise.
