/** A session's keyspace: its name, or, for the shared-key negative control, the part before `~` ("shared~a", "shared~b"). */
export const keyOf = (name: string): string => name.split("~")[0] ?? name;
