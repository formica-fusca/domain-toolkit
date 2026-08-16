import { test } from "node:test";
import assert from "node:assert/strict";

import { StateManager } from "../src/index.js";

/**
 * `StateManager` is the attribute bag an `Entity` **holds**. It used to be the
 * class every entity extended; the defects that came of that are recorded in
 * `docs/inheritance-to-composition.md`. It makes three promises, and this file
 * tests the two that belong to the bag itself:
 *
 * 2. **`get` hands out state without handing out control.** Reading must not
 *    become a write channel.
 * 3. **Writing belongs to the object's own behaviour.** The bag's own `set` is
 *    public, because a holder is not a subclass and `protected` would be out of
 *    `Entity`'s reach; the rule is enforced one level up, where it matters, and
 *    by reachability rather than by a modifier.
 *
 * The numbering starts at 2 deliberately. Promise 1 — **creation is strict**,
 * the `RequiredKeys` / `RequiredState` contract — cannot be tested here: it is
 * enforced by `Entity.create` and `AggregateRoot.fromEvents`, which live in
 * `domain-tools`, one package *up* the dependency arrow. Its tests stayed
 * behind in `packages/domain-tools/test/state.test.ts`, which is also where the
 * two reachability assertions live for the same reason. Pulling them down here
 * would make this package dev-depend on its own consumer.
 *
 * Several assertions here are made by the *compiler*, not at runtime: a
 * `@ts-expect-error` is a failing test if the line it guards stops being an
 * error. That is not decoration — `yarn test` runs `tsc` before `node --test`,
 * so these are enforced on every run. They are the only way to test a type,
 * which for this class is most of the behaviour.
 */

/** A fixture with one required key, one required collection, one optional. */
type ShelfState = {
  label: string;
  books: string[];
  movedAt?: Date;
};

/**
 * A subclass fixture, kept from when `set` was `protected` and exercising it
 * required one. It still earns its place: it is the only thing in the suite
 * that reads and writes through *named domain behaviour* (`rename`, `shelve`)
 * rather than poking the bag directly, which is the shape `Entity` now takes.
 *
 * Note that `StateManager` remaining extensible is fine. The finding was never
 * "this class must not be subclassed" — it was that **`Entity`** should not be
 * the one doing it.
 */
class Shelf extends StateManager<ShelfState> {
  static of(label: string, books: string[] = []): Shelf {
    return new Shelf({ label, books });
  }

  /** Takes the caller's object whole, which is what the aliasing tests need. */
  static from(state: ShelfState): Shelf {
    return new Shelf(state);
  }

  rename(label: string): void {
    this.set("label", label);
  }

  shelve(book: string): void {
    this.set("books", [...this.get("books"), book]);
  }

  /** Files a collection the caller built and still holds. */
  replaceBooks(books: string[]): void {
    this.set("books", books);
  }
}

// ---------------------------------------------------------------------------
// 2. get: reading must not become a write channel
// ---------------------------------------------------------------------------

test("get() returns a copy, so mutating the result does not reach the state", () => {
  const shelf = Shelf.of("A1", ["Dune"]);

  const snapshot = shelf.get();
  snapshot.label = "TAMPERED";

  assert.equal(
    shelf.get("label"),
    "A1",
    "handing out the live object would make every reader a writer",
  );
});

test("get() takes a fresh snapshot on each call", () => {
  const shelf = Shelf.of("A1");

  const before = shelf.get();
  shelf.rename("B2");
  const after = shelf.get();

  assert.equal(
    before.label,
    "A1",
    "an earlier snapshot must not change under the reader",
  );
  assert.equal(after.label, "B2", "a later snapshot must see the write");
});

test("get(key) reads a single property", () => {
  const shelf = Shelf.of("A1", ["Dune"]);

  assert.equal(shelf.get("label"), "A1");
  assert.deepEqual(shelf.get("books"), ["Dune"]);
});

test("a falsy key still reads that key, not the whole bag", () => {
  // The overload promises `S[K]`. The implementation signature is checked
  // against it for compatibility, never for soundness, so a `!key` test here
  // silently widened the return to `S` for every falsy-but-valid key.
  type OddState = { "": string; 0: string; ok: string };

  class Odd extends StateManager<OddState> {
    static of(): Odd {
      return new Odd({ "": "empty-key", 0: "zero-key", ok: "fine" });
    }
  }

  const odd = Odd.of();

  assert.equal(
    odd.get(""),
    "empty-key",
    '"" is falsy and a perfectly good key',
  );
  assert.equal(odd.get(0), "zero-key", "0 is falsy and a perfectly good key");
  assert.equal(odd.get("ok"), "fine");
  assert.deepEqual(
    odd.get(),
    { "": "empty-key", 0: "zero-key", ok: "fine" },
    "the no-argument overload must still hand back the whole bag",
  );
});

test("get() detaches collections, so reading is not a write channel", () => {
  // This test used to assert the opposite, as a documented limit: the copy was
  // `{...state}`, one level deep, and a caller reaching a nested collection
  // could mutate state without going through `set`. That day came deliberately.
  const shelf = Shelf.of("A1", ["Dune"]);

  shelf.get().books.push("Emma");

  assert.deepEqual(
    shelf.get("books"),
    ["Dune"],
    "the array handed out is a copy, so pushing to it reaches nothing",
  );
});

test("get(key) detaches too — the single-key read was the wider hole", () => {
  // `get()` at least spread the bag. `get(key)` returned the raw reference, and
  // it is the overload models actually call.
  const shelf = Shelf.of("A1", ["Dune"]);

  shelf.get("books").push("Emma");

  assert.deepEqual(shelf.get("books"), ["Dune"]);
});

test("construction detaches, so the caller's seed stops being a handle", () => {
  const seed = { label: "A1", books: ["Dune"] };
  const shelf = Shelf.from(seed);

  seed.label = "TAMPERED";
  seed.books.push("Emma");

  assert.equal(shelf.get("label"), "A1");
  assert.deepEqual(
    shelf.get("books"),
    ["Dune"],
    "the bag copied the collection on the way in, not just the top level",
  );
});

test("set detaches, so a retained reference cannot write later", () => {
  const shelf = Shelf.of("A1");
  const mine = ["Dune"];

  shelf.replaceBooks(mine);
  mine.push("Emma");

  assert.deepEqual(
    shelf.get("books"),
    ["Dune"],
    "symmetry: nothing enters the bag by reference either",
  );
});

test("detach copies containers and passes identities through", () => {
  // The boundary that makes this safe for a model holding entities: the array
  // is copied, its elements are not. Cloning a class instance would strip its
  // prototype and its `#private` fields — and for an entity, destroy the
  // identity that *is* the entity.
  class Marker {
    constructor(readonly name: string) {}
    greet(): string {
      return `I am ${this.name}`;
    }
  }
  type Bag = { markers: Marker[]; when: Date };

  class Holder extends StateManager<Bag> {
    static of(markers: Marker[], when: Date): Holder {
      return new Holder({ markers, when });
    }
  }

  const marker = new Marker("m-1");
  const when = new Date("2026-08-15");
  const holder = Holder.of([marker], when);

  assert.notEqual(holder.get("markers"), holder.get("markers"), "fresh array");
  assert.equal(holder.get("markers")[0], marker, "same element, by reference");
  assert.equal(
    holder.get("markers")[0]?.greet(),
    "I am m-1",
    "a cloned element would have lost its prototype",
  );
  assert.notEqual(
    holder.get("when"),
    when,
    "a Date is a container: mutable, and no caller means *this* one",
  );
  assert.equal(
    holder.get("when").getTime(),
    when.getTime(),
    "rebuilt exactly — a copy, not a coincidence",
  );
});

test("built-in containers are rebuilt, so a retained handle cannot write", () => {
  // Date, Map and Set were passed through until 2026-08-18, justified by the
  // argument that a spread cannot copy them. True, and beside the point: their
  // own constructors can. They are mutable and carry no identity anyone means,
  // so they are containers and the aliasing guarantee has to cover them.
  // See ../docs/detach-and-aliasing.md §7.
  type Bag = { at: Date; index: Map<string, number>; tags: Set<string> };

  class Holder extends StateManager<Bag> {
    static from(bag: Bag): Holder {
      return new Holder(bag);
    }
  }

  const at = new Date("2026-08-15");
  const seed: Bag = {
    at,
    index: new Map([["a", 1]]),
    tags: new Set(["x"]),
  };
  const holder = Holder.from(seed);

  // Writing through what a read handed back.
  holder.get("at").setFullYear(1999);
  holder.get("index").set("b", 2);
  holder.get("tags").add("y");

  assert.equal(holder.get("at").getFullYear(), 2026, "the Date did not move");
  assert.equal(holder.get("index").size, 1, "the Map did not grow");
  assert.equal(holder.get("tags").size, 1, "the Set did not grow");

  // Writing through the seed the caller still holds.
  at.setFullYear(1999);
  seed.index.set("c", 3);
  assert.equal(
    holder.get("at").getFullYear(),
    2026,
    "the seed is not a handle",
  );
  assert.equal(holder.get("index").size, 1, "nor is the seed's Map");
});

test("a subclass of a built-in is an identity, not a container", () => {
  // `new Map(m)` on a subclass hands back a plain Map — the methods go, and so
  // does anything the subclass carried. That is the lookalike problem again, so
  // the check is `constructor ===` and not `instanceof`, and a subclass is
  // declined rather than silently downgraded.
  class Ledger extends Map<string, number> {
    total(): number {
      return [...this.values()].reduce((sum, n) => sum + n, 0);
    }
  }

  type Bag = { ledger: Ledger };

  class Holder extends StateManager<Bag> {
    static from(bag: Bag): Holder {
      return new Holder(bag);
    }
  }

  const ledger = new Ledger([["a", 1]]);
  const holder = Holder.from({ ledger });

  assert.equal(holder.get("ledger"), ledger, "passed through by reference");
  assert.equal(
    holder.get("ledger").total(),
    1,
    "a rebuilt Map would have lost `total`",
  );
});

test("rebuilding a built-in is shallow, like every other copy here", () => {
  // Same one-level boundary as arrays and plain objects: the Map is fresh, the
  // values in it are whoever's they already were.
  type Bag = { rows: Map<string, { n: number }> };

  class Holder extends StateManager<Bag> {
    static from(bag: Bag): Holder {
      return new Holder(bag);
    }
  }

  const row = { n: 1 };
  const holder = Holder.from({ rows: new Map([["a", row]]) });

  holder.get("rows").get("a")!.n = 99;

  assert.equal(holder.get("rows").get("a")?.n, 99, "the value was reachable");
  assert.equal(holder.get("rows").size, 1, "the container still was not");
});

test("the copy is one level deep — a documented limit, not an oversight", () => {
  // An array of plain objects yields a fresh array holding the same objects.
  // Deeper nesting wants to be a class, which detach passes through untouched.
  type Bag = { rows: { n: number }[] };
  class Holder extends StateManager<Bag> {
    static of(rows: { n: number }[]): Holder {
      return new Holder({ rows });
    }
  }

  const holder = Holder.of([{ n: 1 }]);
  // The `!` is redundant only because `noUncheckedIndexedAccess` is off. It is
  // kept so this line stays correct if that ever changes.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  holder.get("rows")[0]!.n = 99;

  assert.equal(
    holder.get("rows")[0]?.n,
    99,
    "the element is shared; only the container was copied",
  );
});

// ---------------------------------------------------------------------------
// 3. set: the only way in, and only from inside
// ---------------------------------------------------------------------------

test("set replaces the value at a key", () => {
  const shelf = Shelf.of("A1");

  shelf.rename("B2");

  assert.equal(shelf.get("label"), "B2");
});

test("set leaves the other properties alone", () => {
  const shelf = Shelf.of("A1", ["Dune"]);

  shelf.rename("B2");

  assert.deepEqual(
    shelf.get(),
    { label: "B2", books: ["Dune"] },
    "writing one key must not rebuild the bag",
  );
});

test("a write through the object's own behaviour is visible to readers", () => {
  const shelf = Shelf.of("A1", ["Dune"]);

  shelf.shelve("Emma");

  assert.deepEqual(shelf.get("books"), ["Dune", "Emma"]);
});

test("set rejects a key that is not part of the state", () => {
  class Bogus extends StateManager<ShelfState> {
    static of(): Bogus {
      return new Bogus({ label: "A1", books: [] });
    }

    write(): void {
      // @ts-expect-error "shelfmark" is not a key of ShelfState.
      this.set("shelfmark", "x");
    }
  }

  Bogus.of().write();

  assert.ok(true, "the assertion above is made by tsc, not at runtime");
});

test("set rejects a value that does not belong to the key it is filed under", () => {
  // The key and the value must be checked *together*. A signature of
  // `set(key: keyof S, value: S[keyof S])` checks them apart: `S[keyof S]`
  // distributes to `string | string[] | Date | undefined` here, so every key
  // accepts every other key's value type and the state bag can drift from its
  // own declared shape with no compile-time signal.
  class Corrupt extends StateManager<ShelfState> {
    static of(): Corrupt {
      return new Corrupt({ label: "A1", books: [] });
    }

    write(): void {
      // @ts-expect-error `label` is a string; a string[] belongs to `books`.
      this.set("label", ["Dune"]);
    }
  }

  Corrupt.of().write();

  assert.ok(true, "the assertion above is made by tsc, not at runtime");
});
