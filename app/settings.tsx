import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { radius, shadow, theme } from "@/constants/theme";
import { signOut, useAuthState } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

const BUCKET = "selfies";

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuthState();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/sign-in");
  };

  // Wipes everything tied to this user: every selfie under their prefix in
  // the storage bucket, every AsyncStorage entry, and the auth session.
  // RLS at the Supabase level should ensure we cannot delete other users'
  // files even if the path is forged.
  const handleDeleteAccount = async () => {
    if (!auth.userId) return;
    Alert.alert(
      "Delete your account?",
      "This permanently removes your photos, try-on history, and bag. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              // 1. List + delete every selfie under <user_id>/
              const { data: files, error: listErr } = await supabase.storage
                .from(BUCKET)
                .list(auth.userId!, { limit: 1000 });
              if (listErr) {
                console.warn("[delete] list failed:", listErr.message);
              } else if (files && files.length > 0) {
                const paths = files.map((f) => `${auth.userId}/${f.name}`);
                const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
                if (rmErr) console.warn("[delete] remove failed:", rmErr.message);
              }

              // 2. Wipe local storage (bag, tryons, body photos, cops, stats).
              await AsyncStorage.clear();

              // 3. Sign out — clears the Supabase session token.
              await signOut();

              router.replace("/sign-in");
            } catch (err) {
              Alert.alert(
                "Couldn't fully delete",
                err instanceof Error ? err.message : "Try again or contact support.",
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Background>
      <SafeAreaView style={{ flex: 1 }}>
        <Header onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 36 }}>
          <Animated.View entering={FadeInDown.duration(280)}>
            <Text style={{ color: theme.primary, fontSize: 11, letterSpacing: 2.4, fontWeight: "800" }}>
              ACCOUNT
            </Text>
            <Text style={{ color: theme.fg, fontSize: 30, fontWeight: "800", letterSpacing: -1.2, marginTop: 6 }}>
              Settings
            </Text>
            {auth.email && (
              <Text style={{ color: theme.fgSubtle, fontSize: 14, marginTop: 8 }}>
                Signed in as <Text style={{ color: theme.fg, fontWeight: "700" }}>{auth.email}</Text>
              </Text>
            )}
          </Animated.View>

          <View style={{ marginTop: 32, gap: 12 }}>
            <Row label="Privacy policy" onPress={() => router.push("/legal/privacy")} />
            <Row label="Terms of service" onPress={() => router.push("/legal/terms")} />
          </View>

          <View style={{ marginTop: 32, gap: 12 }}>
            <Row label="Sign out" onPress={handleSignOut} />
            <Pressable
              onPress={handleDeleteAccount}
              disabled={busy}
              style={({ pressed }) => ({
                marginTop: 8,
                height: 56,
                borderRadius: radius.lg,
                backgroundColor: "rgba(217, 70, 110, 0.10)",
                borderWidth: 1.5,
                borderColor: "rgba(217, 70, 110, 0.4)",
                alignItems: "center",
                justifyContent: "center",
                opacity: busy ? 0.6 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ color: "#a8214a", fontSize: 14, fontWeight: "800", letterSpacing: 0.4 }}>
                {busy ? "Deleting…" : "Delete my account"}
              </Text>
            </Pressable>
            <Text style={{ color: theme.muted, fontSize: 11, textAlign: "center", marginTop: 4, lineHeight: 16 }}>
              Removes all your photos, try-ons, and bag. Cannot be undone.
            </Text>
          </View>

          <Text style={{ color: theme.muted, fontSize: 10, textAlign: "center", marginTop: 36, letterSpacing: 0.6 }}>
            OnMe · v0.1.0
          </Text>
          <View style={{ height: 80 }} />
        </ScrollView>
      </SafeAreaView>
      <BottomNav />
    </Background>
  );
}

function Row({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 54,
        borderRadius: radius.lg,
        backgroundColor: theme.bgElevated,
        borderWidth: 1,
        borderColor: theme.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 18,
        opacity: pressed ? 0.7 : 1,
        ...shadow.soft,
      })}
    >
      <Text style={{ color: theme.fg, fontSize: 14, fontWeight: "700" }}>{label}</Text>
      <Text style={{ color: theme.primary, fontSize: 16, fontWeight: "800" }}>›</Text>
    </Pressable>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={{ height: 60, justifyContent: "center" }}>
      <View pointerEvents="none" style={{ alignItems: "center" }}>
        <Logo size="sm" />
      </View>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 12,
          left: 0,
          right: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            backgroundColor: theme.bgElevated,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: "center",
            justifyContent: "center",
            ...shadow.soft,
          }}
        >
          <Text style={{ color: theme.fg, fontSize: 18, fontWeight: "300", marginTop: -2 }}>‹</Text>
        </Pressable>
      </View>
    </View>
  );
}
