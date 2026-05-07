import * as Sentry from "@sentry/react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-gesture-handler";
import { useAuthDeepLink, useAuthState } from "@/lib/auth";
import { theme } from "@/constants/theme";

// Init Sentry only when DSN is configured. Leaving DSN empty in dev keeps
// Sentry out of the way; production builds (EAS) should always set this.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Trace sampling — 0.1 keeps cost reasonable, bump in early production
    // until you've shaken out perf issues, then dial back.
    tracesSampleRate: 0.1,
    // Don't capture unhandled errors during dev — let them surface in the
    // RN red-screen so we actually see them while iterating.
    enabled: !__DEV__,
  });
}

// Routes that don't require an authenticated session. Anything not in this
// set redirects to /sign-in until the user has a Supabase session.
const PUBLIC_ROUTES = new Set(["sign-in", "legal"]);

function AuthGate() {
  // Capture incoming magic-link callbacks and convert them into a session.
  // Without this, tapping the email link opens the app but auth state stays
  // empty and the user gets bounced back to /sign-in.
  useAuthDeepLink();
  const auth = useAuthState();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!auth.ready) return;
    const top = segments[0] ?? "";
    const isPublic = PUBLIC_ROUTES.has(top);
    if (!auth.userId && !isPublic) {
      router.replace("/sign-in");
    } else if (auth.userId && top === "sign-in") {
      router.replace("/feed");
    }
  }, [auth.ready, auth.userId, segments, router]);

  // Hold a blank screen until the initial session check resolves so we
  // don't flash the wrong screen during the redirect.
  if (!auth.ready) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        animation: "fade",
        animationDuration: 180,
      }}
    />
  );
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthGate />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

// Only wrap with Sentry when DSN is set. Calling Sentry.wrap without an
// init logs a warning and creates a useless app-start span; gating here
// keeps the dev console clean when Sentry isn't configured yet.
export default SENTRY_DSN ? Sentry.wrap(RootLayout) : RootLayout;
