import { test } from "node:test";
import assert from "node:assert/strict";
import { BookStock, TitleId } from "./models/book-stock.js";
import { Copy, CopyId } from "./models/copy.js";
import { Member, MemberId } from "./models/member.js";

/**
 * The aggregate boundary: which entities live inside it, and what is allowed to
 * cross it.
 *
 * Most of what the boundary promises is enforced by the type system rather than
 * at runtime — `record()` is `protected`, and nothing outside is given a
 * reference to a child. What *is* observable, and therefore what this file
 * tests, is the one behaviour the root actually implements: it reaches into the
 * entities `childEntities()` declares, drains them, and orders the result.
 */

test("a root with no children drains its own events", () => {
  const member = Member.create(new MemberId("m-1"), { name: "" });
  member.join("Ada");

  assert.equal(member.name, "Ada");

  const drained = member.pullDomainEvents();
  assert.deepEqual(
    drained.map((event) => event.name),
    ["library.MemberJoined"],
    "the default childEntities() must not be a special case",
  );
});

test("the root drains its children, it does not copy from them", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const copy = Copy.create(new CopyId("LIB-1"));
  stock.adopt(copy);

  copy.damage();

  assert.equal(stock.pullDomainEvents().length, 1);
  assert.equal(
    copy.hasPendingEvents,
    false,
    "the child's buffer must be emptied by the root's pull",
  );
  assert.equal(
    stock.pullDomainEvents().length,
    0,
    "a second save must not republish the child's history",
  );
});

test("the root reports pending events it recorded itself", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });

  assert.equal(stock.hasPendingEvents, false, "nothing has happened yet");

  stock.addCopy("LIB-1"); // no child involved at all

  assert.equal(
    stock.hasPendingEvents,
    true,
    "overriding must not lose the root's own buffer",
  );

  stock.pullDomainEvents();
  assert.equal(stock.hasPendingEvents, false, "drained");
});

test("a childless root reports its own pending events", () => {
  const member = Member.create(new MemberId("m-1"), { name: "" });

  assert.equal(member.hasPendingEvents, false);
  member.join("Ada");

  assert.equal(
    member.hasPendingEvents,
    true,
    "an empty childEntities() must not mask the root's own buffer",
  );
});

test("the root reports pending events recorded by a child", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const copy = Copy.create(new CopyId("LIB-1"));
  stock.adopt(copy);

  assert.equal(stock.hasPendingEvents, false, "nothing has happened yet");

  copy.damage(); // the root itself records nothing

  assert.equal(
    stock.hasPendingEvents,
    true,
    "hasPendingEvents and pullDomainEvents must agree on what is inside",
  );
  assert.equal(stock.pullDomainEvents().length, 1);
  assert.equal(stock.hasPendingEvents, false, "drained");
});

test("a drained child does not mask the root's own pending events", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const copy = Copy.create(new CopyId("LIB-1"));
  stock.adopt(copy);

  stock.addCopy("LIB-2"); // only the root records

  assert.equal(
    copy.hasPendingEvents,
    false,
    "the child is deliberately empty here",
  );
  assert.equal(
    stock.hasPendingEvents,
    true,
    "a quiet child must not shout down the root",
  );
});

test("events from several children interleave with the root's, by sequence", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const first = Copy.create(new CopyId("LIB-1"));
  const second = Copy.create(new CopyId("LIB-2"));
  stock.adopt(first);
  stock.adopt(second);

  first.damage(); // 1
  stock.addCopy("LIB-3"); // 2
  second.damage(); // 3
  stock.addCopy("LIB-4"); // 4

  const drained = stock.pullDomainEvents();

  assert.deepEqual(
    drained.map((event) => event.describe()),
    [
      "library.CopyDamaged { copyId=LIB-1 }",
      "library.CopyAdded { barcode=LIB-3 }",
      "library.CopyDamaged { copyId=LIB-2 }",
      "library.CopyAdded { barcode=LIB-4 }",
    ],
    "grouping by source — root first, then child-by-child — would misreport history",
  );
});

test("a child declared twice still yields its events once", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const copy = Copy.create(new CopyId("LIB-1"));
  stock.adopt(copy);
  stock.adopt(copy); // the same instance, declared twice

  copy.damage();

  assert.equal(
    stock.pullDomainEvents().length,
    1,
    "draining is destructive, so the second visit finds an empty buffer",
  );
});

test("a child adopted after the fact still has its history published", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const copy = Copy.create(new CopyId("LIB-1"));

  copy.damage(); // recorded while still outside the boundary
  stock.adopt(copy);

  assert.deepEqual(
    stock.pullDomainEvents().map((event) => event.name),
    ["library.CopyDamaged"],
    "events buffer on the entity, so joining the cluster late loses nothing",
  );
});

test("a cycle in the child graph terminates instead of overflowing the stack", () => {
  // Nesting aggregates is not the intent — an aggregate referencing another
  // should hold its id. But `childEntities()` is typed as `Entity`, so a root
  // that returns another root re-enters through the public method, and a cycle
  // recursed until RangeError. Both traversals must simply stop.
  const dune = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const emma = BookStock.create(new TitleId("emma"), {
    title: "Emma",
    barcodes: [],
    copies: [],
  });

  dune.adopt(emma as unknown as Copy);
  emma.adopt(dune as unknown as Copy);

  assert.equal(
    dune.hasPendingEvents,
    false,
    "no stack overflow, just an answer",
  );

  emma.addCopy("LIB-1");

  assert.equal(
    dune.hasPendingEvents,
    true,
    "the cycle guard must not blind a root to a genuine pending event",
  );
  assert.deepEqual(
    dune.pullDomainEvents().map((event) => event.name),
    ["library.CopyAdded"],
    "and each event is reported exactly once, by the outermost frame",
  );
});

test("the traversal flag is cleared when a child throws", () => {
  const stock = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const exploding = {
    get hasPendingEvents(): boolean {
      throw new Error("boom");
    },
    pullDomainEvents: () => [],
  };
  stock.adopt(exploding as unknown as Copy);

  assert.throws(() => stock.hasPendingEvents, /boom/);
  assert.throws(
    () => stock.hasPendingEvents,
    /boom/,
    "a `finally` must restore the flag, or the second ask silently returns false",
  );
});

test("draining one root leaves another root's children untouched", () => {
  const dune = BookStock.create(new TitleId("dune"), {
    title: "Dune",
    barcodes: [],
    copies: [],
  });
  const emma = BookStock.create(new TitleId("emma"), {
    title: "Emma",
    barcodes: [],
    copies: [],
  });
  const duneCopy = Copy.create(new CopyId("LIB-1"));
  const emmaCopy = Copy.create(new CopyId("LIB-2"));
  dune.adopt(duneCopy);
  emma.adopt(emmaCopy);

  duneCopy.damage();
  emmaCopy.damage();

  assert.equal(dune.pullDomainEvents().length, 1);
  assert.equal(
    emma.hasPendingEvents,
    true,
    "each boundary is drained on its own, per save",
  );
  assert.equal(emmaCopy.hasPendingEvents, true);
});
