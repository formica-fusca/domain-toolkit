# `@Handle`

Design notes for
[`../src/lib/event-sourcing/handle-decorator.ts`](../src/lib/event-sourcing/handle-decorator.ts).

## Why registration keys on `eventName`

Registration happens under `event.eventName` — the same string an instance
reports as its `name`, so
[`AggregateRoot.apply`](./aggregate-root.md#invokehandler--why-a-missing-handler-throws)
can find the method again from an event it holds.

Keying on the class name instead, as this once did, breaks twice over:

- **A namespaced `eventName` never matches.** Registration stored
  `"CopyCheckedOut"`; dispatch looked up `"library.CopyCheckedOut"`. The handler
  was registered and unreachable.
- **Any bundler that mangles class names silently unregisters every handler.**
  `Function.name` is not stable under minification. `eventName` is a string
  literal the model author wrote, so it survives.

The failure mode in both cases is silence: an event applied with no handler found
would, without the guard, have been recorded for publication while changing
nothing.

## Why it validates at decoration time

The decorator runs when the class is _defined_, not when it is instantiated. A
missing `static readonly eventName` therefore fails at **import** time rather
than at dispatch.

That matters because the alternative is a failure that only appears when a
particular event is applied — possibly in production, possibly months later,
certainly far from the class that forgot the field. TypeScript cannot check this
statically, because it has no `abstract static`; see
[`domain-event.md`](./domain-event.md#why-declare-and-why-it-cannot-be-checked).

## The `target.constructor as AggregateRootClass` assertion

Kept against the linter, which reads it as unnecessary.

`target.constructor` is typed `Function`, and `Function` satisfies
`AggregateRootClass` structurally only because that type asks for `prototype` and
`name` — both of which `Function` happens to have. The assertion is redundant to
the compiler and load-bearing to the reader: it states the intent the structural
match arrives at by accident.

The same assertion, for the same reason, appears in
`AggregateRoot.#invokeHandler`.

## Decorator flavour

This is a legacy (stage-2, `experimentalDecorators`) method decorator — it takes
`(target, propertyKey, descriptor)` and returns the descriptor unchanged. That is
why consumers need `"experimentalDecorators": true`, which the root README
documents as the library's only compiler-option requirement.

It returns `descriptor` rather than mutating anything: the decorator's only
effect is the registry write. The method itself is left exactly as declared.
