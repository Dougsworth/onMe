import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Logo } from "@/components/Logo";
import { radius, shadow, theme } from "@/constants/theme";
import { GOOGLE_CONFIGURED, sendMagicLink, useGoogleSignIn } from "@/lib/auth";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  // When Google isn't configured yet (no client IDs in env) the email flow
  // becomes the primary method — start with the email input expanded so the
  // user has something they can actually do.
  const [showEmail, setShowEmail] = useState(!GOOGLE_CONFIGURED);
  const google = useGoogleSignIn();

  useEffect(() => {
    if (google.error) Alert.alert("Couldn't sign in", google.error);
  }, [google.error]);

  const submit = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      Alert.alert("Check your email", "That doesn't look like a valid email.");
      return;
    }
    setBusy(true);
    try {
      await sendMagicLink(trimmed);
      setSent(true);
    } catch (err) {
      Alert.alert("Couldn't send", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={{ flex: 1, paddingHorizontal: 28, justifyContent: "center" }}>
            <Animated.View entering={FadeInDown.duration(280)} style={{ alignItems: "center", marginBottom: 36 }}>
              <Logo size="xl" />
            </Animated.View>

            {sent ? (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={{ color: theme.fg, fontSize: 26, fontWeight: "800", letterSpacing: -1, textAlign: "center" }}>
                  Check your email.
                </Text>
                <Text style={{ color: theme.fgSubtle, fontSize: 14, marginTop: 12, textAlign: "center", lineHeight: 20 }}>
                  We sent a magic link to{"\n"}
                  <Text style={{ color: theme.fg, fontWeight: "700" }}>{email}</Text>
                  {"\n\n"}Tap the link on this device to sign in.
                </Text>
                <Pressable
                  onPress={() => setSent(false)}
                  style={{ marginTop: 28, alignItems: "center" }}
                >
                  <Text style={{ color: theme.primary, fontSize: 13, fontWeight: "700" }}>
                    Use a different email
                  </Text>
                </Pressable>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={{ color: theme.primary, fontSize: 11, letterSpacing: 2.4, fontWeight: "800", textAlign: "center" }}>
                  WELCOME
                </Text>
                <Text
                  style={{
                    color: theme.fg,
                    fontSize: 28,
                    fontWeight: "800",
                    letterSpacing: -1.2,
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  Sign in to OnMe
                </Text>
                <Text
                  style={{
                    color: theme.fgSubtle,
                    fontSize: 14,
                    textAlign: "center",
                    marginTop: 10,
                    lineHeight: 20,
                  }}
                >
                  One tap and you're in.
                </Text>

                {/* Primary: Google. Only rendered when env client IDs are
                    set, otherwise email flow takes over. */}
                {GOOGLE_CONFIGURED && (
                  <Pressable
                    onPress={() => google.promptGoogle()}
                    disabled={!google.ready || google.busy}
                    style={({ pressed }) => ({
                      height: 56,
                      marginTop: 32,
                      borderRadius: radius.lg,
                      backgroundColor: "#fff",
                      borderWidth: 1.5,
                      borderColor: theme.border,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 12,
                      opacity: !google.ready || google.busy ? 0.6 : 1,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      ...shadow.soft,
                    })}
                  >
                    <Text style={{ fontSize: 18, fontWeight: "900", color: "#4285F4" }}>G</Text>
                    <Text style={{ color: theme.fg, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 }}>
                      {google.busy ? "Signing in…" : "Continue with Google"}
                    </Text>
                  </Pressable>
                )}

                {showEmail ? (
                  <Animated.View entering={FadeInDown.duration(180)}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 22 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                      <Text style={{ color: theme.muted, fontSize: 10, letterSpacing: 1.6, fontWeight: "800" }}>
                        OR
                      </Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                    </View>

                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="you@email.com"
                      placeholderTextColor={theme.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      returnKeyType="go"
                      onSubmitEditing={submit}
                      editable={!busy}
                      style={{
                        marginTop: 16,
                        backgroundColor: theme.bgElevated,
                        borderRadius: radius.lg,
                        paddingHorizontal: 18,
                        height: 56,
                        fontSize: 15,
                        color: theme.fg,
                        borderWidth: 1.5,
                        borderColor: theme.border,
                      }}
                    />

                    <Pressable
                      onPress={submit}
                      disabled={busy || !email.trim()}
                      style={({ pressed }) => ({
                        height: 56,
                        marginTop: 14,
                        borderRadius: radius.lg,
                        backgroundColor: email.trim() ? theme.primary : theme.primarySoft,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: busy ? 0.6 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                        ...(email.trim() ? shadow.card : {}),
                      })}
                    >
                      <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.4 }}>
                        {busy ? "Sending…" : "Send magic link"}
                      </Text>
                    </Pressable>
                  </Animated.View>
                ) : GOOGLE_CONFIGURED ? (
                  <Pressable
                    onPress={() => setShowEmail(true)}
                    hitSlop={10}
                    style={{ alignItems: "center", marginTop: 18, paddingVertical: 8 }}
                  >
                    <Text style={{ color: theme.fgSubtle, fontSize: 13, fontWeight: "700" }}>
                      Use email instead
                    </Text>
                  </Pressable>
                ) : null}

                <View style={{ marginTop: 28, alignItems: "center" }}>
                  <Text style={{ color: theme.muted, fontSize: 11, textAlign: "center", lineHeight: 17, paddingHorizontal: 12 }}>
                    By signing in you agree to our{" "}
                    <Link href="/legal/terms">
                      <Text style={{ color: theme.primary, fontWeight: "700" }}>Terms</Text>
                    </Link>
                    {" "}and{" "}
                    <Link href="/legal/privacy">
                      <Text style={{ color: theme.primary, fontWeight: "700" }}>Privacy Policy</Text>
                    </Link>
                    .
                  </Text>
                </View>
              </Animated.View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
