import type { AggregateRoot } from "../aggregate-root.js";

/**
 * How the registry and the decorator refer to an aggregate *class*.
 *
 * Deliberately not `Newable<AggregateRoot>`: nothing on this path ever
 * constructs anything, and a construct signature would exclude *every*
 * aggregate this library can produce. Reading `prototype` asks the same "is this
 * an aggregate class?" question without that cost.
 *
 * Why, in full: ../../../docs/handle-registry.md
 */
export type AggregateRootClass = {
  prototype: AggregateRoot<any, any>;
  name: string;
};
