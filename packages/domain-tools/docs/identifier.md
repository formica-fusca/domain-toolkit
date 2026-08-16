# `Identifier`

Design notes for [`../src/lib/identifier.ts`](../src/lib/identifier.ts).

## Why a class and not a bare `string`

A `string` id is assignable to any other `string` id. Nothing stops
`checkOut(memberId, titleId)` being called as `checkOut(titleId, memberId)` —
the arguments have the same type, so the compiler has nothing to object to.

Subclasses of `Identifier` declare a distinct `_tag`, which makes them mutually
unassignable at compile time. Two identifier types with identical runtime shapes
become two different types, and the transposed call becomes an error.

This is nominal typing built by hand, in a structural type system. The `_tag`
field is never read and never written; its whole job is to make two otherwise
identical types stop matching each other structurally.

## Why `declare protected readonly _tag`

`_tag` is `abstract` on the base, so every subclass must supply it — and should
do so with `declare`:

```ts
class MemberId extends Identifier {
  declare protected readonly _tag: "MemberId";
}
```

Written as a real field instead — `protected readonly _tag = "MemberId"` — the
typing is identical, but a redundant string is then stored on every instance at
runtime. `declare` keeps the field in the type system only.

The abstract declaration on the base emits nothing in either case.

## Why equality compares the concrete class

A `TitleId` and a `MemberId` carrying the same string are not equal, because they
do not refer to the same thing. Comparing `value` alone would make them equal,
which would quietly defeat the tagging above at runtime — the very confusion the
`_tag` exists to prevent at compile time.

## Identity versus attributes

Identity is the single trait that separates an Entity from a Value Object.

Two copies of "Dune" with identical titles, authors and publication years are
_different books_ if they carry different barcodes — and the same book if they
carry the same one, even after one has been rebound and no longer matches its
former description.

That is why [`Entity.equals`](./entity.md) compares identity and nothing else.
