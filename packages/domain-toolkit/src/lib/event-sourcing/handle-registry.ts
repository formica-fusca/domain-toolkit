import { HandleHandler } from "../types/handle-handler.js";
import type { AggregateRootClass } from "../types/aggregate-root-class.js";

// Why this is a module-scoped `WeakMap` and not `reflect-metadata`, and what
// the prototype walk below is replacing, is in ../../../docs/handle-registry.md.

/**
 * Where `@Handle` stores its event-to-method map.
 *
 * Module-scoped, so a registration cannot be forged from outside. `WeakMap`
 * rather than `Map` so that a constructor which is itself garbage — a class
 * defined inside a test, say — does not keep its handler map alive.
 */
const registry = new WeakMap<AggregateRootClass, HandleHandler>();

export class HandleRegistry {
  /**
   * The handler map for this aggregate, inherited from an ancestor if this
   * class declares none of its own.
   *
   * The walk works because for `class Sub extends Base`,
   * `Object.getPrototypeOf(Sub)` *is* `Base` — the constructor chain mirrors the
   * inheritance chain.
   *
   * Note it returns the first map found rather than merging the chain. Merging
   * happens at registration time instead, so a subclass that registers anything
   * inherits a copy of its parent's entries.
   */
  static getMetadata(target: AggregateRootClass): HandleHandler | undefined {
    let current: object | null = target;

    while (current !== null) {
      const found = registry.get(current as AggregateRootClass);
      if (found !== undefined) return found;
      // `getPrototypeOf` is typed `any`, and `current` is the loop's own guard
      // condition — an unchecked `any` here would silently defeat the
      // `!== null` test that terminates the walk.
      current = Object.getPrototypeOf(current) as object | null;
    }

    return undefined;
  }

  static getHandlerName(
    target: AggregateRootClass,
    eventName: string,
  ): string | undefined {
    const handlers = this.getMetadata(target);
    return handlers?.[eventName];
  }

  static registerHandler(
    target: AggregateRootClass,
    eventName: string,
    handlerName: string,
  ): void {
    const existing = this.getMetadata(target) ?? {};

    if (existing[eventName]) {
      throw new Error(
        `Event '${eventName}' is already handled by '${existing[eventName]}' in ${target.name}.\nCannot register '${handlerName}' as a second handler.`,
      );
    }

    registry.set(target, {
      ...existing,
      [eventName]: handlerName,
    });
  }
}
