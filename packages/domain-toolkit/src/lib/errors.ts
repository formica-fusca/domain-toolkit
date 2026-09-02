/**
 * Errors that belong to the *domain*, not to the plumbing.
 *
 * The distinction matters. A `DomainError` means "the business refuses this" —
 * it is a legitimate, expected outcome that the ubiquitous language has a word
 * for. A `TypeError` means "the programmer made a mistake". Never conflate them:
 * the first is part of the model and should be readable by a domain expert; the
 * second is a bug.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Thrown when an operation would leave an aggregate in a state its own rules
 * forbid.
 *
 * The `invariant` field names the rule in the ubiquitous language, so the
 * failure reads like a sentence a librarian would say, not like a stack trace.
 */
export class InvariantViolation extends DomainError {
  readonly invariant: string;

  constructor(invariant: string, explanation: string) {
    super(`invariant "${invariant}" violated — ${explanation}`);
    this.invariant = invariant;
  }
}

/**
 * A specialised invariant violation for entities whose lifecycle is a state
 * machine. Kept distinct because it is by far the most common shape of rule in
 * this domain: a physical copy of a book moves through legal states only.
 */
export class IllegalStateTransition extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(subject: string, from: string, to: string) {
    super(`${subject} cannot move from "${from}" to "${to}"`);
    this.from = from;
    this.to = to;
  }
}

/**
 * Thrown when a caller asks for something the aggregate does not contain.
 * Distinct from an invariant violation: nothing is broken, the request is
 * simply about something that does not exist.
 */
export class NotFoundInAggregate extends DomainError {
  constructor(what: string, id: string) {
    super(`${what} "${id}" is not part of this aggregate`);
  }
}
