import { test } from "node:test";
import assert from "node:assert/strict";

import { InvariantViolation } from "../src/index.js";
import { TitleId, Barcode } from "./models/book-stock.js";
import { CopyId, Copy } from "./models/copy.js";
import { MemberId } from "./models/member.js";

test("an identifier rejects a blank value", () => {
  assert.throws(() => new TitleId("   "), InvariantViolation);
});

test("identifiers of different types are never equal", () => {
  assert.equal(new TitleId("x").equals(new MemberId("x")), false);
});

test("identifiers of the same type compare by value", () => {
  assert.equal(new TitleId("dune").equals(new TitleId("dune")), true);
  assert.equal(new TitleId("dune").equals(new TitleId("emma")), false);
});

test("the phantom _tag emits nothing onto instances", () => {
  assert.deepEqual(Object.keys(new TitleId("dune")), ["value"]);
});

test("entities compare by identity, ignoring attributes", () => {
  const id = new CopyId("LIB-1");
  const one = Copy.create(id);
  const other = Copy.create(new CopyId("LIB-1"));

  other.damage();

  assert.equal(one.equals(other), true, "a stale copy is still the same copy");
  assert.equal(one.equals(null), false);
  assert.equal(one.equals(Copy.create(new CopyId("LIB-2"))), false);
});

test("value objects compare structurally", () => {
  assert.equal(new Barcode("LIB-1").equals(new Barcode("LIB-1")), true);
  assert.equal(new Barcode("LIB-1").equals(new Barcode("LIB-2")), false);
});

test("a value object refuses to exist in an invalid state", () => {
  assert.throws(() => new Barcode("nope"), InvariantViolation);
});
