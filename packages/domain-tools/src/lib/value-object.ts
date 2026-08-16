import { InvariantViolation } from "./errors.js";

/**
 * A Value Object is defined entirely by its attributes. It has no identity and
 * no lifecycle.
 *
 * The test: *if you replaced this instance with another one carrying the same
 * attributes, would anything in the business change?* If no, it is a Value
 * Object. A 10-euro note is interchangeable with any other 10-euro note; a
 * specific copy of a book, bearing barcode `LIB-000031`, is not interchangeable
 * with any other copy — the library must know which one is on your shelf at
 * home.
 *
 * Value Objects are immutable. "Changing" one means constructing a new one.
 * This is what makes them safe to share freely across aggregates: nobody can
 * mutate a value you are holding.
 */
export abstract class ValueObject<TProps extends object> {
  protected readonly props: Readonly<TProps>;

  protected constructor(props: TProps) {
    this.props = Object.freeze({ ...props });
  }

  /**
   * Structural equality over the declared props, plus a concrete-class check so
   * that two different Value Objects with coincidentally identical shapes are
   * not confused for one another.
   *
   * Deliberately a *shallow* comparison: props are expected to be primitives or
   * other Value Objects. See ../../docs/value-object.md.
   */
  equals(other: ValueObject<TProps> | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;

    const mine = this.props as Readonly<Record<string, unknown>>;
    const theirs = other.props as Readonly<Record<string, unknown>>;
    const keys = Object.keys(mine);

    if (keys.length !== Object.keys(theirs).length) return false;

    return keys.every((key) => {
      const a = mine[key];
      const b = theirs[key];
      if (a instanceof ValueObject) return a.equals(b as ValueObject<never>);
      if (
        a &&
        typeof a === "object" &&
        "equals" in a &&
        typeof a.equals === "function"
      ) {
        return (a.equals as (o: unknown) => boolean)(b);
      }
      return Object.is(a, b);
    });
  }

  /**
   * Helper for subclasses: fail construction when the attributes do not make
   * sense. A Value Object that cannot be constructed in an invalid state is the
   * cheapest invariant enforcement there is — the rule is upheld by the type
   * simply existing.
   */
  protected static reject(rule: string, explanation: string): never {
    throw new InvariantViolation(rule, explanation);
  }
}
