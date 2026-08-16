/**
 * A prediction exercise for `detach` — the executable companion to
 * ../docs/detach-and-aliasing.md.
 *
 * Every case asks one question: **does a write made outside the bag reach the
 * state inside it?** Answer all eleven before revealing, in one pass, without
 * scrolling back to the doc. Getting one right for the wrong reason is the thing
 * this is built to catch, which is why the reveal prints the reason and not just
 * the verdict.
 *
 * ```
 * yarn quiz                # questions only
 * yarn quiz --reveal        # questions + answers
 * yarn quiz --reveal 4 7    # reveal only these
 * ```
 *
 * From the workspace root: `yarn workspace @domain-tools/state quiz`. The script
 * rebuilds `dist` before running, deliberately: this file imports the built
 * output, while `yarn test` compiles to `.test-build` instead — so a green test
 * run is no evidence that `dist` is current. That gap has bitten once already.
 *
 * Cases 6 and 8 differ, and so do 9 and 10. Those two pairs are the point.
 */

import { StateManager } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A class with behaviour — bucket 3, an identity as far as `detach` is concerned. */
class Marker {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return `I am ${this.name}`;
  }
}

/**
 * Stands in for a `ValueObject`, which `@domain-tools/state` cannot import —
 * the dependency arrow runs the other way. The freeze is the part that matters:
 * see docs/detach-and-aliasing.md §7.
 */
class FrozenPoint {
  constructor(x) {
    this.x = x;
    Object.freeze(this);
  }
}

/** A `Map` subclass, which `detach` declines rather than downgrade. */
class Ledger extends Map {
  total() {
    return [...this.values()].reduce((sum, n) => sum + n, 0);
  }
}

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

/**
 * Each case runs a write from outside and reports whether the bag changed.
 * `reached: true` means the state was corrupted — the write got through.
 */
const CASES = [
  {
    question:
      "A string is read out, then reassigned.\n" +
      '   let t = bag.get("title"); t = "Other";\n' +
      '   Does bag.get("title") change?',
    probe() {
      const bag = new StateManager({ title: "Dune" });
      let t = bag.get("title");
      const asRead = t;
      t = "Other";
      return {
        reached: bag.get("title") !== "Dune",
        observed: `read "${asRead}", local now "${t}", state still "${bag.get("title")}"`,
      };
    },
    why: "Primitives cannot be aliased. Rebinding a local is not a write to anything. §2.",
  },
  {
    question:
      "An array is read out, then pushed to.\n" +
      '   bag.get("books").push("new");\n' +
      "   Does the state's array grow?",
    probe() {
      const bag = new StateManager({ books: ["Dune"] });
      bag.get("books").push("new");
      return {
        reached: bag.get("books").length !== 1,
        observed: bag.get("books"),
      };
    },
    why: "The array is a container: copied on the way out. This is the guarantee. §5.",
  },
  {
    question:
      "An array OF PLAIN OBJECTS is read out, and one element is mutated.\n" +
      '   bag.get("rows")[0].n = 99;\n' +
      "   Does the state's row change?",
    probe() {
      const bag = new StateManager({ rows: [{ n: 1 }] });
      bag.get("rows")[0].n = 99;
      return {
        reached: bag.get("rows")[0].n !== 1,
        observed: bag.get("rows")[0],
      };
    },
    why: "The copy is one level deep. Fresh array, same elements. §10 — a documented limit.",
  },
  {
    question:
      "A plain object nested two levels down is mutated.\n" +
      '   bag.get("meta").deep.y = 99;\n' +
      "   Does the state change?",
    probe() {
      const bag = new StateManager({ meta: { x: 1, deep: { y: 2 } } });
      bag.get("meta").deep.y = 99;
      return {
        reached: bag.get("meta").deep.y !== 2,
        observed: bag.get("meta"),
      };
    },
    why: "Same one-level boundary, one rung further in. `meta` is fresh; `deep` is not. §10.",
  },
  {
    question:
      "The seed object handed to the constructor is mutated afterwards.\n" +
      "   const seed = { books: [] }; new StateManager(seed); seed.books.push(x);\n" +
      "   Does the state change?",
    probe() {
      const seed = { books: [] };
      const bag = new StateManager(seed);
      seed.books.push("smuggled");
      return {
        reached: bag.get("books").length !== 0,
        observed: bag.get("books"),
      };
    },
    why: "The constructor is an inbound crossing of the membrane, so it detaches too. §5.",
  },
  {
    question:
      "A Date is read out and mutated.\n" +
      '   bag.get("at").setFullYear(1999);\n' +
      "   Does the state's Date move?",
    probe() {
      const bag = new StateManager({ at: new Date("2026-08-15") });
      bag.get("at").setFullYear(1999);
      return {
        reached: bag.get("at").getFullYear() !== 2026,
        observed: bag.get("at"),
      };
    },
    why:
      "Changed on 2026-08-18. A Date is mutable and carries no identity anyone means, " +
      "so it is a container. `new Date(d.getTime())` is exact. §8.",
  },
  {
    question:
      "A Map is read out and written to.\n" +
      '   bag.get("index").set("b", 2);\n' +
      "   Does the state's Map grow?",
    probe() {
      const bag = new StateManager({ index: new Map([["a", 1]]) });
      bag.get("index").set("b", 2);
      return {
        reached: bag.get("index").size !== 1,
        observed: bag.get("index"),
      };
    },
    why: "Same as the Date: rebuilt with its own constructor, `new Map(m)`. §8.",
  },
  {
    question:
      "A Map SUBCLASS is read out and written to.\n" +
      '   bag.get("ledger").set("b", 2);\n' +
      "   Does the state's ledger grow?  (compare with 7)",
    probe() {
      const bag = new StateManager({ ledger: new Ledger([["a", 1]]) });
      bag.get("ledger").set("b", 2);
      return {
        reached: bag.get("ledger").size !== 1,
        observed: `size ${bag.get("ledger").size}, total() still works: ${bag
          .get("ledger")
          .total()}`,
      };
    },
    why:
      "`constructor ===`, not `instanceof`. `new Map(m)` would hand back a plain Map and " +
      "lose `total()`, so a subclass is declined rather than downgraded. §8.",
  },
  {
    question:
      "A class instance is read out and a public field is mutated.\n" +
      '   bag.get("marker").name = "hijacked";\n' +
      "   Does the state's marker change?",
    probe() {
      const bag = new StateManager({ marker: new Marker("m-1") });
      bag.get("marker").name = "hijacked";
      return {
        reached: bag.get("marker").name !== "m-1",
        observed: bag.get("marker").greet(),
      };
    },
    why:
      "Bucket 3: cloning would strip the prototype and any #private fields. Passed through " +
      "by reference — which is correct for an Entity, and unprotected for a plain class. §11.",
  },
  {
    question:
      "A FROZEN class instance is read out and mutated.\n" +
      '   bag.get("point").x = 99;\n' +
      "   Does the state's point change?  (compare with 9)",
    probe() {
      const bag = new StateManager({ point: new FrozenPoint(1) });
      let note = "assignment was accepted";
      try {
        bag.get("point").x = 99;
      } catch (error) {
        // This file is an ES module, so it is always in strict mode and the
        // write throws. In sloppy mode it would fail silently instead — same
        // outcome for the state, much quieter.
        note = `threw ${error.constructor.name}: ${error.message}`;
      }
      return {
        reached: bag.get("point").x !== 1,
        observed: `x is still ${bag.get("point").x} — ${note}`,
      };
    },
    why:
      "Also passed through by reference — same instruction as 9, opposite reason. The freeze " +
      "does the work `detach` would have, and it is a runtime guarantee rather than a type. " +
      "This is why ValueObject needs no special case. §7.",
  },
  {
    question:
      "A value INSIDE a rebuilt Map is mutated.\n" +
      '   bag.get("rows").get("a").n = 99;\n' +
      "   Does the state change?",
    probe() {
      const bag = new StateManager({ rows: new Map([["a", { n: 1 }]]) });
      bag.get("rows").get("a").n = 99;
      return {
        reached: bag.get("rows").get("a").n !== 1,
        observed: bag.get("rows").get("a"),
      };
    },
    why: "Rebuilding a Map is shallow, exactly like copying an array. Same boundary. §10.",
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const reveal = args.includes("--reveal");
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(
  `\n${bold("detach — prediction exercise")}\n` +
    dim("For each case: does the write reach the state inside the bag?\n") +
    (reveal ? "" : dim("Answer all eleven, then rerun with --reveal.\n")),
);

let reached = 0;

CASES.forEach((c, i) => {
  const n = i + 1;
  if (only.length && !only.includes(n)) return;

  console.log(`${bold(`${n}.`)} ${c.question}`);

  if (reveal) {
    const { reached: got, observed } = c.probe();
    if (got) reached += 1;
    const verdict = got
      ? "\x1b[31mREACHES the state\x1b[0m"
      : "\x1b[32mdoes NOT reach the state\x1b[0m";
    console.log(`   → ${verdict}`);
    console.log(dim(`     observed: ${format(observed)}`));
    console.log(dim(`     ${c.why}`));
  }
  console.log("");
});

if (reveal && !only.length) {
  console.log(
    dim(
      `${reached} of ${CASES.length} writes get through. All of them are documented ` +
        `limits, not defects —\nsee ../docs/detach-and-aliasing.md §11 for the two ` +
        `categories they fall into.\n`,
    ),
  );
}

function format(v) {
  if (v instanceof Map)
    return `Map(${v.size}) ${JSON.stringify([...v.entries()])}`;
  if (v instanceof Set) return `Set(${v.size}) ${JSON.stringify([...v])}`;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}
