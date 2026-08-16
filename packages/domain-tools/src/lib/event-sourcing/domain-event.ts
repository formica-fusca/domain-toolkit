import type { Newable } from "../types/newable.js";

// The reasoning behind this file — why ordering uses a counter and not
// `occurredAt`, and why `eventName` is static and cannot be checked — is in
// ../../../docs/domain-event.md.

/** A monotonic counter stamped onto every event at construction time. */
let sequenceCounter = 0;

/**
 * Something that *has already happened* in the domain, expressed in the
 * ubiquitous language.
 *
 * Three rules follow from that one sentence:
 *
 * 1. **Past tense, always.** `CopyCheckedOut`, never `CheckOutCopy`. A command
 *    can be refused; an event cannot — it is a historical fact.
 * 2. **Immutable.** You cannot change the past.
 * 3. **Carries ids and values, never aggregate instances.** An event may be
 *    handled long after it was raised, possibly in another process. Shipping a
 *    live `BookStock` object inside it would smuggle a mutable, already-stale
 *    reference across a consistency boundary.
 */
export abstract class DomainEvent {
  /**
   * Stable name used for subscription and dispatch. Namespaced by bounded
   * context — `"library.CopyCheckedOut"`, not `"CopyCheckedOut"`.
   *
   * **Static**, because it identifies the *kind* of event, and both sides of
   * the system need it without holding an instance: `@Handle(CopyCheckedOut)`
   * registers under it at class-definition time, and dispatch looks up under
   * the `name` of an event it has in hand. Those two must be the same string.
   *
   * `declare` means the base class emits no JavaScript for it — subclasses
   * provide the value. TypeScript has no `abstract static`, so a subclass that
   * forgets it cannot be caught at compile time; the getter below and
   * {@link Handle} both fail loudly instead.
   */
  declare static readonly eventName: string;

  /**
   * The instance's event name, derived from its class. Not settable, and not
   * something a subclass should redeclare as a field — declare
   * `static readonly eventName` instead, so registration and dispatch agree.
   */
  get name(): string {
    const { eventName } = this.constructor as typeof DomainEvent;

    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new Error(
        `${this.constructor.name} declares no 'static readonly eventName'.\n` +
          `Add one so that dispatch can identify it, e.g. static readonly eventName = "context.${this.constructor.name}";`,
      );
    }

    return eventName;
  }

  readonly occurredAt: Date;

  /** Global ordering stamp — see the note on `sequenceCounter` above. */
  readonly sequence: number;

  protected constructor(occurredAt: Date = new Date()) {
    this.occurredAt = occurredAt;
    this.sequence = ++sequenceCounter;
  }

  /**
   * The event's data, as plain serialisable values. Used for logging in the
   * scenarios and for the assertions in the tests.
   */
  abstract payload(): Record<string, string | number | boolean | null>;

  describe(): string {
    const fields = Object.entries(this.payload())
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    return `${this.name} { ${fields} }`;
  }
}

/** Convenience alias for handler signatures. */
export type DomainEventName = DomainEvent["name"];

/**
 * A concrete event *class* — constructible, and carrying the static
 * `eventName` that identifies it.
 *
 * `Newable<DomainEvent>` alone is not enough for {@link Handle}: a constructor
 * type says nothing about statics, so `event.eventName` would not typecheck.
 */
export type DomainEventClass<TEvent extends DomainEvent = DomainEvent> =
  Newable<TEvent> & { readonly eventName: string };
