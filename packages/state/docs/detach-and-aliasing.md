# What `detach` is for, and why primitives need nothing done to them

**Status:** applied — `Date`, `Map` and `Set` moved to the copied side on
2026-08-18; 18 state tests and 63 `domain-tools` tests passing.
**Date:** 2026-08-18
**Scope:** `packages/state/src/index.ts`, `packages/state/README.md`,
`packages/state/test/state-manager.test.ts`,
`packages/domain-tools/test/atomicity.test.ts`.

---

## Contents

- [Summary](#summary)
- [1. The question as asked](#1-the-question-as-asked)
- [2. Value semantics and reference semantics](#2-value-semantics-and-reference-semantics)
- [3. Why copying everything would be wrong, not merely wasteful](#3-why-copying-everything-would-be-wrong-not-merely-wasteful)
- [4. `detach` is not a copy function](#4-detach-is-not-a-copy-function)
- [5. The membrane](#5-the-membrane)
- [6. Three buckets, two of which share a line](#6-three-buckets-two-of-which-share-a-line)
- [7. Bucket 3, and the two arguments that keep it shut](#7-bucket-3-and-the-two-arguments-that-keep-it-shut)
- [8. The built-ins did not belong there](#8-the-built-ins-did-not-belong-there)
- [9. What the workspace split does and does not constrain](#9-what-the-workspace-split-does-and-does-not-constrain)
  - [Why the copyable line falls where it does](#why-the-copyable-line-falls-where-it-does)
  - [The protocol route, and why it is not taken](#the-protocol-route-and-why-it-is-not-taken)
- [10. The depth axis](#10-the-depth-axis)
- [11. Where the aliasing genuinely remains](#11-where-the-aliasing-genuinely-remains)
- [Related](#related)

---

## Summary

Reading `detach` for the first time, the branch structure looks lopsided: arrays
are copied, plain objects are copied, and primitives fall through to a bare
`return value`. That reads as an omission — the containers are protected and the
strings and numbers are not.

They are protected. A primitive cannot be aliased, so `return value` **is** the
detach, performed in full. That asymmetry belongs to JavaScript's value model,
not to this function.

Chasing it down was worth doing anyway, because the same question asked of the
_other_ pass-through cases did not survive contact. `Date`, `Map` and `Set` were
being shared on an argument that does not hold (§8), and they now get copied.
`Entity` and `ValueObject` are shared on arguments that do hold (§7).

## 1. The question as asked

```ts
function detach<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }

  if (value !== null && typeof value === "object") {
    if (value.constructor === Date) {
      /* … */
    }
    if (value.constructor === Map) {
      /* … */
    }
    if (value.constructor === Set) {
      /* … */
    }

    const proto = Object.getPrototypeOf(value) as object | null;
    if (proto === Object.prototype || proto === null) {
      return { ...(value as object) } as T;
    }
  }

  return value;
}
```

`packages/state/src/index.ts:20`

Some branches do work. Everything else — every string, number and boolean, and
also every entity and value object — reaches `:46` and is handed straight back.
If the function's job is to protect state from callers, that last line looks like
the place the protection stops.

## 2. Value semantics and reference semantics

The premise underneath the question is that "protection" means "copying". It
does not. Protection means the caller must not end up holding a **handle** into
the state bag, and only some values can be a handle.

JavaScript splits its values in two:

- **Primitives** — `string`, `number`, `boolean`, `bigint`, `symbol`, `null`,
  `undefined`. Identity _is_ the value. Assignment copies it, and no operation
  mutates one in place.
- **References** — objects, arrays, functions. Identity is the address.
  Assignment copies the address, so two variables can name one thing.

Only the second kind can be aliased, so only the second kind can be a handle.

The test is to ask what a caller could possibly do with what they were given:

```ts
const s = new StateManager({ title: "Dune" });
let t = s.get("title"); // "Dune"

t = "Other"; // rebinds the local — #state.title untouched
t.toUpperCase(); // returns a new string — #state.title untouched
```

There is no third option. Every string operation is a query returning a new
string; none is a command. Contrast the array case, which is the reason the
function exists at all:

```ts
const s = new StateManager({ copies: [copyA] });
const c = s.get("copies");
c.push(copyB); // without detach: this writes into #state.copies
```

`push` mutates the object _behind_ the reference. No such verb exists for
`"Dune"`.

```
  WITHOUT detach                        WITH detach

  caller ─┐                             caller ─► [ • ]─┐
          ├─► [ copyA ]                                 ├─► copyA
  #state ─┘                             #state ─► [ • ]─┘

  one array, two handles                two arrays, one shared element
  c.push(x) writes into #state          c.push(x) is invisible to #state
```

That right-hand picture is the whole guarantee, and the shared element in it is
deliberate — see §7.

## 3. Why copying everything would be wrong, not merely wasteful

A "defensive" version that copied primitives too would not be a harmless cost. It
has no correct implementation:

```ts
[..."Dune"]   // ["D", "u", "n", "e"]  — a different value, of a different type
{ ...5 }      // {}                    — the number is simply gone
```

Both break the signature. `detach<T>(value: T): T` promises the same type back,
and there is no spread of a primitive that keeps it. The only faithful way to
"copy" a string is to return the string.

The code excludes primitives structurally rather than by listing them:

```ts
if (value !== null && typeof value === "object") {   // :25
```

`typeof x === "object"` is true only for objects and `null`, so every primitive
is filtered out here for free, before any of the checks inside run. The `!== null`
guard is there for the historical `typeof null === "object"` wart specifically,
not for primitives as a class.

## 4. `detach` is not a copy function

The name is the clue, and it was chosen over `clone` or `copy` on purpose.
Copying is a _mechanism_. The _goal_ is:

> **cut any handle the other side might keep into my state.**

Copying is how you cut a handle for one category of value. It is not the point,
and for some values it is not available (§3) or not wanted (§7).

Read the function under the mechanism name and `return value` looks unfinished.
Read it under the intent name and the same line reads as _correct_: there was no
handle, so the cut is already done.

This is the general habit worth taking from the file. Naming a function after
the guarantee it upholds rather than the operation it performs is what lets a
no-op branch be legible as a deliberate answer instead of a gap.

The habit has a failure mode, and §8 is a worked example of it: an intent name
makes every branch look considered, including the ones that are not.

## 5. The membrane

`StateManager` is a boundary, and `detach` is applied at every point where a
value crosses it — **four** places, three inbound and one outbound:

```
        caller side              ║              StateManager side
                                 ║
   seed  ─────────────────────►  ║  detachAll ──► #state        constructor  :61
   value ─────────────────────►  ║  detach    ──► #state[key]   set          :74
   state ─────────────────────►  ║  detachAll ──► #state        restore      :78
                                 ║
   copy  ◄── detachAll ────────  ║  ◄─────────── #state         get()        :68
   copy  ◄── detach ───────────  ║  ◄─────────── #state[key]    get(key)     :70
                                 ║
                           the membrane
```

The invariant is that **no container is reachable from both `#state` and caller
code at the same time**.

Guarding only the outbound direction would be a half-measure. A caller who kept a
reference to the array they handed to `set` could write through it afterwards,
which is what `packages/state/test/state-manager.test.ts:182` pins down — as
`:167` does for the constructor seed, and `:142` / `:157` for the two reads.

`restore` (`:78`) is the fourth crossing and the least visible one: it is not
called by application code at all, only by `Entity.restoreState`
(`packages/domain-tools/src/lib/entity.ts:280`), which `mutate` uses to roll an
operation back. It detaches for the same reason as the constructor — the snapshot
being put back must not stay live in the hands of whoever held it.

## 6. Three buckets, two of which share a line

The body classifies every value into one of three buckets:

```
                            detach(value)
                                  │
                                  ▼
                ┌─────────────────────────────────────┐
                │ Can the caller reach my state       │
                │ through this value?                 │
                └─────────────────────────────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                │ NO                                │ YES
                ▼                                   ▼
        ┌───────────────┐          ┌──────────────────────────────┐
        │ primitive     │          │ Is it a container,           │
        │ ───────────── │          │ or does it have identity?    │
        │ string        │          └──────────────────────────────┘
        │ number        │                          │
        │ boolean       │            ┌─────────────┴─────────────┐
        │ bigint        │            │ CONTAINER                 │ IDENTITY
        │ symbol        │            ▼                           ▼
        │ null          │    ┌────────────────┐        ┌─────────────────────┐
        │ undefined     │    │ array          │        │ Entity      (Copy)  │
        └───────────────┘    │ plain object   │        │ ValueObject (Money) │
                │            │ Date           │        │ Identifier          │
                │            │ Map            │        │ any other class     │
                │            │ Set            │        │ subclasses of the   │
                │            └────────────────┘        │   built-ins         │
                │                    │                 └─────────────────────┘
                ▼                    ▼                            │
                                                                  ▼
           BUCKET 1              BUCKET 2                    BUCKET 3
        nothing to cut      copy the container        cutting would break it
        `return value`      spread, or the type's        `return value`
                            own constructor
          line :46          lines :22 :31 :34             line :46
                                  :37 :42
                │                                                │
                └────────────────────────────────────────────────┘
                          same line — opposite reasons
```

That last connector is the actual source of the confusion. Buckets 1 and 3 leave
through the **same statement** for reasons that have nothing to do with each
other:

- **Bucket 1** returns the value because detaching is _meaningless_ — there is no
  handle.
- **Bucket 3** returns the value because detaching would be _destructive_ — the
  handle is the point.

One line, two rationales. What made §8 possible is that a third group had been
quietly filed under the second rationale without earning it.

## 7. Bucket 3, and the two arguments that keep it shut

Bucket 1 is forced by the language. Bucket 3 is a choice, and it needs two
separate arguments to stand up — one for why copying is wrong, one for why
sharing is safe. Only the first was ever written down.

### Why copying is wrong

A `Copy` entity sitting in `BookStock`'s state is not data the aggregate happens
to hold — it _is_ one of the aggregate's children, with its own identity and its
own buffered events. Spreading it would produce an object with the right fields
and nothing else: no prototype, so the methods are gone; no `#private` fields,
which a spread cannot carry at all; and a different identity, which for an entity
is the one thing that may not change. The aggregate root would be handed a set of
lookalikes whose recorded events are dropped on the floor.

So the rule the design lands on:

> **the container is the aggregate's, the elements are whoever's they already
> were.**

### Why sharing is safe

That rule would be uncomfortable if pass-through meant the caller got raw mutable
state. It does not, and for two different reasons:

- **`ValueObject` is frozen.** `packages/domain-tools/src/lib/value-object.ts:22`
  does `Object.freeze({ ...props })` at construction. Nobody can mutate one you
  are holding, so detaching it would be a no-op with extra steps.
- **`Entity` protects its own state.** An entity holds its own `StateManager`, so
  a caller handed a child entity gets its reads through _that_ membrane, detached
  in turn. The boundary composes through the entity rather than stopping at it.
  Its `set` is `protected`, so the only writes available are the entity's own
  domain methods — which is the sanctioned channel, not a hole.

`ValueObject` is the more interesting of the two: it moves the aliasing guarantee
into the type instead of enforcing it at every boundary the type crosses. That is
why `detach` needs to know nothing about it.

**The edge that survives.** `pullDomainEvents` is public on `Entity`
(`packages/domain-tools/src/lib/entity.ts:258`), so a caller handed a child can
drain its buffer, after which the root publishes nothing and says nothing. That
is an event-loss hole rather than a state-corruption one, and it is not `detach`'s
to close.

### The prototype check

It is how the code asks the container-or-identity question:

```ts
const proto = Object.getPrototypeOf(value) as object | null;
if (proto === Object.prototype || proto === null) {   // :40-41
```

`Object.prototype` or `null` means nobody attached behaviour — it is a bag of
data, and what matters about it is its contents. Anything else means someone did,
and a spread would throw that away.
`packages/state/test/state-manager.test.ts:196` holds both halves.

One implementation note: `Object.getPrototypeOf` is typed `any`, and the
narrowing has to happen in the expression rather than on the variable —
annotating the variable leaves the `any` on the right-hand side.

## 8. The built-ins did not belong there

Until 2026-08-18, `Date`, `Map` and `Set` sat in bucket 3, on this argument from
the README:

> a shallow spread of any of those produces a broken lookalike: it loses the
> prototype, so the methods go; it cannot carry `#private` fields at all

The argument is true about **spreading**. It is not an argument against
**copying**, and for those three types the correct copy is one call:

```ts
new Date(d.getTime()); // exact, same instant
new Map(m); // exact, same entries
new Set(s); // exact, same members
```

So the reasoning defeated a bad implementation and concluded the goal was
unreachable. Neither of §7's two arguments applies to them:

|                      | Copying is wrong?           | Sharing is safe?                    |
| -------------------- | --------------------------- | ----------------------------------- |
| `Entity`             | Yes — destroys identity     | Yes — own membrane, `protected set` |
| `ValueObject`        | Wasteful — frozen already   | Yes — immutable                     |
| `Date`, `Map`, `Set` | **No** — exact copies exist | **No** — mutable, no protection     |

They are mutable, they carry no identity anyone means — nobody says "_this_
`Date`, as opposed to an equal one" — and nothing protects them. That is the
definition of a container, so they now get rebuilt.

This was not hypothetical. `deletedAt: Date | null` is the README's own canonical
example of a sparse state property (`packages/domain-tools/test/models/book-stock.ts:41`),
and `state.get("deletedAt").setFullYear(1999)` wrote straight into the bag.

### Where the old reasoning left a fingerprint

The test that pinned the behaviour asserted:

```ts
"a Date is an identity, not a container";
```

A `Date` is not an identity. That sentence borrows the legitimacy of the entity
argument and spends it on a type the argument does not cover — which is the
failure mode of intent-naming flagged at the end of §4. It is worth keeping as a
standing example: a well-named function makes its branches _look_ considered, and
the reader has to check each one against the actual reason rather than the label
on the box.

### `constructor ===`, not `instanceof`

```ts
if (value.constructor === Date) {   // :30
```

Exact-constructor matching, mirroring the exact-prototype discipline of the plain
object check. `new Map(m)` on a subclass hands back a plain `Map` — the methods
go, and so does whatever the subclass carried. That is the lookalike problem
again, so a subclass is **declined** rather than silently downgraded, and it
lands in bucket 3 where an unknown class belongs. Tested at
`packages/state/test/state-manager.test.ts:276`.

## 9. What the workspace split does and does not constrain

`@domain-tools/state` is private and inlined into `domain-tools` at build time,
and the dependency arrow runs one way: `domain-tools` → `state`. So `detach`
cannot ask `value instanceof Entity`, and the natural question is whether that
constraint is what shaped bucket 3.

Mostly, no.

- **It did not cause §8.** `Date`, `Map` and `Set` are built-ins. Closing that gap
  needed no knowledge of `domain-tools` at all, which is why it could be closed
  inside `state` without touching the split. It was an unforced gap, not a
  constrained one.
- **It does not cost anything for `Entity` or `ValueObject`.** Both terminate in
  pass-through anyway (§7). An `instanceof` check would produce a different
  _rationale_ for the same _instruction_, and a distinction that changes only the
  rationale belongs in prose. This is a design paying off rather than a limit
  being worked around.

What the split does cost is one thing, and it is a diagnostic rather than a
guarantee. Consider a user-defined mutable class that is neither:

```
class Cursor { #pos = 0; advance() { this.#pos++ } }
```

Held in state, that is mutable and shared, and `detach` cannot tell it from a
`Copy`. But knowing it were not a domain type would not unlock a different
action: the prototype and `#private` argument that _fails_ for `Date` _succeeds_
for an arbitrary class, so there is still no safe copy. The outcome is
pass-through either way.

### Why the copyable line falls where it does

§8 asserts that `Date`, `Map` and `Set` are copyable and an arbitrary class is
not, without saying what separates them. It is not that they are built-in. It is
that each one **publishes a constructor that round-trips its own internal
state**:

```ts
new Date(d.getTime()); // getTime() exposes the internal slot
new Map(m); // the Map is iterable over its own entries
new Set(s); // likewise
```

That is a copy _protocol_, and having one is the property that matters. A class
holding `#private` fields publishes nothing equivalent — those fields are not
properties, they are internal slots reachable only from inside the class body, so
no external copier can read them out.

The failure mode this produces is worse than being unable to copy. The nearest
thing to a generic clone preserves the prototype:

```ts
const twin = Object.create(Object.getPrototypeOf(cursor));
Object.assign(twin, cursor); // own properties only
```

`twin` has the right prototype and every method, so it passes `instanceof` and
looks correct in a debugger. Then the first method touching `#pos` throws
`TypeError: Cannot read private member #pos from an object whose class did not
declare it`. A copy that fails at construction is a bug you find; this one is a
lookalike that fails later, somewhere else. Declining is not a limitation here,
it is the better of the two outcomes.

### The protocol route, and why it is not taken

Framing it as a protocol rather than a type check opens a possibility §9 would
otherwise miss, and it is worth recording because it **does not need the split
resolved at all**. A class could opt in structurally:

```ts
if (typeof (value as { detach?: unknown }).detach === "function") {
  return (value as { detach(): T }).detach();
}
```

No import, no policy object, no dependency inversion — `state` asks whether the
value knows how to copy itself and takes its word for it. Duck-typing, in the one
situation where it is the right tool: the question really is about a capability
rather than a type.

It is declined for a reason that is about the domain model rather than the
mechanism. The answer to _"I am holding a mutable class in state"_ is **make it a
`ValueObject`** — at which point it is frozen, sharing is free, and no copy is
needed (§7). A copy protocol would legitimise the shape the design steers away
from, and it would hand every model author a contract to implement correctly on
every class, forever, in exchange for a case that should not arise.

Recording it because the reasoning cuts the other way if the surrounding facts
change: if `domain-tools` ever needs to hold third-party mutable objects it does
not control, the protocol is the route in, and it is cheaper than everything else
in this section.

### What the split actually costs, restated

Less than it first appears. The protocol route needs nothing from
`domain-tools`, so the dependency arrow does not block it at all. That leaves
exactly one casualty: the warning — _"you are storing a mutable non-domain class
in state; did you mean to make it a `ValueObject`?"_ — which does need the domain
vocabulary. If it is ever wanted, the way in is not an import but an inversion:
`StateManager` accepts a policy, and `domain-tools` supplies the types.

```ts
new StateManager(initial, {
  isOpaque: (v) => v instanceof Entity || v instanceof ValueObject,
});
```

`state` stays dependency-free; `domain-tools` owns the domain types. The cost is
a seam and a config object on a class whose present virtue is having neither.
Not taken.

## 10. The depth axis

Separate from the value/reference axis, and worth keeping distinct from it:
`detach` is **shallow**. One level.

```
  { title: "Dune", tags: ["sci-fi"], meta: { x: 1, deep: { y: 2 } }, at: <Date> }

                              detachAll
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ {                                              outer bag ── FRESH   │
  │   title:  "Dune"                               value ──── nothing   │
  │                                                          to share   │
  │   tags:   [ ─────────────────────────────────► array ──── FRESH     │
  │             "sci-fi" ────────────────────────► value ──── nothing   │
  │           ]                                              to share   │
  │   meta:   { ─────────────────────────────────► object ─── FRESH     │
  │             x: 1 ────────────────────────────► value               │
  │             deep: ───────────────────────────► SHARED  ⚠            │
  │           }                                                         │
  │   at:     ───────────────────────────────────► Date ──── FRESH      │
  │ }                                                                   │
  └─────────────────────────────────────────────────────────────────────┘
                                              one level deep, deliberately
```

`at` used to carry a ⚠ here. `deep` still does, and for a different reason than
anything in §7 or §8: the copy simply stopped. `meta` was freshened, and its
contents were not.

A rebuilt `Map` or `Set` inherits exactly the same boundary — fresh container,
shared values (`packages/state/test/state-manager.test.ts:306`).

The argument for stopping is that going deeper answers the wrong question. A
value nested that far wants to be a class — at which point it lands in bucket 3
and is passed through by design anyway. `structuredClone` would close the gap and
in the same stroke destroy every entity in the bag. Deliberate, and tested:
`packages/state/test/state-manager.test.ts:326`.

The shallowness propagates outward. Because `Entity.mutate` rolls back through
`snapshotState` / `restoreState`, and both go through `detach`, the rollback
guarantee inherits the same boundary — restore the containers, not the values
nested inside them. That is a test in its own right at
`packages/domain-tools/test/atomicity.test.ts:274`.

## 11. Where the aliasing genuinely remains

If the question behind all this is "what is still exposed?", the answer is not
primitives, and after §8 it is no longer the built-ins either. Two things remain:

|       | What is shared                                | Why                                 | Protected?                                                                                 |
| ----- | --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| **1** | Plain objects nested more than one level down | The copy is shallow (§10)           | No                                                                                         |
| **2** | Entities, value objects, arbitrary classes    | Bucket 3 — copying breaks them (§7) | `ValueObject` frozen; `Entity` behind its own membrane; **an arbitrary class, not at all** |

Row 2's last cell is the honest residual. `ValueObject` and `Entity` are covered
by §7's second argument; a plain user-defined mutable class is covered by
nothing, and §9 explains why the workspace split means it gets a pass-through
rather than a warning.

The guidance follows the modelling convention rather than the copy function: if a
nested or class-shaped value matters enough to protect, make it a `ValueObject`.
`detach` will pass it through untouched, which is the correct outcome, and the
freeze does the rest.

---

## Related

- `../README.md` — [`detach` — the aliasing guarantee](../README.md#detach--the-aliasing-guarantee),
  the canonical statement of what is copied and what is not.
- `../../../docs/inheritance-to-composition.md` — why `Entity` holds a
  `StateManager` rather than extending one, which is what made the membrane in §5
  a real runtime boundary instead of a compile-time one.
- `../../../docs/state-manager-init.md` — the defects that came from the
  `extends` edge.
- `../../../docs/operation-atomicity.md` — `mutate`, and the rollback path that
  inherits the depth boundary from §10.
- `../../domain-tools/docs/value-object.md` — the freeze that §7 leans on.
