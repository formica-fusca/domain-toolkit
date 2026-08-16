import { AggregateRoot } from "../aggregate-root.js";
import { HandleRegistry } from "./handle-registry.js";
import type { AggregateRootClass } from "../types/aggregate-root-class.js";
import { DomainEventClass } from "./domain-event.js";

/**
 * Marks a method as the aggregate's reaction to one kind of event.
 *
 * ```ts
 * class BookStock extends AggregateRoot<TitleId> {
 *   @Handle(CopyCheckedOut)
 *   protected onCopyCheckedOut(event: CopyCheckedOut): void { ... }
 * }
 * ```
 *
 * Registration happens under `event.eventName` — the same string an instance
 * reports as its `name`, so {@link AggregateRoot.apply} can find this method
 * again from an event it holds.
 *
 * The decorator runs when the class is *defined*, not when it is instantiated,
 * so a missing `eventName` fails at import time rather than at dispatch.
 *
 * What breaks when registration keys on the class name instead:
 * ../../../docs/handle-decorator.md
 */
export function Handle(event: DomainEventClass) {
  return function (
    target: AggregateRoot,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const { eventName } = event;

    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new Error(
        `@Handle received ${event.name}, which declares no 'static readonly eventName'.\n` +
          `Add one so registration and dispatch agree, e.g. static readonly eventName = "context.${event.name}";`,
      );
    }

    HandleRegistry.registerHandler(
      // See `AggregateRoot.#invokeHandler`: `Function` satisfies
      // `AggregateRootClass` structurally by accident, so the assertion is
      // redundant to the compiler and load-bearing to the reader.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      target.constructor as AggregateRootClass,
      eventName,
      propertyKey,
    );

    return descriptor;
  };
}
