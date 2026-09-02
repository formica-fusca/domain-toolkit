import { test } from "node:test";
import assert from "node:assert/strict";

import { AggregateRoot, Entity, Identifier } from "../src/index.js";
import { BookStock, TitleId } from "./models/book-stock.js";
import { Copy, CopyId } from "./models/copy.js";

/**
 * Who is allowed to be constructed.
 *
 * `Entity` and `AggregateRoot` exist to be extended. Nothing in the type system
 * says so at the point it matters: `abstract` is erased at emit, and the `this`
 * constraint on the factories is written in terms of `prototype`, which the
 * abstract classes satisfy exactly as well as their subclasses do. Both
 * factories were therefore callable on the bases, and both ran.
 *
 * These are runtime assertions on purpose — that is the whole finding. The
 * `@ts-expect-error`-shaped guarantee does not exist for this one.
 */

const emptyStock = () => ({ title: "Dune", barcodes: [], copies: [] });

test("Entity.create refuses to build the abstract base", () => {
  assert.throws(
    () =>
      (Entity as unknown as typeof BookStock).create(
        new TitleId("dune"),
        emptyStock(),
      ),
    /Entity\.create\(\) must be called on a concrete subclass/,
    "abstract is erased at emit, so the rule has to be enforced here",
  );
});

test("AggregateRoot.fromEvents refuses to build the abstract base", () => {
  assert.throws(
    () =>
      (AggregateRoot as unknown as typeof BookStock).fromEvents(
        new TitleId("dune"),
        emptyStock(),
        [],
      ),
    /AggregateRoot\.fromEvents\(\) must be called on a concrete subclass/,
    "the doc comment claimed this did not compile; it did, and it ran",
  );
});

test("AggregateRoot.create — inherited from Entity — is guarded too", () => {
  // The marker has to be declared on `AggregateRoot` for itself, not merely
  // inherited, or this call walks past a guard that only knows about `Entity`.
  assert.throws(
    () =>
      (AggregateRoot as unknown as typeof BookStock).create(
        new TitleId("dune"),
        emptyStock(),
      ),
    /AggregateRoot\.create\(\) must be called on a concrete subclass/,
  );
});

test("a concrete subclass is built exactly as before", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());

  assert.ok(stock instanceof BookStock, "the guard must not cost a real call");
  assert.equal(stock.id.value, "dune");
});

test("the marker is not inherited by concrete subclasses", () => {
  // `Object.hasOwn`, not a truth test: statics are inherited, so a plain read of
  // `BookStock.abstractBase` finds `Entity`'s `true` and would block everything.
  assert.equal(Object.hasOwn(BookStock, "abstractBase"), false);
  assert.equal(Object.hasOwn(Entity, "abstractBase"), true);
  assert.equal(Object.hasOwn(AggregateRoot, "abstractBase"), true);
});

test("fromEvents still rebuilds a concrete aggregate from its stream", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");
  const history = stock.pullDomainEvents();

  const rebuilt = BookStock.fromEvents(
    new TitleId("dune"),
    emptyStock(),
    history,
  );

  assert.deepEqual(rebuilt.barcodes, ["LIB-1"]);
  assert.equal(
    rebuilt.hasPendingEvents,
    false,
    "replay must not re-publish what the world already knows",
  );
});

test("an author's own abstract intermediate can opt into the guard", () => {
  class Draft extends AggregateRoot<CopyId, { n: number }> {
    protected static override readonly abstractBase: boolean = true;
    assertInvariants(): void {}
  }
  class RealDraft extends Draft {}

  assert.throws(
    () =>
      (Draft as unknown as typeof BookStock).create(
        new CopyId("d") as never,
        { n: 1 } as never,
      ),
    /Draft\.create\(\) must be called on a concrete subclass/,
  );
  assert.ok(
    (RealDraft as unknown as typeof BookStock).create(
      new CopyId("d") as never,
      { n: 1 } as never,
    ) instanceof RealDraft,
    "the subclass that does not declare it for itself stays constructible",
  );
});

test("a subclass overriding create is unaffected", () => {
  // `Copy.create` does not go through the base factory at all.
  const copy = Copy.create(new CopyId("LIB-1"));

  assert.ok(copy instanceof Copy);
  assert.ok(copy.id instanceof Identifier);
});
