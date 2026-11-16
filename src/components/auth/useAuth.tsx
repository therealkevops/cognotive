"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TokenResponse } from "@/app/api/auth/token/route";

export type AuthState =
  | { status: "loading" }
  | { status: "signed_in"; user: TokenResponse["user"]; installUrl: string | null }
  | { status: "signed_out" }
  | { status: "not_configured" }
  | { status: "offline" };

export class AuthRequiredError extends Error {
  constructor() {
    super("Sign in with GitHub to sync this repository.");
  }
}

export interface AuthApi {
  state: AuthState;
  /** A valid GitHub token, refreshed as needed. Throws AuthRequiredError when signed out. */
  getToken(): Promise<string>;
  signIn(): void;
  signOut(): Promise<void>;
  /** Re-checks the session (e.g. after coming back online). */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const a = useContext(AuthContext);
  if (!a) throw new Error("useAuth must be used inside <AuthProvider>");
  return a;
}

/** Ask for a fresh token this long before the cached one expires. */
const EARLY_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const cached = useRef<TokenResponse | null>(null);
  const inflight = useRef<Promise<TokenResponse | null> | null>(null);

  /** Asks the server for a token: one request at a time, cached until near expiry. */
  const fetchToken = useCallback(async (): Promise<TokenResponse | null> => {
    if (cached.current && cached.current.expiresAt - Date.now() > EARLY_MS) return cached.current;
    inflight.current ??= (async () => {
      try {
        const res = await fetch("/api/auth/token", { cache: "no-store" });
        if (!res.ok) {
          cached.current = null;
          setState({ status: "signed_out" });
          return null;
        }
        const body = (await res.json()) as TokenResponse | { configured: false };
        if ("configured" in body) {
          setState({ status: "not_configured" });
          return null;
        }
        cached.current = body;
        setState({ status: "signed_in", user: body.user, installUrl: body.installUrl });
        return body;
      } catch {
        setState({ status: "offline" });
        return null;
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  useEffect(() => {
    // Check the session once on load. Runs after mount, never during server rendering.
    void fetchToken();
  }, [fetchToken]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    cached.current = null;
    setState({ status: "signed_out" });
  }, []);

  const refresh = useCallback(async () => {
    cached.current = null;
    await fetchToken();
  }, [fetchToken]);

  const getToken = useCallback(async () => {
    const t = await fetchToken();
    if (!t) throw new AuthRequiredError();
    return t.token;
  }, [fetchToken]);

  const api = useMemo<AuthApi>(
    () => ({
      state,
      getToken,
      signIn() {
        // A full page load: the route handler redirects to GitHub.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/api/auth/login";
      },
      signOut,
      refresh,
    }),
    [state, getToken, signOut, refresh],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}
