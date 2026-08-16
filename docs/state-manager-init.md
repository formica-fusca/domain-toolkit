# `StateManager.init` and the `RequiredKeys` machinery

**Status:** resolved — `init` deleted; `RequiredKeys` / `RequiredState` moved to
`Entity.create` and `AggregateRoot.fromEvents`. **§3 and §4 reached the wrong
verdict; see §0.**
**Date:** 2026-08-15
**Scope:** `packages/state/src/index.ts`, `packages/domain-tools/src/lib/entity.ts`,
`packages/domain-tools/src/lib/aggregate-root.ts`,
`packages/state/test/state-manager.test.ts`, `packages/domain-tools/test/state.test.ts`.

---

## Contents

- [Summary](#summary)
- [0. Correction — the intent was misread](#0-correction--the-intent-was-misread)
- [1. The code under discussion](#1-the-code-under-discussion)
- [2. Defect one — `init` builds the wrong class](#2-defect-one--init-builds-the-wrong-class)
- [3. Defect two — `RequiredState<S>` buys nothing](#3-defect-two--requiredstates-buys-nothing)
- [4. Defect three — `RequiredState<S>` rejects a legal argument](#4-defect-three--requiredstates-rejects-a-legal-argument)
- [5. Why `init` cannot be repaired in place](#5-why-init-cannot-be-repaired-in-place)
- [6. Why none of this was caught](#6-why-none-of-this-was-caught)
- [7. What was done](#7-what-was-done)
- [Appendix — reproducing this](#appendix--reproducing-this)
- [Related](#related)

---

## Summary

`StateManager.init` had three problems as written:

1. It **built the wrong class.** Called on any subclass — which meant every
   `Entity` and every `AggregateRoot` — it returned a bare `StateManager` with
   no `id` and none of the subclass's behaviour.
2. Its parameter type, `RequiredState<S>`, appeared to **buy nothing.** A plain
   `S` already permits omitting optional properties.
3. `RequiredState<S>` **refused to accept an optional property** (TS2353).

Item 1 is a real defect and was resolved twice over: the composition refactor
removed the inheritance that made `init` a method on every aggregate, and `init`
itself has since been deleted as redundant with the public constructor.

**Items 2 and 3 were misjudged.** They were assessed against an intent the types
did not have — see §0 — and under the actual intent, item 3 is the feature and
item 2 is false. The types are now installed on `Entity.create` and
`AggregateRoot.fromEvents`, where they do the job they were written for.

## 0. Correction — the intent was misread

This document originally concluded that `RequiredKeys` and `RequiredState` were
elaborate machinery reproducing behaviour TypeScript already had, and
recommended deleting them. That conclusion was wrong, and the error is worth
recording precisely because the evidence was correct throughout.

**The intent I assumed** — taken from the code's own comment (_"a caller is not
forced to spell out optional properties just to satisfy the compiler"_) and from
all four of its tests — was **permissive**: creation should _tolerate_ omitting
optional properties. Against that reading `RequiredState` is indeed a no-op,
because a plain `S` already tolerates it, and its refusal of an optional
property is indeed a regression.

**The actual intent** was **strict**: an entity may be created with its required
properties and _nothing else_. Against that reading, a plain `S` does not come
close — it happily accepts optionals — and the refusal in §4 is the entire
point.

The table in §3 is factually correct and unchanged. What was wrong was the
verdict drawn from it, which depended on a premise never stated in the code. Two
lessons, and the second is the more useful:

- A type whose purpose is not written down will be judged against whatever
  purpose its tests imply. All four tests here exercised the permissive
  reading; none asserted the refusal, which is the behaviour that mattered.
- The types were never the problem. They were **installed in the wrong place** —
  on a construction path nothing used, instead of the one every aggregate goes
  through.

Read §3 and §4 below as accurate observations under a stated-but-wrong premise.
§7 records what was actually done.

---

## 1. The code under discussion

```ts
// packages/state/src/index.ts
export type State = Record<string, any>;

type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type RequiredState<S extends State = State> = Pick<S, RequiredKeys<S>>;

export class StateManager<S extends State> {
  private state: S;

  protected constructor(initialState: S) {
    this.state = initialState;
  }

  static init<S extends State>(
    initialState: RequiredState<S>,
  ): StateManager<S> {
    // An `S` whose optional properties are all absent is still a valid `S`, but
    // the compiler cannot prove that for an unresolved generic `S`.
    return new StateManager<S>(initialState as S);
  }
  // ...
}
```

`RequiredKeys<T>` is a mapped type used as a filter. It maps every key of `T` to
either its own name or `never`, then indexes the result with `[keyof T]` to
collapse the surviving names into a union. The `-?` modifier strips optionality
during the map, which is what keeps `undefined` out of the resulting union. The
test `{} extends Pick<T, K>` is true exactly when `K` may be absent, because an
all-optional object type accepts `{}` — so it asks about the property _slot_
rather than the value, and a required `deletedAt: Date | undefined` stays
required.

The construction is correct. That is not what is in question here; what is in
question is whether it accomplishes anything where it is used.

---

## 2. Defect one — `init` builds the wrong class

Statics are inherited in JavaScript. `Entity` extends `StateManager`, so `init`
is present on every entity and every aggregate root in any model built on this
library. The body, however, names `StateManager` explicitly:

```ts
return new StateManager<S>(initialState as S);
```

The class the body _names_ is not the class it was _called on_. So:

```ts
const thing = BookStock.init({ title: "Dune", barcodes: [], copies: [] });
// compiles.
// thing.constructor.name === "StateManager"
// thing.id             === undefined
// thing instanceof BookStock === false
```

The return type says `StateManager<S>`, which is technically honest, but the
method is reachable through a subclass on which no reasonable caller expects a
factory to return something other than that subclass.

Two aggravating factors:

- `StateManager` and `State` are **not exported** from `packages/domain-tools/src/index.ts`. A
  consumer of the published package cannot name the type this method hands back,
  while being able to call it on all of their own classes.
- This is the same defect `Entity.create` had before it was fixed. The cure — a
  `this` parameter that types the receiver as the class actually called — sits
  in `packages/domain-tools/src/lib/entity.ts` in the same repository. §5 explains why it cannot
  simply be copied across.

---

## 3. Defect two — `RequiredState<S>` buys nothing

The stated purpose is that a caller should not have to spell out optional
properties merely to satisfy the compiler. TypeScript already guarantees this:
optional properties may be omitted from any value of type `S`.

The following probe compares `RequiredState<S>` against a plain `S` across the
four cases that matter. Lines marked `@ts-expect-error` are assertions that the
line _must_ fail — an unused directive is itself an error, so the file tests
both directions at once.

```ts
type State = Record<string, any>;

type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];
type RequiredState<S extends State = State> = Pick<S, RequiredKeys<S>>;

type ShelfState = { label: string; books: string[]; movedAt?: Date };

declare function withRequired<S extends State>(s: RequiredState<S>): void;
declare function withPlain<S extends State>(s: S): void;

// A. Omit the optional key — the stated purpose of RequiredState.
withRequired<ShelfState>({ label: "A1", books: [] });
withPlain<ShelfState>({ label: "A1", books: [] });

// B. Omit a required key — both must reject.
// @ts-expect-error `books` is required
withRequired<ShelfState>({ label: "A1" });
// @ts-expect-error `books` is required
withPlain<ShelfState>({ label: "A1" });

// C. Supply the optional key.
withRequired<ShelfState>({ label: "A1", books: [], movedAt: new Date() });
withPlain<ShelfState>({ label: "A1", books: [], movedAt: new Date() });

// D. A required slot whose value may be undefined — what `-?` defends.
type Rec = { id: string; deletedAt: Date | undefined };
// @ts-expect-error `deletedAt` has no `?`, so the slot must be supplied
withRequired<Rec>({ id: "r-1" });
// @ts-expect-error `deletedAt` has no `?`, so the slot must be supplied
withPlain<Rec>({ id: "r-1" });
```

Compiled with `tsc --ignoreConfig --noEmit --strict --target esnext`, the entire
file produces exactly one diagnostic:

```
my.required-probe.ts(24,52): error TS2353: Object literal may only specify known
properties, and 'movedAt' does not exist in type 'RequiredState<ShelfState>'.
```

| Case                                 | `RequiredState<S>`   | plain `S`   |
| ------------------------------------ | -------------------- | ----------- |
| A — omit the optional property       | accepts              | **accepts** |
| B — omit a required property         | rejects              | **rejects** |
| C — supply the optional property     | **rejects** (TS2353) | accepts     |
| D — required slot, `undefined` value | rejects              | **rejects** |

Cases A, B and D are identical. `RequiredKeys` and `RequiredState` exist
entirely to produce behaviour the language already has.

---

## 4. Defect three — `RequiredState<S>` rejects a legal argument

Case C is not a tie; it is a regression. `Pick<S, RequiredKeys<S>>` _drops_ the
optional keys from the type, so supplying one is an excess property on an object
literal and TypeScript refuses it. Today:

```ts
StateManager.init<ShelfState>({ label: "A1", books: [], movedAt: new Date() });
//                                            ~~~~~~~ TS2353
```

There is no way to pass an optional property through `init`. The type intended
to make optional properties _convenient_ makes them _impossible_.

This is the more interesting half of the finding, because it inverts the usual
reading. A no-op type is harmless clutter. This one narrows the accepted input
below what the domain allows, and the narrowing went unnoticed for the reason
given in §6.

---

## 5. Why `init` cannot be repaired in place

The obvious repair is the one already applied to `Entity.create`: a `this`
parameter, so the receiver's own type reaches the body.

```ts
static init<This extends { prototype: StateManager<any> }>(
  this: This,
  initialState: StateOf<This["prototype"]>,
): This["prototype"] {
  return new (this as unknown as Newable<This["prototype"]>)(initialState);
}
```

This is **worse than the defect it fixes.** `StateManager`'s constructor takes
one argument; `Entity`'s takes two, `(id, state)`. A polymorphic `init`
inherited by `BookStock` calls `new BookStock(initialState)` — the state object
lands in the `id` parameter and the state parameter is `undefined`.

Confirmed by construction against the compiled build:

```
ctor          : BookStock
id            : {"title":"Dune","barcodes":[],"copies":[]}
id is Id?     : false
state         : {}
get('title')  : throws TypeError
```

Note the first line. The result now **passes `instanceof BookStock`**, so it
survives every structural check a repository or a test would make of it, while
its identity is a state object and its state is gone. `get()` returns `{}`
because spreading `undefined` yields an empty object; `get("title")` throws.
Today's failure mode — an obviously wrong bare `StateManager` — is strictly
easier to diagnose.

The general rule: **a static factory cannot survive being inherited by classes
with a different constructor arity.** The `this`-parameter technique conveys
_which class_ to construct; it conveys nothing about _what that class's
constructor wants_. `Entity.create` works only because it and `StateManager`
agree that construction means "id, then state" — an agreement `init` was written
before and does not share.

Nor can the arity be constrained away. Expressing "a class whose constructor
takes exactly `(S)`" requires a construct signature, `new (s: S) => T`, and both
`StateManager` and `Entity` declare `protected` constructors — a protected
constructor type is not assignable to a public one (TS2684). That restriction is
precisely why the existing factories are constrained on `prototype` instead, and
`prototype` says nothing about constructor parameters.

---

## 6. Why none of this was caught

- **No call sites.** `init` is called from nowhere in `packages/domain-tools/src/`. Its only callers
  are the four tests at `packages/domain-tools/test/state.test.ts:55-100`, five calls in total.
- **The tests exercise only the cases where the type is a no-op.** They cover
  case A (omit an optional), case B (omit a required), and case D (a required
  `| undefined` slot). All three pass identically with a plain `S`. Case C —
  the one that fails — has no test.
- **Defect one is invisible from the tests**, because every test calls
  `StateManager.init` directly, never through a subclass. Called on
  `StateManager` itself, naming `StateManager` in the body is correct.

That combination is the general shape worth remembering: a helper with no
production callers, tested only through the receiver on which its bug does not
manifest, guarded by a type whose failing case nobody wrote down.

---

## 7. What was done

`init` was **deleted**. It was redundant with the public constructor that the
composition refactor introduced, and §5 shows it could not have been repaired in
place anyway.

`RequiredKeys` and `RequiredState` were **kept, and moved to where they belong**
— the signatures of `Entity.create` and `AggregateRoot.fromEvents`:

```ts
static create<This extends { prototype: Entity<any, any> }>(
  this: This,
  id: IdOf<This["prototype"]>,
  initialState: RequiredState<StateOf<This["prototype"]>>,
): This["prototype"]
```

Verified to resolve through the `prototype` → `StateOf` → `RequiredState` chain
while still inferring the concrete subclass.

### The convention this depends on

Strict creation forces a distinction `?` does not carry on its own, and leaving
it implicit is what would make the design a trap:

- **Deferred** — `author?: string`. Not knowable at creation; some domain method
  or handler sets it later. Excluded from `RequiredState`.
- **Sparse** — `deletedAt: Date | null`. May genuinely never hold a value, and
  that is known at creation. The _slot_ is required, so `RequiredKeys` keeps it
  and the caller passes `null` deliberately.

`RequiredKeys` already draws exactly this line: `{} extends Pick<T, K>` asks
whether the property **slot** may be absent, not whether the value may be
`undefined`. The `-?` modifier and the slot test are what make both encodings
available — the part of the type this document originally praised in passing and
then dismissed.

**The trap the convention prevents:** mark a property `?` when it is really
sparse, give it no setter, and it becomes **silently unreachable** — creation may
not supply it and nothing else ever will. No error, just a property no code can
write. `BookStock.author` was in exactly that state; it now has
`attributeTo(author)`, which makes it a genuine deferred property and the
model's fixture for this half of the convention.

### Tests

The four `init` tests were rewritten against `create`, and three added: creation
**refusing** an optional property (the behaviour that had never been asserted),
a deferred property being filled in by behaviour afterwards, and `fromEvents`
being strict in the same way. 62 tests pass.

## Appendix — reproducing this

Save the §3 probe to a file, then — note `--ignoreConfig`, or `tsc` refuses to
run with a `tsconfig.json` present alongside a named file:

```bash
# The type-level claims in §3 and §4
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target esnext my.required-probe.ts
# expect exactly one diagnostic: TS2353 on the `withRequired` line of case C
```

For the runtime claims, `--input-type=module` is required: `node -e` runs its
script as CommonJS, where the dynamic `import` below has no top-level `await`.

```bash
# The runtime claims in §2 and §5
yarn test   # compiles packages/domain-tools/src and packages/domain-tools/test to packages/domain-tools/.test-build/

node --input-type=module -e '
  const m = await import("./packages/domain-tools/.test-build/test/models/book-stock.js");

  const thing = m.BookStock.init({ title: "D", barcodes: [], copies: [] });
  console.log(thing.constructor.name, thing.id);
  // → StateManager undefined

  const built = Reflect.construct(m.BookStock, [{ title: "D" }]);
  console.log(built instanceof m.BookStock, JSON.stringify(built.id));
  // → true {"title":"D"}
'
```

## Related

- `packages/domain-tools/src/lib/entity.ts` — `Entity.create`, the same defect already fixed, and the
  `this`-parameter / `prototype`-constraint technique discussed in §5.
- `packages/domain-tools/src/lib/aggregate-root.ts` — `AggregateRoot.fromEvents`, the same technique,
  and the `abstractBase` runtime guard added for a related gap in what the
  `prototype` constraint can express.
