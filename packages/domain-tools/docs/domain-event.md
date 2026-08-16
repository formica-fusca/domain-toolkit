# `DomainEvent`

Design notes for
[`../src/lib/event-sourcing/domain-event.ts`](../src/lib/event-sourcing/domain-event.ts).

## Contents

- [The three rules, and where they come from](#the-three-rules-and-where-they-come-from)
- [`sequence` — why not `occurredAt`](#sequence--why-not-occurredat)
- [`eventName` is static, and that is the whole point](#eventname-is-static-and-that-is-the-whole-point)
- [`DomainEventClass` — why an intersection](#domaineventclass--why-an-intersection)

---

## The three rules, and where they come from

A domain event is something that _has already happened_, expressed in the
ubiquitous language. All three rules follow from that one sentence.

**Past tense, always.** `CopyCheckedOut`, never `CheckOutCopy`. A command can be
refused; an event cannot — it is a historical fact.

**Immutable.** You cannot change the past.

**Carries ids and values, never aggregate instances.** An event may be handled
long after it was raised, possibly in another process. Shipping a live
`BookStock` object inside it would smuggle a mutable, already-stale reference
across a consistency boundary.

## `sequence` — why not `occurredAt`

Several events can be recorded inside the same millisecond, and a domain event
log that cannot preserve causal order is close to useless: "copy returned"
arriving before "copy lent" is nonsense.

So every event is stamped at construction from a module-level monotonic counter,
and [`AggregateRoot.pullDomainEvents`](./aggregate-root.md#pulldomainevents--the-sort-and-the-cycle-guard)
sorts on it when merging a root's events with its children's.

A real system would use a per-aggregate version number persisted alongside the
state. An in-process counter is the honest toy equivalent — it orders events
within one process and makes no claim beyond that.

## `eventName` is static, and that is the whole point

It identifies the _kind_ of event, and both sides of the system need it without
holding an instance:

- `@Handle(CopyCheckedOut)` registers under it at class-definition time, from the
  class.
- Dispatch looks it up under the `name` of an event it has in hand, from an
  instance.

Those two must be the same string. Before, registration used the class name and
lookup used this field, so a namespaced event could never find its handler — see
[`handle-decorator.md`](./handle-decorator.md#why-registration-keys-on-eventname).

The instance getter derives `name` from `this.constructor`, which is why a
subclass should not redeclare `eventName` as an instance field: the getter would
not see it, and registration and dispatch would disagree again.

### Why `declare`, and why it cannot be checked

`declare static readonly eventName: string` means the base class emits no
JavaScript for it — subclasses provide the value.

TypeScript has no `abstract static`, so a subclass that forgets it cannot be
caught at compile time. Two runtime guards cover the gap instead, and they fail
loudly rather than dispatching to the wrong place: the `name` getter throws when
read, and `@Handle` throws at decoration time — which is to say at _import_
time, not at dispatch.

## `DomainEventClass` — why an intersection

```ts
export type DomainEventClass<TEvent extends DomainEvent = DomainEvent> =
  Newable<TEvent> & { readonly eventName: string };
```

`Newable<DomainEvent>` alone is not enough for `@Handle`. A construct signature
says nothing about statics, so `event.eventName` would not typecheck. The
intersection is what lets the decorator read the name off the class it was
handed.

Note this is the opposite problem from the one
[`AggregateRootClass`](./handle-registry.md#aggregaterootclass--why-not-newableaggregateroot)
solves. Here a construct signature is wanted and a static must be added to it;
there, the construct signature is the thing that has to go.
