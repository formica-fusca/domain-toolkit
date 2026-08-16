import type { DomainEvent } from "./event-sourcing/domain-event.js";
import { HandleRegistry } from "./event-sourcing/handle-registry.js";
import { Entity, assertConcrete } from "./entity.js";
import type { IdOf, StateOf } from "./entity.js";
import type { Identifier } from "./identifier.js";
import type { AggregateRootClass } from "./types/aggregate-root-class.js";
import type { Newable } from "./types/newable.js";
import { State } from "@domain-tools/state";
import type { RequiredState } from "@domain-tools/state";

// The reasoning behind this file — the cycle guard, why `hasPendingEvents` is
// overridden at all, and the abstractness check `fromEvents` traded away — is
// in ../../docs/aggregate-root.md.

/**
 * An Aggregate Root is an Entity with a second job: it is the **consistency
 * boundary** for a cluster of objects that must obey a rule together.
 *
 * Every Aggregate Root is an Entity. Not every Entity is an Aggregate Root.
 * The extra responsibilities are exactly three:
 *
 * 1. **It is the only way in.** Nothing outside the aggregate may hold a
 *    reference to a child entity, and nothing outside may call a method on one.
 *    All behaviour is invoked on the root.
 * 2. **It guarantees its invariants.** After any method returns, the rule
 *    spanning the cluster holds. This is only possible because rule (1)
 *    prevents anyone changing a child behind the root's back.
 * 3. **It is the unit of persistence and of publication.** Repositories load
 *    and save whole aggregates; domain events leave the model through the root.
 *
 * ## How big should an aggregate be?
 *
 * As small as its invariants allow. Two objects belong in the same aggregate
 * **only** if there is a rule that must be true of both of them *at every
 * instant*. If the rule can be true "shortly afterwards" — eventually — then
 * they are two aggregates and an event connects them.
 *
 * In this codebase: `BookStock` contains its `Copy` entities because
 * `availableCount` must match the copies at every instant. `Member` and `Loan`
 * are separate aggregates, because "a member has at most N loans" is allowed to
 * be repaired a moment later, by an event handler.
 */
export abstract class AggregateRoot<
  TId extends Identifier = Identifier,
  EntityState extends State = State,
> extends Entity<TId, EntityState> {
  /**
   * Declared for itself, not merely inherited — see {@link Entity.abstractBase}.
   * The guard is `Object.hasOwn`, so without its own copy this class would walk
   * straight past it.
   */
  protected static override readonly abstractBase: boolean = true;

  /** Guards the recursive traversals below against a cycle in the child graph. */
  #traversing = false;

  /**
   * The child entities living inside this boundary.
   *
   * The root must declare them, because it is the root's job to drain their
   * recorded events. Forget one and its events are silently dropped.
   *
   * Defaults to none: plenty of aggregate roots are a single entity with no
   * children at all, and that is not a design failure.
   */
  protected childEntities(): readonly Entity<Identifier>[] {
    return [];
  }

  /**
   * Drains this root's events *and* those of its children, restoring causal
   * order via the sequence stamp.
   *
   * Without the sort, every child event would appear after every root event,
   * which would misreport what happened: a `CopyDamaged` recorded by a `Copy`
   * before the root recorded `TitleOutOfStock` must stay before it.
   */
  override pullDomainEvents(): readonly DomainEvent[] {
    // Re-entered through a cycle: the outer frame owns this node's buffer and
    // reports its events exactly once.
    if (this.#traversing) return [];
    this.#traversing = true;

    try {
      const ownEvents = super.pullDomainEvents();
      const childEvents = this.childEntities().flatMap((child) =>
        child.pullDomainEvents(),
      );

      return [...ownEvents, ...childEvents].sort(
        (a, b) => a.sequence - b.sequence,
      );
    } finally {
      this.#traversing = false;
    }
  }

  /**
   * Whether anything inside this boundary is waiting to be published.
   *
   * Overridden so that it agrees with {@link pullDomainEvents} about depth: the
   * inherited version reads only the root's own buffer, and would report `false`
   * for a root whose pending events were all recorded by a child.
   *
   * Unlike `pullDomainEvents`, this **peeks**. It is safe to ask any number of
   * times and answers the same thing each time.
   */
  override get hasPendingEvents(): boolean {
    if (super.hasPendingEvents) return true;

    if (this.#traversing) return false;
    this.#traversing = true;

    try {
      return this.childEntities().some((child) => child.hasPendingEvents);
    } finally {
      this.#traversing = false;
    }
  }

  /**
   * Route an event to the `@Handle` method that declares it, then record it.
   *
   * This is the event-sourced way to change state: the handler performs the
   * mutation, and the event that caused it is kept for publication. State and
   * history cannot drift apart, because one call produces both.
   *
   * Use {@link Entity.record} instead for an event that reports something
   * without changing this aggregate's own state.
   */
  protected apply(event: DomainEvent): void {
    this.assertInMutation("apply");
    this.#invokeHandler(event);
    this.record(event);
  }

  /**
   * Route an event to its handler **without** recording it.
   *
   * The distinction from {@link apply} is the whole of rehydration: replaying
   * history must rebuild state without re-publishing facts the world already
   * knows. An aggregate loaded from twenty events and then saved would
   * otherwise emit all twenty again.
   */
  protected replay(event: DomainEvent): void {
    // Rehydration is a mutation context in its own right, so a handler that
    // calls `set` is treated identically either way.
    this.runInMutation(() => this.#invokeHandler(event));
  }

  /** Replay a whole stream, in the order given. */
  protected replayAll(events: readonly DomainEvent[]): void {
    for (const event of events) this.replay(event);
  }

  /**
   * Rebuild an aggregate from its event stream.
   *
   * ```ts
   * const stock = BookStock.fromEvents(
   *   titleId,
   *   { title: "Dune", barcodes: [], copies: [] },
   *   await store.read(titleId),
   * );
   * ```
   *
   * `initialState` is the seed the stream is replayed *onto*. An event stream
   * says what changed, never what the empty shape was, so a handler like
   * `this.set("barcodes", [...this.get("barcodes"), ...])` needs an array to
   * append to before the first event arrives.
   *
   * It is a {@link RequiredState} for the same reason {@link Entity.create}'s is,
   * and the fit is if anything tighter here: the seed is *by definition* the
   * shape before anything happened, and an optional property is *by convention*
   * one that only happens later.
   *
   * Invariants are asserted once, when the stream has finished — never between
   * events, which would refuse valid histories.
   */
  // See `Entity.create`: the constraint names "some aggregate", and the precise
  // id and state come back through `IdOf`/`StateOf` on `This["prototype"]`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static fromEvents<This extends { prototype: AggregateRoot<any, any> }>(
    this: This,
    id: IdOf<This["prototype"]>,
    initialState: RequiredState<StateOf<This["prototype"]>>,
    events: readonly DomainEvent[],
  ): This["prototype"] {
    assertConcrete(this, "fromEvents");

    const aggregate = new (this as unknown as Newable<This["prototype"]>)(
      id,
      // See `Entity.create`: kept for the same reason, and unnecessary for the
      // same misleading one — `Newable` has already erased the parameter.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      initialState as StateOf<This["prototype"]>,
    );
    aggregate.replayAll(events);
    aggregate.assertInvariants();

    return aggregate;
  }

  /**
   * Find and call the method registered for this event's name.
   *
   * Both entry points throw when no handler is registered, rather than ignoring
   * the event: silence would mean an event recorded but never acted on, or an
   * aggregate rebuilt from a subset of its own history. Neither is detectable
   * later. An event you deliberately do not react to should be `record`ed, not
   * applied.
   */
  #invokeHandler(event: DomainEvent): void {
    const methodName = HandleRegistry.getHandlerName(
      // `this.constructor` is typed `Function`, which satisfies
      // `AggregateRootClass` structurally by accident. The assertion states the
      // intent — see ../../docs/handle-registry.md.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      this.constructor as AggregateRootClass,
      event.name,
    );

    if (methodName === undefined) {
      throw new Error(
        `${this.constructor.name} has no @Handle method for event '${event.name}'.\n` +
          `Register one, or use record() if this event should be published without changing state.`,
      );
    }

    const handler = (this as unknown as Record<string, unknown>)[methodName];

    if (typeof handler !== "function") {
      throw new Error(
        `${this.constructor.name}.${methodName} is registered for '${event.name}' but is not a method.`,
      );
    }

    (handler as (event: DomainEvent) => void).call(this, event);
  }

  /**
   * Assert every rule this aggregate is responsible for.
   *
   * Abstract on purpose: declaring an aggregate root is a claim that you are
   * protecting *something*, and this method is where you say what. An
   * implementation that is genuinely empty is a signal that the cluster may not
   * need to be an aggregate at all.
   *
   * Called for you by {@link Entity.mutate} when an operation returns, and by
   * {@link fromEvents} once a stream has finished replaying. You should not need
   * to call it by hand.
   */
  abstract override assertInvariants(): void;
}
