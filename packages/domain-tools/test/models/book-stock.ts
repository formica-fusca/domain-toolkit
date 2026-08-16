import {
  AggregateRoot,
  Handle,
  Entity,
  Identifier,
  InvariantViolation,
  ValueObject,
} from "../../src/index.js";
import { Copy } from "./copy.js";
import { CopyAdded, ShelfRepainted } from "./domain-events.js";
export class Barcode extends ValueObject<{ value: string }> {
  constructor(value: string) {
    if (!value.startsWith("LIB-")) {
      Barcode.reject("barcode is library-issued", `got "${value}"`);
    }
    super({ value });
  }

  get value(): string {
    return this.props.value;
  }
}
export class TitleId extends Identifier {
  declare protected readonly _tag: "TitleId";

  constructor(value: string) {
    super(value);
  }
}

/**
 * `author` is the fixture for the **deferred** half of the `RequiredState`
 * convention, and it is deliberately the only optional property in the model.
 *
 * Being `?` means creation may not supply it — `RequiredState` excludes it — so
 * it can only arrive through {@link BookStock.attributeTo}. That pairing is the
 * convention in miniature: every `?` is a promise that behaviour exists to fill
 * it, and a `?` with no setter is a property nothing can ever write.
 *
 * A genuinely *sparse* attribute — one that may simply never have a value —
 * would be written `deletedAt: Date | null` instead: a required slot, supplied
 * at creation, holding nothing. `RequiredKeys` asks about the slot rather than
 * the value, which is what keeps the two cases apart.
 */
type BookStockState = {
  title: string;
  author?: string;
  barcodes: string[];
  copies: Copy[];
};

export class BookStock extends AggregateRoot<TitleId, BookStockState> {
  get barcodes(): readonly string[] {
    return this.get("barcodes");
  }

  get author(): string | undefined {
    return this.get("author");
  }

  /**
   * Fills in the deferred attribute. Without a method like this one, `author?`
   * would be unwritable: creation refuses it and nothing else offers it.
   */
  attributeTo(author: string): void {
    if (author.trim().length === 0) {
      throw new InvariantViolation(
        "an attributed author is named",
        "got a blank string",
      );
    }
    this.mutate(() => this.set("author", author));
  }

  addCopy(barcode: string): void {
    this.mutate(() => this.apply(new CopyAdded(barcode)));
  }

  adopt(copy: Copy): void {
    // Mutates through `set` and applies no event — the case a check hung off
    // `apply` would never have seen, and which previously checked nothing.
    this.mutate(() => this.set("copies", [...this.get("copies"), copy]));
  }

  /** Applies an event with no registered handler — expected to throw. */
  repaintShelf(): void {
    this.mutate(() => this.apply(new ShelfRepainted()));
  }

  @Handle(CopyAdded)
  protected onCopyAdded(event: CopyAdded): void {
    this.set("barcodes", [...this.get("barcodes"), event.barcode]);
  }

  protected override childEntities(): readonly Entity<Identifier>[] {
    return this.get("copies");
  }

  assertInvariants(): void {
    if (new Set(this.get("barcodes")).size !== this.get("barcodes").length) {
      throw new InvariantViolation(
        "barcodes are unique within a title",
        `got ${this.get("barcodes").join(", ")}`,
      );
    }
  }
}
