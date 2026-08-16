// The reasoning behind this file — why `any`, why `{}`, why `set` is public,
// what `detach` does and does not copy — is in ./README.md.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type State = Record<string, any>;

/** Union of the keys of `T` that are NOT optional. */
export type RequiredKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * The subset of `S` made of its required properties only — the state an entity
 * may be **created** with. Creation may not supply an optional property;
 * behaviour fills those in later.
 */
export type RequiredState<S extends State = State> = Pick<S, RequiredKeys<S>>;

function detach<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }

  if (value !== null && typeof value === "object") {
    // Built-in containers, rebuilt with their own constructor. `===` and not
    // `instanceof`: a subclass would be rebuilt as its base and lose whatever
    // the subclass added, which is the lookalike problem this whole function
    // exists to avoid.
    if (value.constructor === Date) {
      return new Date((value as Date).getTime()) as T;
    }
    if (value.constructor === Map) {
      return new Map(value as Map<unknown, unknown>) as T;
    }
    if (value.constructor === Set) {
      return new Set(value as Set<unknown>) as T;
    }

    const proto = Object.getPrototypeOf(value) as object | null;
    if (proto === Object.prototype || proto === null) {
      return { ...(value as object) } as T;
    }
  }

  return value;
}

function detachAll<S extends State>(state: S): S {
  const copy = { ...state };
  for (const key of Object.keys(copy) as (keyof S)[]) {
    copy[key] = detach(copy[key]);
  }
  return copy;
}

export class StateManager<S extends State> {
  #state: S;

  constructor(initialState: S) {
    this.#state = detachAll(initialState);
  }

  get(): S;
  get<K extends keyof S>(key: K): S[K];
  get(key?: keyof S): S[keyof S] | S {
    if (key === undefined) {
      return detachAll(this.#state);
    }
    return detach(this.#state[key]);
  }

  set<K extends keyof S>(key: K, value: S[K]): void {
    this.#state[key] = detach(value);
  }

  restore(state: S): void {
    this.#state = detachAll(state);
  }
}
