import { test } from "node:test";
import assert from "node:assert/strict";

import { StateManager } from "@domain-tools/state";

import { Entity } from "../src/index.js";
import { BookStock, TitleId } from "./models/book-stock.js";

/**
 * The seam between an `Entity` and the `StateManager` it **holds**.
 *
 * The bag itself lives in `@domain-tools/state` and is tested there — its
 * `get`/`set`/`detach` promises need nothing from this package. What is left
 * here is everything that can only be asserted from *above* the dependency
 * arrow, and it is two groups:
 *
 * 1. **Creation is strict.** `RequiredKeys` / `RequiredState` are declared in
 *    `@domain-tools/state`, but the only paths that apply them are
 *    `Entity.create` and `AggregateRoot.fromEvents`, which are ours. The types
 *    used to sit on `StateManager.init`, which nothing called — see
 *    `docs/state-manager-init.md` §0 and §7.
 * 2. **The manager is unreachable.** `StateManager.set` is public, because a
 *    holder is not a subclass and `protected` would be out of `Entity`'s reach.
 *    What replaces the modifier is a runtime fact about *this* class: an entity
 *    keeps its bag behind `#state` and hands out no way to it. Only an `Entity`
 *    can demonstrate that.
 *
 * Several assertions here are made by the *compiler*, not at runtime: a
 * `@ts-expect-error` is a failing test if the line it guards stops being an
 * error. That is not decoration — `yarn test` runs `tsc` before `node --test`,
 * so these are enforced on every run. They are the only way to test a type,
 * which for this contract is most of the behaviour.
 */

// ---------------------------------------------------------------------------
// 1. create: the required/optional contract
// ---------------------------------------------------------------------------

/** A fixture for the slot-versus-value distinction. */
class Row extends Entity<
  TitleId,
  { id: string; deletedAt: Date | undefined }
> {}

const emptyStock = () => ({ title: "Dune", barcodes: [], copies: [] });

test("create accepts an object carrying only the required properties", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());

  assert.deepEqual(stock.get(), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
});

test("an omitted optional property reads back as undefined", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());

  assert.equal(
    stock.author,
    undefined,
    "the cast in create must not invent a value for a deferred property",
  );
});

test("create rejects an object missing a required property", () => {
  // Note where the directive sits, against the test below it. A *missing*
  // property (TS2741) is reported at the object literal; an *excess* property
  // (TS2353) is reported at the offending property. `@ts-expect-error` only
  // covers the line immediately following it, so the two cases need it in
  // different places — and getting it wrong yields a confusing pair: TS2578
  // "unused directive" where you wrote it, and the real error elsewhere.
  BookStock.create(
    new TitleId("dune"),
    // @ts-expect-error `copies` is required, so RequiredState keeps it.
    { title: "Dune", barcodes: [] },
  );

  assert.ok(true, "the assertion above is made by tsc, not at runtime");
});

test("create rejects an object SUPPLYING an optional property", () => {
  // The whole point of `RequiredState`, and the half a plain `S` cannot express.
  // Omitting an optional property is something TypeScript already allows;
  // refusing to accept one is what this type adds. An entity begins life
  // holding exactly what it cannot exist without.
  BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
    // @ts-expect-error `author` is deferred: creation may not set it.
    author: "Herbert",
  });

  assert.ok(true, "the assertion above is made by tsc, not at runtime");
});

test("a deferred property is filled in by behaviour, not by creation", () => {
  // The other half of the convention. A `?` property is a promise that a domain
  // method exists to write it — without one it would be silently unreachable.
  const stock = BookStock.create(new TitleId("dune"), emptyStock());

  assert.equal(stock.author, undefined);

  stock.attributeTo("Frank Herbert");

  assert.equal(stock.author, "Frank Herbert");
  assert.throws(
    () => stock.attributeTo("  "),
    /an attributed author is named/,
    "arriving later does not mean arriving unchecked",
  );
});

test("a required property whose value may be undefined is still required", () => {
  // The distinction `RequiredKeys` is written to draw: it asks whether the
  // property *slot* may be absent, not whether the value may be undefined.
  // This is what lets a model say "sparse" (`deletedAt: Date | undefined`,
  // supplied at creation) separately from "deferred" (`author?: string`).

  // @ts-expect-error `deletedAt` has no `?`, so the slot must be supplied.
  Row.create(new TitleId("r-1"), { id: "r-1" });

  const explicit = Row.create(new TitleId("r-1"), {
    id: "r-1",
    deletedAt: undefined,
  });

  assert.equal(
    explicit.get("deletedAt"),
    undefined,
    "supplying the slot explicitly is what the type demands, and it round-trips",
  );
});

test("fromEvents is strict in the same way", () => {
  // The seed is by definition the shape before anything happened, and a
  // deferred property is by convention one that only happens later.
  const rebuilt = BookStock.fromEvents(new TitleId("dune"), emptyStock(), []);
  assert.equal(rebuilt.author, undefined);

  BookStock.fromEvents(
    new TitleId("dune"),
    {
      title: "Dune",
      barcodes: [],
      copies: [],
      // @ts-expect-error a rehydration handed a deferred value would be saying
      // the stream is not the whole history.
      author: "Herbert",
    },
    [],
  );
});

// ---------------------------------------------------------------------------
// 2. reachability: what replaced the `protected` modifier
// ---------------------------------------------------------------------------

test("set is not reachable from outside the entity", () => {
  // This assertion used to be made against a bare `StateManager` subclass, back
  // when `Entity extends StateManager` and `set` was `protected` on the base.
  // Under composition the manager's `set` is public — a holder is not a
  // subclass, so `protected` would put it out of `Entity`'s reach — and the
  // guarantee moved to where it always mattered: an *entity* does not let
  // application code write its state directly.
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });

  // Guarded twice over, and the second guard is newer. The compiler refuses the
  // call because `set` is `protected` on `Entity`; the runtime refuses it because
  // it is outside a `mutate` block, so even a caller who casts the type away
  // cannot change state without an operation to check and roll it back.
  assert.throws(
    // @ts-expect-error `set` is protected: application code must call a method
    // that means something in the domain.
    () => stock.set("title", "Emma"),
    /was called outside a domain operation/,
  );
});

test("the manager itself is unreachable, which is what makes its set public safe", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });

  // `#state` is a true private field, so no reflection reaches it. Under the
  // old `private state: S` the bag was listed here and writable from plain JS.
  assert.deepEqual(Object.keys(stock), ["id"]);
  assert.equal(
    Reflect.ownKeys(stock).some((key) => String(key).includes("state")),
    false,
    "the guarantee is runtime reachability now, not an erased modifier",
  );
  assert.equal(
    Object.values(stock).some((value) => value instanceof StateManager),
    false,
    "there is no way to obtain the manager and call its public set",
  );
});
