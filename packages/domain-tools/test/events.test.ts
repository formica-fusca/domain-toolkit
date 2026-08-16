import { test } from "node:test";
import assert from "node:assert/strict";

import { Handle, HandleRegistry } from "../src/index.js";
import type { DomainEventClass } from "../src/index.js";
import { BookStock, TitleId } from "./models/book-stock.js";
import { Copy, CopyId } from "./models/copy.js";
import { CopyAdded, Nameless } from "./models/domain-events.js";

/** The seed every rebuilt or freshly created `BookStock` starts from here. */
const emptyStock = () => ({ title: "Dune", barcodes: [], copies: [] });

test("an event's name comes from its static eventName", () => {
  assert.equal(new CopyAdded("LIB-1").name, "library.CopyAdded");
  assert.equal(CopyAdded.eventName, "library.CopyAdded");
});

test("an event without eventName fails loudly rather than dispatching wrong", () => {
  assert.throws(
    () => new Nameless().name,
    /declares no 'static readonly eventName'/,
  );
});

test("@Handle rejects an event class with no eventName, at decoration time", () => {
  assert.throws(
    () =>
      // The cast IS the test: `Nameless` is not a `DomainEventClass`, and
      // forcing it through is the only way to reach the runtime guard.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      Handle(Nameless as unknown as DomainEventClass)(
        BookStock.prototype,
        "onCopyAdded",
        Object.getOwnPropertyDescriptor(BookStock.prototype, "onCopyAdded")!,
      ),
    /declares no 'static readonly eventName'/,
  );
});

test("registration and dispatch agree on the same key", () => {
  const registered = HandleRegistry.getMetadata(BookStock);
  const lookedUp = new CopyAdded("LIB-1").name;

  assert.deepEqual(registered, { "library.CopyAdded": "onCopyAdded" });
  assert.equal(
    HandleRegistry.getHandlerName(BookStock, lookedUp),
    "onCopyAdded",
  );
});

test("apply routes to the handler and records the event", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");

  assert.deepEqual(stock.barcodes, ["LIB-1"]);

  const drained = stock.pullDomainEvents();
  assert.equal(drained.length, 1);
  // The `!` is redundant only because `noUncheckedIndexedAccess` is off. It is
  // kept so this line stays correct if that ever changes.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  assert.equal(drained[0]!.name, "library.CopyAdded");
});

test("applying an event with no handler throws instead of silently recording", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());

  assert.throws(() => stock.repaintShelf(), /has no @Handle method/);
  assert.equal(stock.hasPendingEvents, false, "nothing may be recorded");
});

test("pullDomainEvents drains exactly once", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");

  assert.equal(stock.pullDomainEvents().length, 1);
  assert.equal(stock.pullDomainEvents().length, 0, "history must not replay");
});

test("child events are drained through the root, in causal order", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  const copy = Copy.create(new CopyId("LIB-1"));
  stock.adopt(copy);

  copy.damage(); // recorded first, on the child
  stock.addCopy("LIB-2"); // recorded second, on the root

  const drained = stock.pullDomainEvents();

  assert.deepEqual(
    drained.map((event) => event.name),
    ["library.CopyDamaged", "library.CopyAdded"],
    "the sequence stamp must win over root-before-children ordering",
  );
});

test("an undeclared child's events never leave the boundary", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  const orphan = Copy.create(new CopyId("LIB-9")); // never adopt()ed

  orphan.damage();

  assert.equal(stock.pullDomainEvents().length, 0);
  assert.equal(orphan.hasPendingEvents, true, "silently stranded, by design");
});

test("fromEvents rebuilds state without re-recording history", () => {
  const rebuilt = BookStock.fromEvents(new TitleId("dune"), emptyStock(), [
    new CopyAdded("LIB-1"),
    new CopyAdded("LIB-2"),
  ]);

  assert.deepEqual(rebuilt.barcodes, ["LIB-1", "LIB-2"]);
  assert.equal(
    rebuilt.hasPendingEvents,
    false,
    "replayed events must not be published again",
  );
});

test("registering two handlers for one event is refused", () => {
  assert.throws(
    () =>
      Handle(CopyAdded)(
        BookStock.prototype,
        "onCopyAdded",
        Object.getOwnPropertyDescriptor(BookStock.prototype, "onCopyAdded")!,
      ),
    /already handled by/,
  );
});
