# Entity membership — every entity belongs to exactly one aggregate

**Status:** reference — describes the design as it stands; contains one proposal
(§4) that is **not** implemented.
**Date:** 2026-08-17
**Scope:** `packages/domain-tools/src/lib/entity.ts`,
`packages/domain-tools/src/lib/aggregate-root.ts` (`childEntities`, the class
comment's sizing rule), and the models in
`packages/domain-tools/test/models/` (`book-stock.ts`, `copy.ts`, `member.ts`).

---

## Contents

- [Summary](#summary)
- [1. The rule](#1-the-rule)
- [2. The shapes, in the models](#2-the-shapes-in-the-models)
- [3. Two questions that get folded into one](#3-two-questions-that-get-folded-into-one)
- [4. A rule that is mechanically checkable](#4-a-rule-that-is-mechanically-checkable)
- [5. The trap on the other side](#5-the-trap-on-the-other-side)
- [6. Child entities are rarer than they are modelled](#6-child-entities-are-rarer-than-they-are-modelled)
- [Related](#related)

---

## Summary

The question this answers: _does an entity have any reason to exist if it is not
managed by an aggregate?_

Almost — but the phrasing hides a self-reference. **An `AggregateRoot` _is_ an
`Entity`**; the class declaration says so:

```ts
export abstract class AggregateRoot<
  TId extends Identifier = Identifier,
  EntityState extends State = State,
> extends Entity<TId, EntityState> {}
```

So "an entity must be managed by an aggregate" is true, but for a root the
managing entity is itself.

## 1. The rule

> **Every entity belongs to exactly one aggregate. Either it is that aggregate's
> root, or it is a child the root reaches through `childEntities()`. There is no
> third position.**

## 2. The shapes, in the models

`packages/domain-tools/test/models/` happens to demonstrate exactly the legal
shapes and nothing else:

| Class                             | Shape                                                               |
| --------------------------------- | ------------------------------------------------------------------- |
| `Member extends AggregateRoot`    | root of an aggregate **of one** — never overrides `childEntities()` |
| `BookStock extends AggregateRoot` | root **with** children — declares its `Copy[]`                      |
| `Copy extends Entity`             | child, reachable only through `BookStock`                           |
| `Barcode extends ValueObject`     | no identity at all                                                  |

There is no bare `extends Entity` in that list that is not somebody's child.
That is not an accident — it is the rule holding.

## 3. Two questions that get folded into one

"Is a child entity justified?" hides two separate questions with two separate
answers.

**What justifies a child entity** is that it needs _continuity of identity
through change_. A `Copy` gets rebound, relabelled, moved between shelves — and
stays the same copy. That justification is entirely local; it has nothing to do
with `BookStock`. If the thing were interchangeable with any equal-valued twin,
it would be a `ValueObject` and the question would not arise. See
[`identifier.md`](../packages/domain-tools/docs/identifier.md#identity-versus-attributes).

**What makes it invalid unmanaged** is something else entirely: reachability. An
entity outside every boundary is not _unjustified_, it is _broken_ — and in this
codebase that is concrete rather than philosophical:

```ts
const orphan = Copy.create(new CopyId("LIB-9")); // never adopt()ed
orphan.damage();
assert.equal(stock.pullDomainEvents().length, 0);
assert.equal(orphan.hasPendingEvents, true, "silently stranded, by design");
```

It exists. It works. Its history simply never reaches the world.

So: **justified by identity, invalidated by unreachability.** Why the failure is
silent rather than loud is [`domain-event-ownership.md`](./domain-event-ownership.md) §4.3.

## 4. A rule that is mechanically checkable

The membership rule is testable, which is rarer than it sounds for a DDD
guideline:

> If you write `extends Entity` for something that no root's `childEntities()`
> returns, you have made a mistake.

Three ways out — promote it to `AggregateRoot`, demote it to `ValueObject`, or
adopt it into a root.

**Not implemented.** A test could walk every aggregate's `childEntities()` and
assert that every exported `Entity` subclass appears in some root's list. Two
things make it awkward and are why it does not exist yet: `childEntities()` is
`protected`, so the walk needs an instance and a cast; and it is instance-level,
so a class only "appears" once some root has actually adopted one. It would
therefore check the models a test suite builds, not the class graph — useful,
but weaker than it first sounds.

## 5. The trap on the other side

The mirror-image error is more common in practice: making something a **child
entity** when it should be **its own aggregate root**.

The test is stated in `AggregateRoot`'s own class comment — two objects belong in
the same aggregate _only_ if a rule must hold across both _at every instant_:

- `BookStock` owns its `Copy` entities because `availableCount` must match the
  copies at every instant.
- `Member` and `Loan` are separate aggregates, because "a member has at most N
  loans" is allowed to be repaired a moment later, by an event handler.

Get this wrong and there is no compile error. There is an aggregate that is too
big: more lock contention, a larger unit of persistence, and eventually a root
that cannot guarantee anything because it is guarding rules that were never
really simultaneous.

## 6. Child entities are rarer than they are modelled

Worth sitting with: most aggregates should be a single root. Vaughn Vernon's
_Effective Aggregate Design_ argues this at length under "Design Small
Aggregates".

A "local entity" is very often a value object that someone gave an id to out of
habit — usually because it is a row in a database, which is a persistence fact
and not a domain one.

`Member` being an aggregate of one, in these test models, is the **normal** case
rather than the degenerate one.

The honest summary: an entity that is neither a root nor adopted is a bug — but
the more likely bug in a real model is the entity that _is_ adopted and should
not have been.

## Related

- [`domain-event-ownership.md`](./domain-event-ownership.md) — where `Entity`
  stops and `AggregateRoot` starts; §4.3 is why an unadopted child fails
  silently rather than loudly
- [`operation-atomicity.md`](./operation-atomicity.md) — §6, the other
  consequence of a child owning its own buffer
- [`../packages/domain-tools/docs/aggregate-root.md`](../packages/domain-tools/docs/aggregate-root.md)
  — the traversal that `childEntities()` feeds, and why it is a flag rather than
  a visited-set
- [`../packages/domain-tools/docs/identifier.md`](../packages/domain-tools/docs/identifier.md)
  — identity versus attributes, which is the entity-or-value-object test in §3
- Vaughn Vernon, _Effective Aggregate Design_ (2011) — the three-part essay
  behind §5 and §6
