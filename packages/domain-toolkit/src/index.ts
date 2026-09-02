export { AggregateRoot } from "./lib/aggregate-root.js";
export { Entity } from "./lib/entity.js";
export type { IdOf, StateOf } from "./lib/entity.js";
// Re-exported, not re-declared. `@domain-toolkit/state` is private and bundled
// into this package's `dist` at build time, so these three names must reach
// consumers from here or not at all.
export type { State, RequiredKeys, RequiredState } from "@domain-toolkit/state";
export { Identifier } from "./lib/identifier.js";
export { ValueObject } from "./lib/value-object.js";
export type { Repository } from "./lib/repository.js";
export type { Usecase } from "./lib/types/usecase.js";
export type { Newable } from "./lib/types/newable.js";
export {
  DomainError,
  IllegalStateTransition,
  InvariantViolation,
  NotFoundInAggregate,
} from "./lib/errors.js";
export { DomainEvent } from "./lib/event-sourcing/domain-event.js";
export type {
  DomainEventName,
  DomainEventClass,
} from "./lib/event-sourcing/domain-event.js";
export { Handle } from "./lib/event-sourcing/handle-decorator.js";
export { HandleRegistry } from "./lib/event-sourcing/handle-registry.js";
export type { HandleHandler } from "./lib/types/handle-handler.js";
export type { AggregateRootClass } from "./lib/types/aggregate-root-class.js";
