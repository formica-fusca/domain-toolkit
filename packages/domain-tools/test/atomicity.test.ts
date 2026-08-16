import { test } from "node:test";
import assert from "node:assert/strict";

import { BookStock, TitleId } from "./models/book-stock.js";
import { Copy, CopyId } from "./models/copy.js";
import { Member, MemberId } from "./models/member.js";
import { CopyAdded } from "./models/domain-events.js";

/**
 * A domain operation either completes with the invariants intact, or nothing
 * about it happened.
 *
 * The defect this closes: a handler mutated, the event was recorded, and *then*
 * `assertInvariants()` threw. The caller caught the error and believed nothing
 * had happened — while the aggregate sat in an illegal state holding an event
 * that described it, which the next `save()` would publish to the rest of the
 * system.
 *
 * The unit is the **operation**, not the event, for two reasons this file also
 * pins: an aggregate is legitimately invalid between operations (`Member`'s
 * seed), and `apply` is not the only way state changes (`BookStock.adopt`).
 */

const emptyStock = () => ({ title: "Dune", barcodes: [], copies: [] });

// ---------------------------------------------------------------------------
// 1. The defect itself
// ---------------------------------------------------------------------------

test("a failed operation leaves no trace in the state", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");
  stock.pullDomainEvents();

  assert.throws(() => stock.addCopy("LIB-1"), /barcodes are unique/);

  assert.deepEqual(
    stock.barcodes,
    ["LIB-1"],
    "the duplicate must not survive the throw",
  );
});

test("a failed operation leaves no event waiting to publish", () => {
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");
  stock.pullDomainEvents();

  assert.throws(() => stock.addCopy("LIB-1"), /barcodes are unique/);

  assert.equal(
    stock.hasPendingEvents,
    false,
    "an event describing an illegal state must never reach the bus",
  );
  assert.deepEqual(stock.pullDomainEvents(), []);
});

test("the aggregate is still usable afterwards", () => {
  // Rollback, not poisoning: a caught error leaves an object you can keep using,
  // which is the difference between this and 'discard and reload'.
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");

  assert.throws(() => stock.addCopy("LIB-1"));

  stock.addCopy("LIB-2");

  assert.deepEqual(stock.barcodes, ["LIB-1", "LIB-2"]);
  assert.deepEqual(
    stock.pullDomainEvents().map((event) => event.name),
    ["library.CopyAdded", "library.CopyAdded"],
    "exactly the two that succeeded",
  );
});

// ---------------------------------------------------------------------------
// 2. Why the operation is the unit
// ---------------------------------------------------------------------------

test("a seed may be invalid, so creation must not assert", () => {
  // `Member` acquires a name on `join`. Its seed fails its own invariant, and
  // that is the design — which is why `assertInvariants` cannot be fired by the
  // framework at construction, or between replayed events.
  const member = Member.create(new MemberId("m-1"), { name: "" });

  assert.throws(() => member.assertInvariants(), /a joined member has a name/);

  member.join("Ada");

  assert.equal(member.name, "Ada");
  assert.doesNotThrow(() => member.assertInvariants());
});

test("an operation that mutates without applying an event is covered", () => {
  // `adopt` goes through `set` and applies nothing. A check hung off `apply`
  // would never see it; `mutate` wraps the operation, so it does.
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  const copy = Copy.create(new CopyId("LIB-1"));

  stock.adopt(copy);

  assert.equal(stock.get("copies").length, 1);
});

test("an operation applying several events may be invalid in between", () => {
  // The reason per-event checking would be wrong. This operation is only valid
  // once both events have landed; a check after each would reject it.
  class Batch extends BookStock {
    addPair(first: string, second: string): void {
      this.mutate(() => {
        this.apply(new CopyAdded(first));
        // invariant would hold here too, but the point is that nothing checks
        this.apply(new CopyAdded(second));
      });
    }
  }

  const stock = Batch.create(new TitleId("dune"), emptyStock());
  stock.addPair("LIB-1", "LIB-2");

  assert.deepEqual(stock.barcodes, ["LIB-1", "LIB-2"]);

  // And the pair rolls back as one.
  assert.throws(() => stock.addPair("LIB-3", "LIB-3"), /barcodes are unique/);
  assert.deepEqual(
    stock.barcodes,
    ["LIB-1", "LIB-2"],
    "neither half of a failed pair survives",
  );
});

// ---------------------------------------------------------------------------
// 3. mutate is mandatory
// ---------------------------------------------------------------------------

test("set outside an operation is refused", () => {
  class Careless extends BookStock {
    rename(title: string): void {
      this.set("title", title); // no mutate
    }
  }

  const stock = Careless.create(new TitleId("dune"), emptyStock());

  assert.throws(
    () => stock.rename("Emma"),
    /Careless\.set\(\) was called outside a domain operation/,
    "the error names the class that forgot, at the point of the mutation",
  );
  assert.equal(stock.get("title"), "Dune", "and nothing changed");
});

test("apply outside an operation is refused", () => {
  class Careless extends BookStock {
    add(barcode: string): void {
      this.apply(new CopyAdded(barcode)); // no mutate
    }
  }

  const stock = Careless.create(new TitleId("dune"), emptyStock());

  assert.throws(
    () => stock.add("LIB-1"),
    /Careless\.apply\(\) was called outside a domain operation/,
  );
  assert.equal(
    stock.hasPendingEvents,
    false,
    "refused before the handler ran, so nothing was recorded either",
  );
});

test("the guard is a depth, so operations nest", () => {
  // A boolean would have the inner operation's `finally` close the outer one's
  // context, and the rest of the outer operation would then be refused.
  class Nesting extends BookStock {
    addTwo(first: string, second: string): void {
      this.mutate(() => {
        this.addCopy(first); // opens and closes its own mutate
        this.addCopy(second); // would be refused if the first had closed ours
      });
    }
  }

  const stock = Nesting.create(new TitleId("dune"), emptyStock());
  stock.addTwo("LIB-1", "LIB-2");

  assert.deepEqual(stock.barcodes, ["LIB-1", "LIB-2"]);
});

test("a nested failure rolls the whole outer operation back", () => {
  class Nesting extends BookStock {
    addTwo(first: string, second: string): void {
      this.mutate(() => {
        this.addCopy(first);
        this.addCopy(second);
      });
    }
  }

  const stock = Nesting.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");
  stock.pullDomainEvents();

  assert.throws(() => stock.addTwo("LIB-2", "LIB-2"), /barcodes are unique/);

  assert.deepEqual(
    stock.barcodes,
    ["LIB-1"],
    "the inner operation that succeeded is undone with the one that failed",
  );
  assert.equal(stock.hasPendingEvents, false);
});

test("replay is exempt — rehydration is a mutation context of its own", () => {
  // Handlers reach `set` through `replay`, with no operation in sight. Refusing
  // that would make every aggregate un-rebuildable.
  const source = BookStock.create(new TitleId("dune"), emptyStock());
  source.addCopy("LIB-1");
  source.addCopy("LIB-2");
  const history = source.pullDomainEvents();

  const rebuilt = BookStock.fromEvents(
    new TitleId("dune"),
    emptyStock(),
    history,
  );

  assert.deepEqual(rebuilt.barcodes, ["LIB-1", "LIB-2"]);
  assert.equal(rebuilt.hasPendingEvents, false);
});

test("a child entity is not subject to the root's guard", () => {
  // `Copy` has no invariants of its own; the operation that reaches it is the
  // root's, and that one is wrapped. `record` is not a state change either way.
  const copy = Copy.create(new CopyId("LIB-1"));

  assert.doesNotThrow(() => copy.damage());
  assert.equal(copy.hasPendingEvents, true);
});

// ---------------------------------------------------------------------------
// 4. The documented limits
// ---------------------------------------------------------------------------

test("rollback does not rewind a child entity's own buffer", () => {
  // A known limit, not a surprise: each `Entity` keeps its events in a
  // `#private` field, and a root cannot reach a sibling's private state. A root
  // that mutates a child does so through the child's own method, and the child
  // keeps its event.
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  const copy = Copy.create(new CopyId("LIB-1"));
  stock.adopt(copy);
  stock.addCopy("LIB-1");
  stock.pullDomainEvents();

  copy.damage(); // recorded on the child, outside any operation

  assert.throws(() => stock.addCopy("LIB-1"), /barcodes are unique/);

  assert.equal(
    stock.hasPendingEvents,
    true,
    "the child's event is still there — the root rolled back only its own",
  );
  assert.deepEqual(
    stock.pullDomainEvents().map((event) => event.name),
    ["library.CopyDamaged"],
    "and nothing from the failed operation joined it",
  );
});

test("rollback restores containers, not values nested inside them", () => {
  // Same one-level-deep boundary as every other copy in the library.
  const stock = BookStock.create(new TitleId("dune"), emptyStock());
  stock.addCopy("LIB-1");
  stock.pullDomainEvents();

  const before = stock.get("copies");
  assert.throws(() => stock.addCopy("LIB-1"));

  assert.deepEqual(stock.get("copies"), before, "the container came back");
});

// ---------------------------------------------------------------------------
// 5. fromEvents asserts once, at the end
// ---------------------------------------------------------------------------

test("fromEvents refuses to rebuild an aggregate that violates its invariants", () => {
  // A truncated or corrupt stream used to rebuild silently into an aggregate
  // that then passed every later check.
  assert.throws(
    () => Member.fromEvents(new MemberId("m-1"), { name: "" }, []),
    /a joined member has a name/,
    "an empty stream cannot produce a joined member",
  );
});

test("fromEvents does not assert between events", () => {
  // Replay walks through states the domain would reject — the seed usually is
  // one — so a per-event check would refuse valid histories.
  const source = Member.create(new MemberId("m-1"), { name: "" });
  source.join("Ada");
  const history = source.pullDomainEvents();

  const rebuilt = Member.fromEvents(new MemberId("m-1"), { name: "" }, history);

  assert.equal(rebuilt.name, "Ada");
  assert.equal(
    rebuilt.hasPendingEvents,
    false,
    "replay rebuilds state without re-publishing history",
  );
});
