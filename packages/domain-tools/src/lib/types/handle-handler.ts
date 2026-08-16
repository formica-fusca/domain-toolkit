/**
 * Maps event names to their handler method names.
 *
 * Key: the event's `static readonly eventName`, namespaced by bounded context —
 * *not* the class name. Value: the handler method name.
 *
 * @example
 * {
 *   'library.CopyAdded': 'onCopyAdded',
 *   'library.CopyDamaged': 'onCopyDamaged'
 * }
 */
export type HandleHandler = Record<string, string>;
