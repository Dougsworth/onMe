import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { radius, shadow, theme } from "@/constants/theme";

// Plain-English privacy policy template. Update with real legal review
// before launch. Last revised 2026-05-07.
export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <Background>
      <SafeAreaView style={{ flex: 1 }}>
        <Header onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 36 }}>
          <Text style={{ color: theme.primary, fontSize: 11, letterSpacing: 2.4, fontWeight: "800" }}>
            LEGAL
          </Text>
          <Text style={{ color: theme.fg, fontSize: 30, fontWeight: "800", letterSpacing: -1.2, marginTop: 6 }}>
            Privacy Policy
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>Last updated 2026-05-07</Text>

          <Section title="What we collect">
            • Email address — used only to authenticate you via magic link.{"\n"}
            • Photos you take or upload — stored privately under your account so you can try items on later.{"\n"}
            • Try-on history — which items you rendered and the result image.{"\n"}
            • Device crash data — anonymous, used to fix bugs.
          </Section>

          <Section title="What we don't collect">
            • Location.{"\n"}
            • Microphone or audio.{"\n"}
            • Contacts, calendar, or any other device data.{"\n"}
            • Tracking identifiers across other apps or websites.
          </Section>

          <Section title="Who we share with">
            We send the photos you submit to third-party services strictly to render the try-on result and find products:{"\n\n"}
            • Perfect Corp (YouCam) — virtual try-on rendering.{"\n"}
            • OpenAI — vision detection and product re-ranking.{"\n"}
            • Replicate — pixel-precise object detection.{"\n"}
            • SerpAPI — image-based product search across Google Lens, Yandex, Google Shopping, eBay.{"\n\n"}
            Each service receives only the specific image needed for its task. We do not share your email or any account info with these services.
          </Section>

          <Section title="Where data lives">
            Photos and try-on history live in our Supabase storage bucket and database, located in the US. They're protected by row-level security so only you can read your own files. Magic-link tokens are issued by Supabase Auth.
          </Section>

          <Section title="Retention">
            Your data stays until you ask us to delete it (Settings → Delete my account) or until you've been inactive for 12 months. Inactive accounts are auto-purged.
          </Section>

          <Section title="Your rights (GDPR / CCPA)">
            You can:{"\n"}
            • Request a copy of all data we hold about you (email support@onme.app).{"\n"}
            • Delete your account and all associated data instantly via Settings → Delete my account.{"\n"}
            • Withdraw consent at any time by deleting your account.
          </Section>

          <Section title="Children">
            OnMe is not intended for users under 13. We do not knowingly collect data from children.
          </Section>

          <Section title="Contact">
            Email support@onme.app for any privacy questions.
          </Section>

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </Background>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 28 }}>
      <Text style={{ color: theme.fg, fontSize: 18, fontWeight: "800", letterSpacing: -0.4, marginBottom: 8 }}>
        {title}
      </Text>
      <Text style={{ color: theme.fgSubtle, fontSize: 14, lineHeight: 22 }}>{children}</Text>
    </View>
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
        style={{ position: "absolute", top: 12, left: 0, right: 0, paddingHorizontal: 16 }}
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
