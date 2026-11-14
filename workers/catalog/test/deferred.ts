/** A promise and the function that settles it: a test waits on an event instead of on time. */
export function deferred(): { promise: Promise<void>; settle: () => void } {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { settle = resolve; });
  return { promise, settle };
}
