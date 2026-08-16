import { DomainEvent } from "../../src/lib/event-sourcing/domain-event.js";

export class CopyAdded extends DomainEvent {
  static readonly eventName = "library.CopyAdded";

  constructor(readonly barcode: string) {
    super();
  }

  payload(): Record<string, string> {
    return { barcode: this.barcode };
  }
}

export class CopyDamaged extends DomainEvent {
  static readonly eventName = "library.CopyDamaged";

  constructor(readonly copyId: string) {
    super();
  }

  payload(): Record<string, string> {
    return { copyId: this.copyId };
  }
}

export class MemberJoined extends DomainEvent {
  static readonly eventName = "library.MemberJoined";

  // Not `name`: `DomainEvent.name` is an accessor carrying the event's own
  // dispatch key, and a payload field would shadow it.
  constructor(readonly memberName: string) {
    super();
  }

  payload(): Record<string, string> {
    return { memberName: this.memberName };
  }
}

/** An event no aggregate reacts to — used to test the unhandled path. */
export class ShelfRepainted extends DomainEvent {
  static readonly eventName = "library.ShelfRepainted";

  // `DomainEvent`'s constructor is protected, so even an event carrying no
  // data must redeclare one to be constructible outside its own class body.
  constructor() {
    super();
  }

  payload(): Record<string, string> {
    return {};
  }
}

/** An event whose author forgot `eventName`. */
export class Nameless extends DomainEvent {
  constructor() {
    super();
  }

  payload(): Record<string, string> {
    return {};
  }
}
