type Branch<T> = Readonly<{
  server: (serverFn: T) => Readonly<{ client: (clientFn: T) => T }>;
}>;

export function createIsomorphicFn<T extends (...args: never[]) => unknown>(): Branch<T> {
  return { server: () => ({ client: (clientFn) => clientFn }) };
}

export function getRequestUrl(): URL {
  return new URL(window.location.href);
}
