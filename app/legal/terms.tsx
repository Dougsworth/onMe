import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { radius, shadow, theme } from "@/constants/theme";

// Plain-English ToS template. Replace with reviewed legal copy before
// launch. Last revised 2026-05-07.
export default function TermsScreen() {
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
            Terms of Service
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>Last updated 2026-05-07</Text>

          <Section title="What OnMe is">
            OnMe is a virtual try-on app. You submit a photo of yourself; we use third-party AI services to render fashion items on you and to surface buy links for similar real products on the open web. We do not sell anything directly.
          </Section>

          <Section title="Your account">
            You sign in via magic link. Keep your inbox secure — anyone with access to your email can sign in to your account. You're responsible for activity under your account.
          </Section>

          <Section title="What you can submit">
            Only photos of yourself. Don't upload photos of other people without their consent, photos of minors, or anything illegal. We may remove content and terminate accounts that violate this.
          </Section>

          <Section title="What we can do with your photos">
            We use them only to render try-ons and find products you asked us to find. Photos are encrypted at rest and never used to train models. We never share or sell them.
          </Section>

          <Section title="Third-party rendering">
            Try-on results are produced by Perfect Corp / YouCam, OpenAI, Replicate, and SerpAPI. Their accuracy varies and renders are best-effort approximations — not photorealistic guarantees. Don't rely on a try-on render to decide if something will look identical in real life.
          </Section>

          <Section title="Buy links">
            "Shop the real one" links lead to third-party retailers. We don't sell, ship, or warrant those products. Returns, refunds, and disputes are between you and the retailer.
          </Section>

          <Section title="No warranty">
            OnMe is provided "as is". We make no guarantees about uptime, accuracy, or fitness for any particular purpose. To the maximum extent allowed by law, we disclaim all warranties.
          </Section>

          <Section title="Limit of liability">
            To the maximum extent allowed by law, our total liability to you for any claim arising out of OnMe is limited to whatever you paid us for the service in the 12 months before the claim — which today is $0.
          </Section>

          <Section title="Termination">
            You can delete your account any time via Settings. We can suspend or terminate accounts that violate these terms.
          </Section>

          <Section title="Changes">
            We may update these terms. If we do, we'll notify you in-app before the change takes effect for your account.
          </Section>

          <Section title="Contact">
            Email support@onme.app for any questions.
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
