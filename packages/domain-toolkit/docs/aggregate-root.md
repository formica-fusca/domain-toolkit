# `AggregateRoot`

Design notes for [`../src/lib/aggregate-root.ts`](../src/lib/aggregate-root.ts).

The source keeps the contract — the three responsibilities, how big an aggregate
should be, what each method promises. This file keeps the reasoning behind the
implementation.

For the division of labour between this class and `Entity` where domain events
are concerned — which class owns the buffer, why only a root has `apply`, and
what that costs — see
[`domain-event-ownership.md`](../../../docs/domain-event-ownership.md).

## Contents

- [`abstractBase`, declared again](#abstractbase-declared-again)
- [`#traversing` — a flag, not a `Set`](#traversing--a-flag-not-a-set)
- [`pullDomainEvents` — the sort and the cycle guard](#pulldomainevents--the-sort-and-the-cycle-guard)
- [`hasPendingEvents` — why it is overridden at all](#haspendingevents--why-it-is-overridden-at-all)
- [`fromEvents` — the `this` parameter, and a comment that was wrong twice](#fromevents--the-this-parameter-and-a-comment-that-was-wrong-twice)
- [Why the seed is a `RequiredState`](#why-the-seed-is-a-requiredstate)
- [Why replay asserts once, at the end](#why-replay-asserts-once-at-the-end)
- [`#invokeHandler` — why a missing handler throws](#invokehandler--why-a-missing-handler-throws)
- [`assertInvariants` — why `abstract override`](#assertinvariants--why-abstract-override)

---

## `abstractBase`, declared again

`protected static override readonly abstractBase = true` looks redundant next to
the identical declaration on `Entity`. It is load-bearing.

The guard is `Object.hasOwn`, and statics are inherited. Without its own copy,
`Object.hasOwn(AggregateRoot, "abstractBase")` is `false` and
`AggregateRoot.create(...)` — inherited from `Entity` — walks straight past the
check. See [`entity.md`](./entity.md#abstractbase--a-runtime-guard-for-a-compile-time-claim).

## `#traversing` — a flag, not a `Set`

Both recursive traversals below guard against a cycle in the child graph with a
single boolean on the instance, rather than a visited-set threaded through the
recursion.

The reason is that the recursion is _polymorphic_. `childEntities()` is typed as
`Entity`, so a child that is itself an `AggregateRoot` re-enters through the
public method and would start a fresh accumulator every time. "Am I already on
the stack?" is the one question that survives that dispatch.

Safe as a single flag shared by both methods because both are synchronous and
neither yields; `finally` restores it even when a child throws.

## `pullDomainEvents` — the sort and the cycle guard

Without the sort, every child event would appear after every root event, which
would misreport what happened: a `CopyDamaged` recorded by a `Copy` before the
root recorded `TitleOutOfStock` must stay before it. The sequence stamp is what
restores causal order.

On re-entry through a cycle the method returns `[]`. That is not a loss — this
node is already being drained further up the stack, and its buffer belongs to
that call, which reports the events exactly once.

## `hasPendingEvents` — why it is overridden at all

The two must agree. The inherited version reads only the root's own buffer, so a
root whose only pending events were recorded by a child reports `false` while
`pullDomainEvents()` would hand back those events. The common repository shape —

```ts
if (root.hasPendingEvents) publish(root.pullDomainEvents());
```

— would then drop them without a trace.

Four details in the implementation:

- **It must ask `super`.** `Entity`'s buffer is a `#private` field, which even a
  subclass cannot reach.
- **It peeks, it does not drain.** It has to stay safe to ask any number of
  times — from a log line, an assertion, a repository's guard — and answer the
  same thing each time. Hence `some` over a `hasPendingEvents` read, and nothing
  that empties a buffer.
- **The root's own buffer is tested first**, so the common case — a root that
  just applied an event — never calls `childEntities()` at all. That method is
  free to rebuild its array on each call, and several models do.
- **Recursion comes for free.** `childEntities()` is typed as `Entity`, but a
  child that is itself an `AggregateRoot` re-enters this getter and consults its
  own children — the same dispatch `pullDomainEvents` recurses through. That is
  not an invitation to nest aggregates; an aggregate referencing another should
  hold its id, not the instance. It is only a guarantee that the two methods
  never disagree about depth.

## `fromEvents` — the `this` parameter, and a comment that was wrong twice

The `this` parameter is what makes the construction legal: it types the receiver
as _the subclass being called_, not as this abstract base.

It does **not**, however, make the call _require_ a subclass. This comment
claimed for a while that `AggregateRoot.fromEvents(...)` "does not compile". It
compiles, and before the runtime guard it ran, returning a live instance of an
abstract class with no `assertInvariants`. `{ prototype: AggregateRoot }` is
satisfied by `typeof AggregateRoot` as readily as by `typeof BookStock`, and
`abstract` is erased at emit — so nothing stopped it at either end.

It is constrained by `prototype` rather than by `Newable<TAggregate>` for the
reason spelled out on
[`Entity.create`](./entity.md#why-prototype-and-not-newablet): every aggregate
inherits a `protected` constructor, and a protected constructor type is not
assignable to a public one. The earlier `this: Newable<TAggregate>` signature was
uncallable for that reason — on every aggregate, not merely on unusual ones.

Which is the sharp part, and the reason the runtime guard exists at all:
`Newable<TAggregate>` **would have caught this**. A non-abstract construct
signature rejects an abstract class — TS2684, "cannot assign an abstract
constructor type to a non-abstract constructor type". Switching to `prototype` to
get past the _protected_-constructor problem gave up that check as collateral.
(`abstract new (...) => T` does not help: it is the form that deliberately
_accepts_ abstract classes, for registries and mixin factories. It points the
wrong way.)

So the rule is enforced at runtime instead, and
[`abstract-base-construction.md`](../../../docs/abstract-base-construction.md) §7
records the change that would hand it back to the compiler.

Worth remembering that the original claim here was written confidently and was
wrong, and that its first correction was wrong too. Only `tsc` settles
assignability questions.

## Why the seed is a `RequiredState`

`initialState` is the shape the stream is replayed _onto_. An event stream says
what changed, never what the empty shape was, so a handler like
`this.set("barcodes", [...this.get("barcodes"), ...])` needs an array to append
to before the first event arrives.

It is a `RequiredState` for the same reason
[`Entity.create`'s is](./entity.md#why-requiredstate-and-not-the-whole-state),
and the fit is if anything tighter here: the seed is _by definition_ the shape
before anything happened, and an optional property is _by convention_ one that
only happens later. A rehydration that had to be handed a deferred value would be
saying the stream is not the whole history.

## Why replay asserts once, at the end

Replay walks through states the domain would reject — the seed itself usually is
one — so asserting per event would refuse valid histories.

Asserting once, after the stream has finished, is what stops a corrupt or
truncated stream from rebuilding silently into an aggregate that then passes
every later check.

`replay` opens a mutation context rather than bypassing the guard, so a handler
that calls `set` is treated identically whether it was reached through `apply` or
through rehydration. Refusing it instead would make every aggregate
un-rebuildable.

## `#invokeHandler` — why a missing handler throws

Both entry points throw when no handler is registered, rather than ignoring the
event. Silence would mean two different disasters wearing the same face:

- on `apply`, an event recorded for publication that never changed the state it
  claims to describe;
- on `replay`, an aggregate silently rebuilt from a subset of its own history.

Neither is detectable later. An event you deliberately do not react to should be
`record`ed, not applied.

The `this.constructor as AggregateRootClass` assertion is kept against the
linter. `this.constructor` is typed `Function`, which structurally satisfies
`AggregateRootClass` only because that type asks for `prototype` and `name` —
both of which `Function` happens to have. The assertion states the intent the
structural match arrives at by accident. See
[`handle-registry.md`](./handle-registry.md#aggregaterootclass--why-not-newableaggregateroot).

## `assertInvariants` — why `abstract override`

`Entity` declares it as a no-op: an entity that is not an aggregate root has no
invariants of its own to protect — the rules that span a cluster belong to the
root that owns the boundary — but `mutate` lives on `Entity` and must have
something to call.

Re-declaring it `abstract` here is what makes stating your rules non-optional for
the class that owns them. Declaring an aggregate root is a claim that you are
protecting _something_, and this method is where you say what. An implementation
that is genuinely empty is a signal that the cluster may not need to be an
aggregate at all.
