export type AuthStatus = "pending" | "authenticated" | "anonymous";

export function fetchAuthStatus(): Promise<AuthStatus> {
  return Promise.resolve("anonymous");
}

export function useAuthStatus(): AuthStatus {
  return "anonymous";
}
