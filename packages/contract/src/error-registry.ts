import type { z } from "zod";

/** Users-service error codes are feature-namespaced: ROUTE_*, CHECKIN_*, SHARE_*. */
export type ErrorRegistryItem = {
  readonly status: number;
  readonly category: string;
  readonly message: string;
  readonly data: z.ZodType<unknown>;
};

type ErrorRegistry = Readonly<Record<string, ErrorRegistryItem>>;
type ErrorCode<Registry extends ErrorRegistry> = keyof Registry & string;
type PickedError<Registry extends ErrorRegistry, Code extends ErrorCode<Registry>> = Pick<
  Registry[Code],
  "status" | "message" | "data"
>;
type PickedErrors<Registry extends ErrorRegistry, Code extends ErrorCode<Registry>> = {
  [Key in Code]: PickedError<Registry, Key>;
};

function registryItem<Registry extends ErrorRegistry>(
  registry: Registry,
  code: ErrorCode<Registry>,
): ErrorRegistryItem {
  const item = registry[code];
  if (!item) throw new Error(`Unknown error code: ${code}`);
  return item;
}

/** Pick oRPC error entries while dropping registry-only category metadata. */
export function pickErrors<Registry extends ErrorRegistry, const Code extends ErrorCode<Registry>>(
  registry: Registry,
  codes: readonly Code[],
): PickedErrors<Registry, Code> {
  const entries = codes.map((code) => {
    const { status, message, data } = registryItem(registry, code);
    return [code, { status, message, data }] as const;
  });
  return Object.fromEntries(entries) as PickedErrors<Registry, Code>;
}
