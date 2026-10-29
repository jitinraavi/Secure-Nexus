export type AuthenticationStatus = "checking" | "authenticated" | "unauthenticated" | "unavailable";

export type SessionVerification<T> =
  | { status: "authenticated"; account: T }
  | { status: "unauthenticated"; account: null }
  | { status: "unavailable"; error: unknown };

/** Only a confirmed signed-out response can clear an account. Transport errors cannot. */
export async function verifySession<T>(
  bootstrap: () => Promise<unknown>,
  currentAccount: () => Promise<T | null>,
): Promise<SessionVerification<T>> {
  try {
    await bootstrap();
    const account = await currentAccount();
    return account === null
      ? { status: "unauthenticated", account: null }
      : { status: "authenticated", account };
  } catch (error) {
    return { status: "unavailable", error };
  }
}
