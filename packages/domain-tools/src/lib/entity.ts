import type { DomainEvent } from "./event-sourcing/domain-event.js";
import type { Identifier } from "./identifier.js";
import type { Newable } from "./types/newable.js";
import { State, StateManager } from "@domain-tools/state";
import type { RequiredState } from "@domain-tools/state";

// The reasoning behind this file — why an entity holds a StateManager rather
// than extending one, what the `this` parameter and the `prototype` constraint
// on `create` are doing, why `mutate` wraps the operation and not the event —
// is in ../../docs/entity.md.

/**
 * The identifier type a concrete Entity is keyed by — `IdOf<BookStock>` is
 * `TitleId`.
 */
// The `any` is the *unasked* parameter of a two-parameter conditional; see the
// docs. `unknown` there collapses both aliases to `never`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IdOf<E> = E extends Entity<infer TId, any> ? TId : never;

/** The state shape a concrete Entity manages — `StateOf<BookStock>` is `BookStockState`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StateOf<E> = E extends Entity<any, infer S> ? S : never;

/**
 * An Entity is a domain object defined by **who it is**, not by **what it
 * holds**.
 *
 * Its attributes change over their lifetime — a copy of a book gets rebound,
 * relabelled, moved to another shelf — and it remains the same copy throughout.
 * That thread of continuity *is* the entity. Equality therefore compares
 * identity and nothing else.
 *
 * ## Entities record events; they do not publish them
 *
 * Every Entity can `record()` a domain event into a private buffer. Nothing
 * else. There is no bus here, no publish method, no way out.
 *
 * The only exit is {@link AggregateRoot.pullDomainEvents}, which drains this
 * buffer along with those of every child entity the root declares. A child
 * entity that records an event and is *not* reachable from its root's
 * `childEntities()` will simply never have that event dispatched — silently.
 *
 * An entity may *describe* what happened to it, because it is the only object
 * that knows; but the aggregate root decides what leaves the boundary, because
 * it is the only object that knows whether the change was consistent.
 */
export abstract class Entity<
  TId extends Identifier,
  EntityState extends State = State,
> {
  readonly #recordedEvents: DomainEvent[] = [];

  /** The attribute bag, held rather than inherited. */
  readonly #state: StateManager<EntityState>;

  readonly id: TId;

  /**
   * Marks a class that exists to be extended and never to be instantiated.
   *
   * `abstract` alone cannot do this job: it is erased at emit, and the `this`
   * constraint on {@link create} is satisfied by the abstract base itself. The
   * check is `Object.hasOwn`, so only the class that declares this field for
   * itself is a base — which also makes the marker available to model authors,
   * for an abstract intermediate of your own.
   */
  protected static readonly abstractBase: boolean = true;

  /**
   * Build an entity of **the class this was called on**.
   *
   * ```ts
   * const stock = BookStock.create(new TitleId("dune"), {
   *   title: "Dune",
   *   barcodes: [],
   *   copies: [],
   * }); // : BookStock
   * ```
   *
   * Creation takes the entity's **required** properties only. Supplying an
   * optional one does not compile:
   *
   * ```ts
   * BookStock.create(id, { title: "Dune", barcodes: [], copies: [] });          // ok
   * BookStock.create(id, { title: "Dune", barcodes: [], copies: [],
   *                        author: "Herbert" });                               // TS2353
   * ```
   *
   * That refusal is the point: an entity begins life holding exactly what it
   * cannot exist without, and everything else arrives through behaviour that
   * means something in the domain. Read {@link RequiredState} for the
   * `?`-means-deferred convention this depends on.
   */
  // `Entity<any, any>` is the constraint's way of saying "some entity, and the
  // call site will tell us which" — the real id and state are recovered below
  // through `IdOf`/`StateOf` on `This["prototype"]`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static create<This extends { prototype: Entity<any, any> }>(
    this: This,
    id: IdOf<This["prototype"]>,
    initialState: RequiredState<StateOf<This["prototype"]>>,
  ): This["prototype"] {
    assertConcrete(this, "create");

    return new (this as unknown as Newable<This["prototype"]>)(
      id,
      // Kept deliberately, against the linter: it reads as unnecessary only
      // because `Newable` erases the parameter to `any[]`. See the docs.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      initialState as StateOf<This["prototype"]>,
    );
  }

  protected constructor(id: TId, state: EntityState) {
    this.id = id;
    this.#state = new StateManager<EntityState>(state);
  }

  /**
   * Read state, either whole or one property at a time.
   *
   * Reading is not a write channel: the value handed back is detached from the
   * state, so mutating it reaches nothing. The copy is one level deep — see
   * `@domain-tools/state` for that boundary and its one deliberate limit.
   */
  get(): EntityState;
  get<K extends keyof EntityState>(key: K): EntityState[K];
  get(key?: keyof EntityState): EntityState[keyof EntityState] | EntityState {
    return key === undefined ? this.#state.get() : this.#state.get(key);
  }

  /**
   * Write one property. `protected`, so state changes belong to the entity's
   * own behaviour and mean something in the domain.
   */
  protected set<K extends keyof EntityState>(
    key: K,
    value: EntityState[K],
  ): void {
    this.assertInMutation("set");
    this.#state.set(key, value);
  }

  /**
   * How many mutation contexts are open on this entity right now.
   *
   * A depth rather than a boolean, because operations nest.
   */
  #mutationDepth = 0;

  /**
   * Open a mutation context for the duration of `operation`.
   *
   * Separate from {@link mutate} because rehydration needs the context without
   * the invariant check: `AggregateRoot.replay` reaches `set` through its
   * handlers, and a per-event assertion would reject valid histories.
   */
  protected runInMutation<T>(operation: () => T): T {
    this.#mutationDepth++;
    try {
      return operation();
    } finally {
      this.#mutationDepth--;
    }
  }

  /**
   * Refuse a state change made outside a domain operation.
   *
   * This is what makes {@link mutate} mandatory rather than a convention: a
   * change made outside an operation is one nothing will check and nothing can
   * roll back.
   */
  protected assertInMutation(method: string): void {
    if (this.#mutationDepth > 0) return;

    throw new Error(
      `${this.constructor.name}.${method}() was called outside a domain operation.\n` +
        `Wrap the mutating method's body in this.mutate(() => { ... }), which asserts ` +
        `invariants when the operation returns and rolls the whole operation back if ` +
        `they do not hold.`,
    );
  }

  /**
   * Run one domain **operation** atomically: either it completes with this
   * object's invariants intact, or nothing about it happened.
   *
   * ```ts
   * addCopy(barcode: string): void {
   *   this.mutate(() => this.apply(new CopyAdded(barcode)));
   * }
   * ```
   *
   * On the way out it calls {@link assertInvariants}. If that throws — or if the
   * operation itself throws — the state is restored and every event the
   * operation recorded is discarded, so a caller who catches the error is
   * telling the truth when they assume nothing happened.
   *
   * One limit, pinned by a test: rollback covers this object's own state and
   * event buffer, and does **not** rewind events recorded by *child* entities
   * during the operation. Their buffers are `#private` to each `Entity`.
   */
  protected mutate(operation: () => void): void {
    const stateBefore = this.snapshotState();
    const eventMark = this.markEvents();

    try {
      this.runInMutation(operation);
      this.assertInvariants();
    } catch (error) {
      this.restoreState(stateBefore);
      this.rewindEvents(eventMark);
      throw error;
    }
  }

  /**
   * Assert every rule this object is responsible for.
   *
   * A no-op here, and `abstract` on `AggregateRoot`. An entity that is not an
   * aggregate root has no invariants of its own — the rules that span a cluster
   * belong to the root that owns the boundary — but {@link mutate} lives on this
   * class and needs something to call.
   */
  assertInvariants(): void {}

  /**
   * Identity equality. Note what is *not* compared: none of the attributes.
   * Two `Copy` instances loaded separately from the repository, one of them
   * stale, are still the same copy.
   */
  equals(other: Entity<Identifier> | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;
    return this.id.equals(other.id);
  }

  /**
   * Append an event to this entity's private buffer.
   *
   * `protected` on purpose: only the entity's own behaviour may record what
   * happened to it. Application services cannot fabricate history from outside.
   */
  protected record(event: DomainEvent): void {
    this.#recordedEvents.push(event);
  }

  /**
   * Drain the buffer. Called by the aggregate root — see the class comment.
   *
   * Draining rather than copying is deliberate: an event must be dispatched
   * exactly once. If a root is saved twice, the second save must not replay
   * history.
   */
  pullDomainEvents(): readonly DomainEvent[] {
    const drained = [...this.#recordedEvents];
    this.#recordedEvents.length = 0;
    return drained;
  }

  get hasPendingEvents(): boolean {
    return this.#recordedEvents.length > 0;
  }

  /**
   * Take a restorable copy of this entity's state, detached on the way out so
   * it does not change under the operation it is protecting.
   *
   * `protected` and deliberately not part of the public surface: this exists for
   * {@link Entity.mutate}, not for callers to take savepoints with.
   */
  protected snapshotState(): EntityState {
    return this.#state.get();
  }

  /** Put back a snapshot taken by {@link snapshotState}. */
  protected restoreState(state: EntityState): void {
    this.#state.restore(state);
  }

  /** How many events this entity has buffered — a mark to rewind to. */
  protected markEvents(): number {
    return this.#recordedEvents.length;
  }

  /** Discard every event recorded since {@link markEvents} returned `mark`. */
  protected rewindEvents(mark: number): void {
    this.#recordedEvents.length = mark;
  }
}

/**
 * Refuse to build an instance of a class that only exists to be extended.
 *
 * Shared by {@link Entity.create} and `AggregateRoot.fromEvents`, both of which
 * are reachable on the abstract bases themselves.
 *
 * `Object.hasOwn` is doing the real work — see {@link Entity.abstractBase}.
 */
export function assertConcrete(target: unknown, method: string): void {
  if (typeof target !== "function" || !Object.hasOwn(target, "abstractBase")) {
    return;
  }

  throw new Error(
    `${(target as { name: string }).name}.${method}() must be called on a concrete subclass.\n` +
      `${(target as { name: string }).name} exists to be extended — building one directly ` +
      `produces an object with none of the behaviour its abstract members promise.`,
  );
}
