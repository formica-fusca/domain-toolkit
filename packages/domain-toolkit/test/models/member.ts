import {
  AggregateRoot,
  Handle,
  Identifier,
  InvariantViolation,
} from "../../src/index.js";
import { MemberJoined } from "./domain-events.js";

export class MemberId extends Identifier {
  declare protected readonly _tag: "MemberId";

  constructor(value: string) {
    super(value);
  }
}

/**
 * An aggregate that is a single entity: it never overrides `childEntities()`.
 *
 * Its presence in the model is the point — the base class must work for a root
 * with no cluster around it, which is the majority of aggregates in a real
 * model and not a design failure.
 */
export class Member extends AggregateRoot<MemberId, { name: string }> {
  get name(): string {
    return this.get("name");
  }

  join(name: string): void {
    this.mutate(() => this.apply(new MemberJoined(name)));
  }

  @Handle(MemberJoined)
  protected onMemberJoined(event: MemberJoined): void {
    this.set("name", event.memberName);
  }

  assertInvariants(): void {
    // Stated so that it is also true of a member who has not joined yet, rather
    // than only after a mutation.
    if (this.get("name").trim().length === 0) {
      throw new InvariantViolation(
        "a joined member has a name",
        "got a blank string",
      );
    }
  }
}
