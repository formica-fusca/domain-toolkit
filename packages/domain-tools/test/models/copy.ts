import { Identifier } from "../../src/index.js";
import { Entity } from "../../src/lib/entity.js";
import { CopyDamaged } from "./domain-events.js";

export class CopyId extends Identifier {
  declare protected readonly _tag: "CopyId";

  constructor(value: string) {
    super(value);
  }
}

export class Copy extends Entity<CopyId, { damaged: boolean }> {
  static override create(id: CopyId): Copy {
    return new Copy(id, { damaged: false });
  }

  damage(): void {
    this.record(new CopyDamaged(this.id.value));
  }
}
