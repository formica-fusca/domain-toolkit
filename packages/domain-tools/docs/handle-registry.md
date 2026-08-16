# `HandleRegistry`

Design notes for
[`../src/lib/event-sourcing/handle-registry.ts`](../src/lib/event-sourcing/handle-registry.ts)
and the type it is keyed by,
[`../src/lib/types/aggregate-root-class.ts`](../src/lib/types/aggregate-root-class.ts).

## Contents

- [Dropping `reflect-metadata`](#dropping-reflect-metadata)
- [The prototype walk](#the-prototype-walk)
- [Merge at registration, not at lookup](#merge-at-registration-not-at-lookup)
- [`AggregateRootClass` — why not `Newable<AggregateRoot>`](#aggregaterootclass--why-not-newableaggregateroot)

---

## Dropping `reflect-metadata`

This was previously `Reflect.defineMetadata`, from the `reflect-metadata`
polyfill. It is a module-scoped `WeakMap` now, because that is all the polyfill
was ever doing for us — and it was charging a global patch, a peer dependency and
an import-order constraint for it.

The polyfill is genuinely unavoidable for exactly one feature:
`emitDecoratorMetadata`, which makes `tsc` emit `design:type` and
`design:paramtypes` for a DI container to read back. This library never asked for
that — `@Handle(CopyCheckedOut)` names its event explicitly — so the metadata API
was serving as a key-value store on a constructor. That is a `WeakMap`.

Three things improve by owning it:

- **Nothing to install, nothing to import first.** No global `Reflect` patch
  means no "was the polyfill loaded before this class was defined?" failure. This
  is what lets the root README promise no peer dependencies and no import-order
  rules.
- **The map is private.** The old store hung off the global string key
  `"event:handle:registry"`, so any code anywhere could forge a registration into
  it. This binding is module-scoped and reachable only through the class's
  methods.
- **The types are real.** `Reflect.getMetadata` returns `any`, which made the
  `HandleHandler | undefined` an unchecked assertion. Now it is checked.

`WeakMap` rather than `Map` so that a constructor which is itself garbage — a
class defined inside a test, say — does not keep its handler map alive.

## The prototype walk

`getMetadata` walks constructors until it finds a map. This is what
`Reflect.getMetadata` was doing implicitly, and losing it silently was the one
real risk in dropping the polyfill, so it is spelled out in code instead.

It works because for `class Sub extends Base`, `Object.getPrototypeOf(Sub)` _is_
`Base` — the constructor chain mirrors the inheritance chain. So an aggregate
that declares no handlers of its own inherits its parent's.

`Object.getPrototypeOf` is typed `any`, and the cast to `object | null` is not
cosmetic: `current` is the loop's own termination guard, and an unchecked `any`
there would silently defeat the `!== null` test that ends the walk.

## Merge at registration, not at lookup

`getMetadata` returns the **first** map found rather than merging the chain —
the same semantics the polyfill had.

Merging happens at registration time instead: `registerHandler` reads the
inherited map, spreads it, and writes the combined result under the subclass. So
a subclass that registers anything gets a copy of its parent's entries; a
subclass that registers nothing shares its parent's map by lookup.

The duplicate-registration check therefore also sees inherited handlers, which is
why registering a second handler for an event a parent already handles is refused
rather than silently shadowing it.

## `AggregateRootClass` — why not `Newable<AggregateRoot>`

Nothing on this path ever constructs anything. `@Handle` and this registry use
the constructor as a `WeakMap` key and read `.name` for error messages, and that
is all.

Demanding a construct signature would therefore ask for a capability that is
never used, at a price that is very real: `Entity`'s constructor is `protected`,
and TypeScript refuses to assign a protected constructor type to a public one
(TS2684). `Newable<AggregateRoot>` excludes _every_ aggregate this library can
produce.

Reading `prototype` asks the same "is this an aggregate class?" question without
putting a construct signature under the assignability check, because a class's
`prototype` property is typed as its instance type.

This is the same manoeuvre — and the same trade — as
[`Entity.create`'s `this` constraint](./entity.md#why-prototype-and-not-newablet).
There it costs an abstractness check that has to be recovered at runtime; here it
costs nothing, because nothing is constructed.
