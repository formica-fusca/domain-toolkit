# `ValueObject`

Design notes for [`../src/lib/value-object.ts`](../src/lib/value-object.ts).

## The test for "is this a value object?"

_If you replaced this instance with another one carrying the same attributes,
would anything in the business change?_

If no, it is a Value Object. A 10-euro note is interchangeable with any other
10-euro note. A specific copy of a book, bearing barcode `LIB-000031`, is not
interchangeable with any other copy — the library must know which one is on your
shelf at home. That one is an [`Entity`](./entity.md).

## Why immutability is enforced, not just recommended

The constructor runs `Object.freeze({ ...props })`. Two things follow.

The spread means the caller's object stops being a handle: freezing the argument
itself would be a surprising side effect on someone else's value, and not
freezing it at all would leave the props mutable from outside.

The freeze is what makes value objects safe to share freely across aggregates.
"Changing" one means constructing a new one, so nobody can mutate a value you are
holding — which is the property that lets a value object cross a consistency
boundary without the receiving aggregate having to defend itself.

## Why `equals` is deliberately shallow

Props are expected to be primitives or other Value Objects, and the comparison
handles both: a nested `ValueObject` is compared through its own `equals`, and so
is anything else that structurally offers one.

Nesting a mutable array or plain object inside a Value Object is a modelling
smell, and this method not supporting it is a feature rather than a gap. A value
object holding a mutable container is not really immutable, and deep-comparing
one would paper over that.

The concrete-class check exists so that two different Value Objects with
coincidentally identical shapes are not confused for one another — the same
reasoning as [`Identifier.equals`](./identifier.md#why-equality-compares-the-concrete-class).

## Why `reject` is a static helper

A Value Object that cannot be constructed in an invalid state is the cheapest
invariant enforcement there is: the rule is upheld by the type simply existing.
No operation has to remember to check it, because there is no way to obtain an
instance that breaks it.

`reject` returns `never`, so a subclass can use it in a position where the
compiler needs to know control flow ends.
