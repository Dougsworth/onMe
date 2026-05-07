import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

WebBrowser.maybeCompleteAuthSession();

// Magic-link redirect target. Configured in Supabase Dashboard →
// Authentication → URL Configuration → Redirect URLs:
//   onme://auth/callback
//   exp://* (for Expo Go dev — see Supabase docs)
export const AUTH_REDIRECT = Linking.createURL("/auth/callback");

export interface AuthState {
  ready: boolean;
  userId: string | null;
  email: string | null;
}

// Hook used by the root layout to gate routes behind a session. Returns
// { ready: false } until the initial getSession() resolves so we don't
// flash the sign-in screen before we know the actual auth state.
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({
    ready: false,
    userId: null,
    email: null,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setState({ ready: true, userId: u?.id ?? null, email: u?.email ?? null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setState({ ready: true, userId: u?.id ?? null, email: u?.email ?? null });
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: AUTH_REDIRECT },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Resolves the auth callback URL into a Supabase session. Supabase emits
// magic-link emails in two formats depending on project age:
//   • Newer projects: ...?token_hash=...&type=magiclink&next=/  (PKCE-ish)
//   • Older projects: ...#access_token=...&refresh_token=...&type=magiclink
// We handle both, so the app signs the user in regardless of which format
// the project is configured for. detectSessionInUrl is intentionally OFF
// in the supabase client (no `window` in RN); this hook does that job.
async function consumeAuthCallback(url: string): Promise<boolean> {
  if (!url.includes("/auth/callback")) return false;

  // Format A — token_hash query param.
  const parsed = Linking.parse(url);
  const tokenHash = parsed.queryParams?.token_hash as string | undefined;
  const type = parsed.queryParams?.type as EmailOtpType | undefined;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) console.warn("[auth] verifyOtp failed:", error.message);
    return !error;
  }

  // Format B — tokens in URL fragment.
  const fragment = url.split("#")[1];
  if (fragment) {
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) console.warn("[auth] setSession failed:", error.message);
      return !error;
    }
  }

  return false;
}

// Truthy when the Google client ID is set. We treat any of the three as
// "configured" for backward compat — the actual OAuth happens via
// Supabase's hosted flow now, which only needs Supabase + Google to be
// set up; the env var is just a flag for "should we show the button?".
const WEB_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

export const GOOGLE_CONFIGURED = !!WEB_ID || !!IOS_ID || !!ANDROID_ID;

// Google Sign-In via Supabase's hosted OAuth flow.
// Why this and not expo-auth-session/providers/google? The expo-auth-session
// approach needs Expo's proxy (auth.expo.io) for Expo Go testing, but Expo
// deprecated that proxy in SDK 50 — its response forwarding is broken now.
// The Supabase-hosted flow sidesteps the proxy entirely:
//   1. Ask Supabase for an OAuth URL (it knows where to send Google).
//   2. Open that URL in WebBrowser.openAuthSessionAsync — iOS/Android
//      track the redirect target so we know when the flow completes.
//   3. Google → Supabase callback → onme://auth/callback?code=<pkce>
//   4. Supabase JS exchanges the code for a session via
//      exchangeCodeForSession, AsyncStorage persists it.
//
// The only Google config needed is the existing
// https://<project>.supabase.co/auth/v1/callback redirect URI — already
// registered. No Expo username, no proxy, works in Expo Go and EAS builds.
export function useGoogleSignIn(): {
  promptGoogle: () => Promise<void>;
  ready: boolean;
  busy: boolean;
  error: string | null;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptGoogle = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      // Use the app's own custom scheme rather than Linking.createURL, which
      // in Expo Go returns an exp://192.168.x.x URL that iOS's
      // ASWebAuthenticationSession can't reliably match (it expects a
      // scheme registered in the binary). Expo Go auto-registers `onme://`
      // because we declared `scheme: "onme"` in app.json, so this works
      // identically in dev and EAS production.
      const redirectTo = "onme://auth/callback";
      const { data, error: e } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          // We open the browser ourselves so the in-app session and
          // redirect detection are under our control — without this,
          // supabase-js attempts a window.location redirect that doesn't
          // exist on RN.
          skipBrowserRedirect: true,
        },
      });
      if (e) throw e;
      if (!data?.url) throw new Error("Supabase returned no OAuth URL");

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === "success" && result.url) {
        const callbackUrl = result.url;

        // PKCE flow: redirect comes back as ...?code=<pkce>
        const queryStr = callbackUrl.split("?")[1]?.split("#")[0] ?? "";
        const code = new URLSearchParams(queryStr).get("code");
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
        } else {
          // Implicit flow: tokens come back in the URL fragment, e.g.
          // ...#access_token=...&refresh_token=...&token_type=bearer
          // The WebBrowser session intercepts the redirect so the deep
          // link handler can't see it — we have to parse it ourselves.
          const fragment = callbackUrl.split("#")[1];
          if (fragment) {
            const params = new URLSearchParams(fragment);
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");
            if (accessToken && refreshToken) {
              const { error: ssErr } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (ssErr) throw ssErr;
            } else {
              console.warn("[google] callback URL had no code or tokens:", callbackUrl);
              setError("Couldn't read sign-in response — try again.");
            }
          } else {
            console.warn("[google] callback URL had no fragment or query:", callbackUrl);
            setError("Couldn't read sign-in response — try again.");
          }
        }
      } else if (result.type === "cancel" || result.type === "dismiss") {
        // User backed out — nothing to do.
      } else if (result.type === "locked") {
        setError("Sign-in is already in progress");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    promptGoogle,
    ready: GOOGLE_CONFIGURED,
    busy,
    error,
  };
}

// Hook that listens for incoming deep links and turns the magic-link
// callback URL into a session. Call once at the app root. Idempotent.
export function useAuthDeepLink(): void {
  useEffect(() => {
    // Cold-start case: app was launched by tapping the email link.
    Linking.getInitialURL().then((url) => {
      if (url) void consumeAuthCallback(url);
    });
    // Warm case: link was tapped while the app was already running.
    const sub = Linking.addEventListener("url", ({ url }) => {
      void consumeAuthCallback(url);
    });
    return () => sub.remove();
  }, []);
}
