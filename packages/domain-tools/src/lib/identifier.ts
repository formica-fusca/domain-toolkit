import { InvariantViolation } from "./errors.js";

/**
 * The identity of an Entity.
 *
 * Identity is the single trait that separates an Entity from a Value Object.
 * Two copies of "Dune" with identical titles, authors and publication years are
 * *different books* if they carry different barcodes — and the same book if
 * they carry the same one, even after one has been rebound and no longer
 * matches its former description.
 *
 * ## Why a class and not a bare `string`
 *
 * A `string` id is assignable to any other `string` id. Nothing stops
 * `checkOut(memberId, titleId)` being called as `checkOut(titleId, memberId)`.
 * Subclasses of `Identifier` declare a distinct `_tag`, which makes them
 * mutually unassignable at compile time.
 *
 * `_tag` is `abstract`, so every subclass must supply it — and should do so
 * with `declare`, which keeps the field in the type system only:
 *
 * ```ts
 * class MemberId extends Identifier {
 *   declare protected readonly _tag: "MemberId";
 * }
 * ```
 *
 * Why `declare` rather than a real field, and what this buys: ../../docs/identifier.md
 */
export abstract class Identifier {
  protected abstract readonly _tag: string;

  readonly value: string;

  protected constructor(value: string) {
    if (value.trim().length === 0) {
      throw new InvariantViolation(
        "identifier is not blank",
        "received an empty string",
      );
    }
    this.value = value;
  }

  /**
   * Identifiers compare by value *and* by concrete class. A `TitleId` and a
   * `MemberId` carrying the same string are not equal, because they do not
   * refer to the same thing.
   */
  equals(other: Identifier | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    return other.constructor === this.constructor && other.value === this.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
