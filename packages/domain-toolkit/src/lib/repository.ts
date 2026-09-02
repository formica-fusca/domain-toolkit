import type { AggregateRoot } from "./aggregate-root.js";
import type { Identifier } from "./identifier.js";

/**
 * A Repository is a collection-like interface over **whole aggregates**.
 *
 * Two consequences that are easy to get wrong:
 *
 * - **One repository per aggregate root, never per entity.** There is no
 *   `CopyRepository` in this codebase, and adding one would destroy the
 *   `BookStock` boundary: it would let a caller fetch a single copy, mutate it,
 *   and save it without the root ever recomputing its counters.
 * - **It belongs to the domain layer, its implementation does not.** The
 *   interface is stated here in the language of the model; the Map-backed or
 *   SQL-backed implementation lives in `infrastructure/`. This is the
 *   Dependency Inversion Principle doing the real work in a DDD codebase.
 */
export interface Repository<
  TAggregate extends AggregateRoot<TId>,
  TId extends Identifier,
> {
  findById(id: TId): Promise<TAggregate | undefined>;
  save(aggregate: TAggregate): Promise<void>;
}
