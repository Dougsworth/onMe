import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image as RNImage,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import WORDMARK from "../assets/images/wordmark.png";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { radius, shadow, theme } from "@/constants/theme";
import { CATEGORY_LABEL, getPostById } from "@/lib/feed";
import { scanPhoto, scanTikTok, type ScanDetection } from "@/lib/scan";
import type { Category } from "@/types";

type ScanState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "extracting" }
  | { kind: "scanning" }
  | { kind: "done"; detections: ScanDetection[]; sourceUri: string }
  | { kind: "failed"; message: string };

export default function ScanScreen() {
  const router = useRouter();
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  const [tiktokUrl, setTiktokUrl] = useState("");

  const startTikTok = useCallback(async () => {
    const trimmed = tiktokUrl.trim();
    if (!/tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/.test(trimmed)) {
      Alert.alert("That doesn't look right", "Paste a tiktok.com or vm.tiktok.com link.");
      return;
    }
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
    setState({ kind: "extracting" });
    try {
      const detections = await scanTikTok(trimmed);
      // sourceUri unknown for TikTok flow — show the cover indirectly via
      // detections; we just stash the original tiktok URL as a label.
      setState({ kind: "done", detections, sourceUri: trimmed });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      console.warn("[scan tiktok]", message);
      setState({ kind: "failed", message });
    }
  }, [tiktokUrl]);

  const startScan = useCallback(async (mode: "camera" | "library") => {
    const perm =
      mode === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Enable it in Settings to scan looks.");
      return;
    }
    const launch =
      mode === "camera"
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await launch({
        allowsEditing: false,
        quality: 0.85,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
    } catch (err) {
      console.warn("[scan] picker failed:", err);
      Alert.alert("Couldn't open picker", String(err));
      return;
    }
    if (res.canceled || !res.assets?.[0]) return;
    const localUri = res.assets[0].uri;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});

    setState({ kind: "uploading" });
    try {
      setState({ kind: "scanning" });
      const detections = await scanPhoto(localUri);
      setState({ kind: "done", detections, sourceUri: localUri });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      console.warn("[scan]", message);
      setState({ kind: "failed", message });
    }
  }, []);

  return (
    <Background>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <Header onBack={() => router.back()} />
        {state.kind === "idle" && (
          <Intro
            onPick={startScan}
            tiktokUrl={tiktokUrl}
            onTiktokUrlChange={setTiktokUrl}
            onTiktokSubmit={startTikTok}
          />
        )}
        {(state.kind === "uploading" ||
          state.kind === "scanning" ||
          state.kind === "extracting") && <Working state={state.kind} />}
        {state.kind === "done" && (
          <Results
            detections={state.detections}
            sourceUri={state.sourceUri}
            onAgain={() => setState({ kind: "idle" })}
            onTryOnCatalog={(postId) => router.push(`/product/${postId}`)}
            onTryOnReal={(d) => {
              const real = d.real;
              if (!real?.imageUrl) return;
              router.push({
                pathname: "/tryon-real",
                params: {
                  category: d.category,
                  productImageUrl: encodeURIComponent(real.imageUrl),
                  brand: encodeURIComponent(real.brand ?? ""),
                  name: encodeURIComponent(real.name ?? ""),
                  price: encodeURIComponent(real.price ?? ""),
                  buyLink: encodeURIComponent(real.buyLink ?? ""),
                },
              });
            }}
          />
        )}
        {state.kind === "failed" && (
          <Failed message={state.message} onAgain={() => setState({ kind: "idle" })} />
        )}
      </SafeAreaView>
      <BottomNav />
    </Background>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View
      style={{
        height: 60,
        justifyContent: "center",
        marginBottom: 4,
      }}
    >
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
          height: 36,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
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
        <View style={{ width: 36 }} />
      </View>
    </View>
  );
}

function Intro({
  onPick,
  tiktokUrl,
  onTiktokUrlChange,
  onTiktokSubmit,
}: {
  onPick: (mode: "camera" | "library") => void;
  tiktokUrl: string;
  onTiktokUrlChange: (v: string) => void;
  onTiktokSubmit: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 28, paddingBottom: 110, gap: 18 }}
      keyboardShouldPersistTaps="handled"
    >
      <Animated.View entering={FadeInDown.duration(280)}>
        <Text
          style={{
            color: theme.primary,
            fontSize: 11,
            letterSpacing: 2.4,
            fontWeight: "800",
            textTransform: "uppercase",
          }}
        >
          Look match
        </Text>
        <Text
          style={{
            color: theme.fg,
            fontSize: 36,
            fontWeight: "800",
            letterSpacing: -1.6,
            marginTop: 6,
            lineHeight: 40,
          }}
        >
          Shazam{"\n"}for clothes.
        </Text>
        <Text
          style={{
            color: theme.fgSubtle,
            fontSize: 14,
            marginTop: 12,
            lineHeight: 21,
          }}
        >
          Paste a TikTok link, drop a screenshot, or take a photo.
          We'll find every wearable item, look up the real product on the web,
          and let you try it on yourself.
        </Text>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(80).duration(280)}
        style={{
          backgroundColor: theme.bgElevated,
          borderRadius: radius.lg,
          padding: 16,
          borderWidth: 1.5,
          borderColor: theme.borderPink,
          gap: 10,
          ...shadow.soft,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            style={{
              color: theme.primaryDeep,
              fontSize: 10,
              letterSpacing: 1.6,
              fontWeight: "800",
            }}
          >
            ★ TIKTOK LINK
          </Text>
        </View>
        <TextInput
          value={tiktokUrl}
          onChangeText={onTiktokUrlChange}
          placeholder="https://www.tiktok.com/@user/video/…"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={onTiktokSubmit}
          style={{
            backgroundColor: theme.bgSoft,
            borderRadius: radius.md,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 13,
            color: theme.fg,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        />
        <Pressable
          onPress={onTiktokSubmit}
          disabled={!tiktokUrl.trim()}
          style={({ pressed }) => ({
            height: 48,
            borderRadius: radius.md,
            backgroundColor: tiktokUrl.trim() ? theme.primary : theme.primarySoft,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ scale: pressed ? 0.97 : 1 }],
            ...(tiktokUrl.trim() ? shadow.card : {}),
          })}
        >
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: 0.2 }}>
            Scan TikTok →
          </Text>
        </Pressable>
      </Animated.View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 4,
        }}
      >
        <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
        <Text style={{ color: theme.muted, fontSize: 10, letterSpacing: 1.6, fontWeight: "800" }}>
          OR
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
      </View>

      <Animated.View entering={FadeInDown.delay(160).duration(280)} style={{ gap: 12 }}>
        <PrimaryButton label="Upload from photos" onPress={() => onPick("library")} />
        <SecondaryButton label="Take a photo" onPress={() => onPick("camera")} />
      </Animated.View>

      <Text
        style={{
          color: theme.muted,
          fontSize: 11,
          textAlign: "center",
          marginTop: 8,
          letterSpacing: 0.4,
        }}
      >
        Powered by GPT vision · Perfect Corp · OnMe
      </Text>
    </ScrollView>
  );
}

// Status messages that cycle every ~2.5s while scanning. Order roughly
// matches the actual pipeline so the user sees a believable progression
// (upload → detect → match → rerank). The cycle loops if the scan takes
// longer than expected.
const SCAN_MESSAGES = [
  "Uploading your frames…",
  "Spotting every wearable…",
  "Drawing precision boxes…",
  "Searching every retailer…",
  "Asking AI which one's exact…",
  "Almost there…",
];

function Working({ state }: { state: "uploading" | "scanning" | "extracting" }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [pct, setPct] = useState(0);

  // Cycle the status message every 2.5s. While `msgIdx` is 0 and we're in
  // the "extracting" state, the rendered text gets a state-specific label
  // (see render below) so TikTok scans show "Pulling TikTok frames…" first.
  useEffect(() => {
    setMsgIdx(0);
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % SCAN_MESSAGES.length;
      setMsgIdx(i);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  // Tick percentage 0 → 95 with ease-out over ~18s (typical scan time).
  // Stops at 95 — the parent unmounts this component when state flips to
  // "done", so there's no visible cap; the user sees the final result
  // appear before the counter would settle.
  useEffect(() => {
    const start = Date.now();
    const totalMs = 18000;
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const linear = Math.min(elapsed / totalMs, 1);
      const eased = 1 - Math.pow(1 - linear, 1.8);
      setPct(Math.min(95, Math.floor(eased * 95)));
    }, 180);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36 }}>
      <ScanLoader />
      <Text
        style={{
          color: theme.fg,
          fontSize: 22,
          fontWeight: "800",
          letterSpacing: -0.6,
          textAlign: "center",
          marginTop: 28,
        }}
      >
        Scanning the look.
      </Text>
      {/* Big percentage tick — replaces the spinning indicator with a
          forward-moving number so users feel progress instead of a loop. */}
      <Text
        style={{
          color: theme.primary,
          fontSize: 36,
          fontWeight: "800",
          letterSpacing: -1.2,
          marginTop: 14,
          fontVariant: ["tabular-nums"],
        }}
      >
        {pct}%
      </Text>
      <Text
        style={{
          color: theme.fgSubtle,
          fontSize: 14,
          marginTop: 10,
          textAlign: "center",
          lineHeight: 20,
        }}
      >
        {state === "extracting" && msgIdx === 0
          ? "Pulling TikTok frames…"
          : SCAN_MESSAGES[msgIdx]}
      </Text>
    </View>
  );
}

// Cool loader — the OnMe wordmark with three layered effects:
//   1. Soft pink halo behind the logo, rotating clockwise (slow).
//   2. Pink scanner beam sweeping top-to-bottom INSIDE the logo bounds
//      (clipped via overflow: hidden) — reads as "actively scanning".
//   3. Three small dots orbiting around the logo (also clockwise).
//   4. Subtle scale pulse on the logo so it feels alive while the beam runs.
function ScanLoader() {
  const LOGO_H = 130;
  const LOGO_W = LOGO_H * 1.5; // matches Logo ASPECT
  const PAD = 50; // breathing room for orbit dots + halo
  const ORBIT_R = LOGO_W / 2 + 18;
  const BEAM_H = 36;

  // Beam: translate from -BEAM_H to LOGO_H, loop.
  const beam = useSharedValue(0);
  // Logo pulse: 0 → 1 ping-pong.
  const pulse = useSharedValue(0);
  // Orbit + halo rotation: 0 → 360, loop.
  const rot = useSharedValue(0);

  useEffect(() => {
    beam.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    rot.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1, false);
  }, [beam, pulse, rot]);

  const beamStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(beam.value, [0, 1], [-BEAM_H, LOGO_H]) },
    ],
    opacity: interpolate(beam.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
  }));
  const logoPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.97, 1.025]) }],
  }));
  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(rot.value, [0, 1], [0, 360])}deg` }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(rot.value, [0, 1], [0, -360])}deg` }],
    opacity: interpolate(pulse.value, [0, 1], [0.45, 0.85]),
  }));

  const containerSize = LOGO_W + PAD * 2;

  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Halo: soft conic-ish glow behind the logo, slow counter-rotation. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: containerSize,
            height: containerSize,
            borderRadius: containerSize / 2,
            alignItems: "center",
            justifyContent: "center",
          },
          haloStyle,
        ]}
      >
        <LinearGradient
          colors={["rgba(242,127,163,0)", "rgba(255,178,201,0.55)", "rgba(242,127,163,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: "100%", height: "100%", borderRadius: containerSize / 2 }}
        />
      </Animated.View>

      {/* Logo with scanner beam clipped inside it. */}
      <Animated.View
        style={[
          {
            width: LOGO_W,
            height: LOGO_H,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          },
          logoPulseStyle,
        ]}
      >
        <Image
          source={WORDMARK}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
        />
        {/* Scanner beam — gradient bar that sweeps top → bottom inside logo. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: BEAM_H,
            },
            beamStyle,
          ]}
        >
          <LinearGradient
            colors={[
              "rgba(242,127,163,0)",
              "rgba(242,127,163,0.65)",
              "rgba(255,255,255,0.9)",
              "rgba(242,127,163,0.65)",
              "rgba(242,127,163,0)",
            ]}
            locations={[0, 0.35, 0.5, 0.65, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </Animated.View>

      {/* Orbit: 3 dots evenly spaced around a circle, rotating. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: ORBIT_R * 2,
            height: ORBIT_R * 2,
            alignItems: "center",
            justifyContent: "center",
          },
          orbitStyle,
        ]}
      >
        {[0, 120, 240].map((deg) => (
          <View
            key={deg}
            style={{
              position: "absolute",
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.primary,
              transform: [{ rotate: `${deg}deg` }, { translateY: -ORBIT_R }],
              ...shadow.soft,
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

function Results({
  detections,
  sourceUri,
  onAgain,
  onTryOnCatalog,
  onTryOnReal,
}: {
  detections: ScanDetection[];
  sourceUri: string;
  onAgain: () => void;
  onTryOnCatalog: (postId: string) => void;
  onTryOnReal: (detection: ScanDetection) => void;
}) {
  if (detections.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36 }}>
        <Text style={{ color: theme.fg, fontSize: 22, fontWeight: "800", textAlign: "center" }}>
          Couldn't spot anything wearable.
        </Text>
        <Text
          style={{ color: theme.fgSubtle, fontSize: 14, marginTop: 10, textAlign: "center", lineHeight: 20 }}
        >
          Try a clearer or closer shot — make sure the items you want to try on
          are clearly visible.
        </Text>
        <View style={{ marginTop: 28, width: "100%" }}>
          <PrimaryButton label="Scan again" onPress={onAgain} />
        </View>
      </View>
    );
  }

  // First detection that has a YouCam-supported category AND a real product
  // image — used as the centered Try-On pill's target on the hero photo.
  const firstTryOn = detections.find(
    (d) => TRYON_SUPPORTED.has(d.category.toLowerCase()) && !!d.real?.imageUrl,
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 110, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <HeroPhoto
        sourceUri={sourceUri}
        detections={detections}
        onTryOnFirst={firstTryOn ? () => onTryOnReal(firstTryOn) : null}
      />

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 6,
          marginTop: 6,
        }}
      >
        <Text
          style={{
            color: theme.primary,
            fontSize: 11,
            letterSpacing: 2,
            fontWeight: "800",
            textTransform: "uppercase",
          }}
        >
          {detections.length} match{detections.length === 1 ? "" : "es"}
        </Text>
        <Pressable onPress={onAgain} hitSlop={10}>
          <Text style={{ color: theme.fgSubtle, fontSize: 12, fontWeight: "700" }}>Rescan</Text>
        </Pressable>
      </View>

      {detections.map((d, i) => (
        <Animated.View key={`${d.category}-${i}`} entering={FadeIn.duration(220).delay(i * 60)}>
          <DetectionCard
            detection={d}
            onTryOnReal={onTryOnReal}
            onTryOnCatalog={onTryOnCatalog}
          />
        </Animated.View>
      ))}
    </ScrollView>
  );
}

// Banner-style hero shot: full-bleed source photo with dashed pink bboxes
// overlaying each detection, floating "Category · price" tag pills at each
// bbox's top-left, a centered Try-On pill at the bottom, and a clean white
// product card stacked beneath. Skipped for TikTok scans where sourceUri
// isn't a renderable image (Image.getSize fails).
function HeroPhoto({
  sourceUri,
  detections,
  onTryOnFirst,
}: {
  sourceUri: string;
  detections: ScanDetection[];
  onTryOnFirst: (() => void) | null;
}) {
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    RNImage.getSize(
      sourceUri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setAspect(w / h);
      },
      () => {
        if (!cancelled) setAspect(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceUri]);

  if (aspect == null) return null;

  // Pick the first detection with a real product as the bottom card subject.
  // Otherwise omit the bottom card so the photo still anchors the screen.
  const featured = detections.find((d) => d.real?.brand) ?? null;

  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={{
        borderRadius: radius.xl,
        overflow: "hidden",
        backgroundColor: "#fff",
        ...shadow.card,
      }}
    >
      <View style={{ width: "100%", aspectRatio: aspect, backgroundColor: theme.bgSoft }}>
        <Image
          source={{ uri: sourceUri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
        />

        {detections.map((d, i) => {
          if (!d.bbox) return null;
          const x = Math.max(0, Math.min(1, d.bbox.x));
          const y = Math.max(0, Math.min(1, d.bbox.y));
          const w = Math.max(0, Math.min(1 - x, d.bbox.w));
          const h = Math.max(0, Math.min(1 - y, d.bbox.h));
          if (w < 0.04 || h < 0.04) return null;
          const label = (CATEGORY_LABEL[d.category as Category] ?? d.category).replace(/s$/, "");
          const price = d.real?.price ?? "";
          const tagText = price ? `${label} · ${price}` : label;
          // Position the floating tag pill above the bbox when there's room,
          // otherwise inside the top-left of the bbox.
          const tagAbove = y > 0.06;
          return (
            <View
              key={`${d.category}-${i}`}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
              }}
            >
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderWidth: 2,
                  borderColor: theme.primary,
                  borderStyle: "dashed",
                }}
              />
              <View
                style={{
                  position: "absolute",
                  top: tagAbove ? -14 : 6,
                  left: 0,
                  paddingHorizontal: 9,
                  height: 22,
                  borderRadius: radius.pill,
                  backgroundColor: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                  ...shadow.soft,
                }}
              >
                <Text
                  style={{
                    color: theme.primaryDeep,
                    fontSize: 10,
                    fontWeight: "800",
                    letterSpacing: 0.2,
                  }}
                  numberOfLines={1}
                >
                  {tagText}
                </Text>
              </View>
            </View>
          );
        })}

        {onTryOnFirst && (
          <Pressable
            onPress={onTryOnFirst}
            style={({ pressed }) => ({
              position: "absolute",
              bottom: 14,
              alignSelf: "center",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 16,
              height: 38,
              borderRadius: radius.pill,
              backgroundColor: "#fff",
              transform: [{ scale: pressed ? 0.96 : 1 }],
              ...shadow.card,
            })}
          >
            <Ionicons name="shirt-outline" size={14} color={theme.primaryDeep} />
            <Text
              style={{
                color: theme.primaryDeep,
                fontSize: 12,
                fontWeight: "800",
                letterSpacing: 0.4,
              }}
            >
              Try-On
            </Text>
          </Pressable>
        )}
      </View>

      {featured?.real && (
        <Pressable
          onPress={() => {
            const link = featured.real?.buyLink;
            if (link) Linking.openURL(link).catch(() => {});
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: "#fff",
            borderTopWidth: 1,
            borderTopColor: theme.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {featured.real.imageUrl ? (
            <Image
              source={{ uri: featured.real.imageUrl }}
              style={{
                width: 50,
                height: 50,
                borderRadius: radius.md,
                backgroundColor: theme.bgSoft,
              }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                width: 50,
                height: 50,
                borderRadius: radius.md,
                backgroundColor: theme.bgSoft,
              }}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: theme.fg, fontSize: 13, fontWeight: "700" }}
              numberOfLines={1}
            >
              {featured.real.name}
            </Text>
            {featured.real.price ? (
              <Text
                style={{ color: theme.fgSubtle, fontSize: 13, fontWeight: "700", marginTop: 2 }}
              >
                {featured.real.price}
              </Text>
            ) : null}
          </View>
          {featured.real.buyLink ? (
            <Text style={{ color: theme.primary, fontSize: 13, fontWeight: "800" }}>Buy →</Text>
          ) : null}
        </Pressable>
      )}
    </Animated.View>
  );
}

// YouCam can render these — show "Try OnMe" button. Detection-only
// categories (sunglasses, hat, bag, etc.) get "Shop" only.
const TRYON_SUPPORTED = new Set<string>([
  "watch",
  "ring",
  "necklace",
  "earring",
  "bracelet",
  "outfit",
]);

function DetectionCard({
  detection,
  onTryOnReal,
  onTryOnCatalog,
}: {
  detection: ScanDetection;
  onTryOnReal: (detection: ScanDetection) => void;
  onTryOnCatalog: (postId: string) => void;
}) {
  const post = detection.catalogId ? getPostById(detection.catalogId) : null;
  const cat = detection.category as Category;
  const label = CATEGORY_LABEL[cat] ?? detection.category;
  const real = detection.real;
  const canTryOnReal =
    !!real?.imageUrl && TRYON_SUPPORTED.has(detection.category.toLowerCase());

  return (
    <View
      style={{
        backgroundColor: theme.bgElevated,
        borderRadius: radius.lg,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.border,
        ...shadow.soft,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <View
          style={{
            paddingHorizontal: 10,
            height: 22,
            borderRadius: radius.pill,
            backgroundColor: theme.primarySoft,
            justifyContent: "center",
          }}
        >
          <Text
            style={{ color: theme.primaryDeep, fontSize: 10, letterSpacing: 1.4, fontWeight: "800" }}
          >
            {label.toUpperCase()}
          </Text>
        </View>
        <Text style={{ color: theme.muted, fontSize: 11, fontWeight: "700" }}>
          {Math.round(detection.confidence * 100)}%
        </Text>
      </View>

      <Text style={{ color: theme.fg, fontSize: 15, fontWeight: "700", lineHeight: 21 }}>
        {detection.description}
      </Text>

      {real && real.brand ? (
        <RealProductCard product={real} />
      ) : (
        <Pressable
          onPress={() => {
            const q = `${detection.category} ${detection.description}`.trim();
            const url = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;
            Linking.openURL(url).catch(() => {});
          }}
          style={({ pressed }) => ({
            marginTop: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: radius.md,
            backgroundColor: theme.bgSoft,
            borderWidth: 1,
            borderColor: theme.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: theme.fgSubtle, fontSize: 12, fontWeight: "700" }}>
            No exact match — search Google
          </Text>
          <Text style={{ color: theme.primary, fontSize: 13, fontWeight: "800" }}>›</Text>
        </Pressable>
      )}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        {canTryOnReal ? (
          <Pressable
            onPress={() => onTryOnReal(detection)}
            style={({ pressed }) => ({
              flex: 1,
              height: 46,
              borderRadius: radius.md,
              backgroundColor: theme.primary,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.97 : 1 }],
              ...shadow.card,
            })}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 0.2 }}>
              Try OnMe ›
            </Text>
          </Pressable>
        ) : post ? (
          <Pressable
            onPress={() => onTryOnCatalog(post.id)}
            style={({ pressed }) => ({
              flex: 1,
              height: 46,
              borderRadius: radius.md,
              backgroundColor: theme.primary,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.97 : 1 }],
              ...shadow.card,
            })}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 0.2 }}>
              Try a similar one ›
            </Text>
          </Pressable>
        ) : null}
        {real?.buyLink ? (
          <Pressable
            onPress={() => Linking.openURL(real.buyLink).catch(() => {})}
            style={({ pressed }) => ({
              flex: 1,
              height: 46,
              borderRadius: radius.md,
              backgroundColor: "rgba(242,127,163,0.10)",
              borderWidth: 1.5,
              borderColor: theme.borderPink,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Text style={{ color: theme.primaryDeep, fontSize: 13, fontWeight: "800" }}>
              Shop the real one
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function RealProductCard({ product }: { product: { brand: string; name: string; price: string; imageUrl: string } }) {
  return (
    <View
      style={{
        marginTop: 12,
        flexDirection: "row",
        gap: 12,
        padding: 12,
        borderRadius: radius.md,
        backgroundColor: theme.bgSoft,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.sm,
          backgroundColor: theme.bgElevated,
          overflow: "hidden",
        }}
      >
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: theme.muted, fontSize: 18 }}>♡</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text
          style={{ color: theme.primary, fontSize: 9, letterSpacing: 1.4, fontWeight: "800" }}
          numberOfLines={1}
        >
          {product.brand.toUpperCase()}
        </Text>
        <Text
          style={{ color: theme.fg, fontSize: 13, fontWeight: "700", marginTop: 2 }}
          numberOfLines={1}
        >
          {product.name}
        </Text>
        {product.price ? (
          <Text style={{ color: theme.fgSubtle, fontSize: 12, fontWeight: "700", marginTop: 2 }}>
            {product.price}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Failed({ message, onAgain }: { message: string; onAgain: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36 }}>
      <Text
        style={{
          color: theme.primaryDeep,
          fontSize: 10,
          letterSpacing: 1.8,
          fontWeight: "800",
          marginBottom: 6,
        }}
      >
        SOMETHING WENT WRONG
      </Text>
      <Text
        style={{ color: theme.fg, fontSize: 22, fontWeight: "800", letterSpacing: -0.6, textAlign: "center" }}
      >
        Couldn't scan that.
      </Text>
      <Text
        style={{ color: theme.fgSubtle, fontSize: 13, marginTop: 10, textAlign: "center", lineHeight: 19 }}
      >
        {message}
      </Text>
      <View style={{ marginTop: 28, width: "100%" }}>
        <PrimaryButton label="Try again" onPress={onAgain} />
      </View>
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 56,
        borderRadius: radius.lg,
        backgroundColor: theme.primary,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...shadow.card,
      })}
    >
      <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 54,
        borderRadius: radius.lg,
        backgroundColor: "rgba(242,127,163,0.10)",
        borderWidth: 1.5,
        borderColor: theme.borderPink,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text style={{ color: theme.primaryDeep, fontSize: 15, fontWeight: "800", letterSpacing: 0.2 }}>
        {label}
      </Text>
    </Pressable>
  );
}
