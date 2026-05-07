import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { BagSheet } from "@/components/BagSheet";
import { FullscreenImageViewer } from "@/components/FullscreenImageViewer";
import { Logo } from "@/components/Logo";
import { PhotoSheet } from "@/components/PhotoSheet";
import { radius, shadow, spring, theme } from "@/constants/theme";
import { addToBag } from "@/lib/bag";
import { CATEGORY_LABEL, formatPrice, getPostById, getRelated } from "@/lib/feed";
import { diagnoseStrategy, runTryOn, TryOnError } from "@/lib/perfectcorp/client";
import { loadCops, recordCop, removeCop } from "@/lib/persistence";
import {
  ALL_STRATEGIES,
  mutate,
  type MutationStrategy,
  planFromMessage,
} from "@/lib/photoMutator";
import {
  clearBodyPhoto,
  getBodyPhoto,
  resolvePublicUrlForPart,
  saveBodyPhoto,
  uploadOneShot,
} from "@/lib/snap";
import { recordTryOn } from "@/lib/tryons";
import { CATEGORY_TO_BODY_PART, type BodyPart, type Post } from "@/types";

const { width: SCREEN_W } = Dimensions.get("window");
const HERO_H = SCREEN_W * 1.15;
const REL_GAP = 12;
const REL_SIDE = 18;
const REL_COL_W = (SCREEN_W - REL_SIDE * 2 - REL_GAP) / 2;

interface PartPrompt {
  title: string;
  hint: string;
  aspect: [number, number];
  front: boolean;
  // Sample photo from YouCam Playground showing how to frame the shot.
  example: string;
}

const PART_PROMPT: Record<BodyPart, PartPrompt> = {
  ear: {
    title: "Face & ears",
    hint: "Front-facing, ears visible. Fill the frame head to chin.",
    aspect: [3, 4],
    front: true,
    example:
      "https://plugins-media.makeupar.com/strapi/assets/earring_user_01_05727a3c72.png",
  },
  wrist: {
    title: "Wrist",
    hint: "Bare wrist, palm down. Wrist should fill most of the frame.",
    aspect: [3, 4],
    front: false,
    example:
      "https://plugins-media.makeupar.com/strapi/assets/watch_and_bracelet_user_01_09f16603cb.png",
  },
  finger: {
    title: "Hand",
    hint: "Open hand, fingers spread, palm filling two-thirds of the frame.",
    aspect: [3, 4],
    front: false,
    example:
      "https://plugins-media.makeupar.com/strapi/assets/ring_user_01_6d9893abd0.png",
  },
  neck: {
    title: "Neck",
    hint: "Collarbone visible, no necklace. Shoulders in frame.",
    aspect: [3, 4],
    front: true,
    example:
      "https://plugins-media.makeupar.com/strapi/assets/necklace_user_01_ce1b7e81ec.png",
  },
  body: {
    title: "Full body",
    hint: "Stand back, full body in frame. Head to feet.",
    aspect: [3, 5],
    front: false,
    example:
      "https://plugins-media.makeupar.com/strapi/assets/clothes_01_10be1e1a9b.png",
  },
};

type RenderState =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "rendering" }
  | { kind: "refining"; attempt: number }
  | { kind: "done"; resultUrl: string }
  | { kind: "failed"; message: string };

export default function ProductDetail() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const post = useMemo(() => (params.id ? getPostById(params.id) : null), [params.id]);
  const related = useMemo(() => (post ? getRelated(post, 8) : []), [post]);

  const [state, setState] = useState<RenderState>({ kind: "idle" });
  const [saved, setSaved] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [sheet, setSheet] = useState<{
    title: string;
    hint: string;
    example: string;
    resolve: (open: boolean) => void;
    resolveLibrary: () => void;
  } | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    setState({ kind: "idle" });
    setShowOriginal(false);
    if (post) {
      loadCops().then((set) => setSaved(set.has(post.id)));
    }
  }, [post]);

  const ensureBodyPhoto = useCallback(async (part: BodyPart): Promise<string | null> => {
    const existing = await getBodyPhoto(part);
    if (existing) return existing;

    const cfg = PART_PROMPT[part];
    // Sheet now offers TWO paths — "Take a photo" or "Upload from library".
    // Either one resolves the promise with the chosen source so the caller
    // can launch the right ImagePicker API.
    const choice = await new Promise<"camera" | "library" | null>((resolve) => {
      setSheet({
        title: cfg.title,
        hint: cfg.hint,
        example: cfg.example,
        resolve: (open) => resolve(open ? "camera" : null),
        // The "library" option uses a separate resolve through the
        // sheet's own onChooseLibrary action, set below.
        resolveLibrary: () => resolve("library"),
      });
    });
    if (!choice) return null;

    // The PhotoSheet is a Modal. iOS silently no-ops if you try to present
    // the camera (also a Modal) while the previous one is still dismissing.
    // Wait out the slide-down animation before launching.
    await new Promise((r) => setTimeout(r, 420));

    let res: ImagePicker.ImagePickerResult;
    if (choice === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera permission needed", "Enable it in Settings.");
        return null;
      }
      try {
        res = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          quality: 0.95,
          aspect: cfg.aspect,
          cameraType: cfg.front
            ? ImagePicker.CameraType.front
            : ImagePicker.CameraType.back,
        });
      } catch (err) {
        // Camera unavailable (simulator, hardware issue, modal-stacking
        // error). Fall back to the library so the user can still proceed.
        console.warn("[camera] launch failed, falling back to library:", err);
        res = await ImagePicker.launchImageLibraryAsync({
          allowsEditing: true,
          quality: 0.95,
          aspect: cfg.aspect,
        });
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Photo library permission needed", "Enable it in Settings.");
        return null;
      }
      res = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        quality: 0.95,
        aspect: cfg.aspect,
      });
    }
    if (res.canceled || !res.assets?.[0]) return null;
    const local = res.assets[0].uri;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await saveBodyPhoto(part, local);
    return local;
  }, []);

  const tryOn = useCallback(async () => {
    if (!post) return;
    const part = CATEGORY_TO_BODY_PART[post.category];
    setState({ kind: "capturing" });
    const photo = await ensureBodyPhoto(part);
    if (!photo) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "rendering" });

    // Initial submission uses the user's saved body photo (resolved via the
    // per-part Supabase upload) and runs through the worker's GPT preflight.
    // On a YouCam framing/detection failure, the corrective pipeline mutates
    // the local photo (zoom / pad), uploads the variant, and resubmits with
    // skipPreflight (the original photo already passed). Two retries max.
    const attempt = async (override?: string, skipPre = false): Promise<string> => {
      const res = await runTryOn({
        category: post.category,
        productImageUrl: post.source_image_url,
        paletteHex: post.palette_hex,
        srcImageUrlOverride: override,
        skipPreflight: skipPre,
      });
      return res.resultImageUrl;
    };

    const MAX_RETRIES = 4;
    const triedStrategies: string[] = [];

    try {
      let resultUrl: string;
      try {
        resultUrl = await attempt();
      } catch (err) {
        if (!(err instanceof TryOnError) || !err.retryable) throw err;

        // Mutate-and-retry. First two passes use a static plan derived from
        // the failure signature; subsequent passes ask GPT-4o-mini to look at
        // the photo + error and recommend a strategy from the toolkit.
        const initialPlan = planFromMessage(err.message, err.code);
        let lastErr: TryOnError = err;
        let succeeded = false;
        let srcPublicCache: string | null = null;

        for (let i = 0; i < MAX_RETRIES; i++) {
          let strategy: MutationStrategy | null = null;

          // Static plan for first 2 passes.
          for (const candidate of initialPlan) {
            if (!triedStrategies.includes(candidate) && i < 2) {
              strategy = candidate;
              break;
            }
          }

          // Pass 3+: ask GPT for a recommendation.
          if (!strategy) {
            if (!srcPublicCache) {
              srcPublicCache = await resolvePublicUrlForPart(part);
            }
            const diag = await diagnoseStrategy({
              category: post.category,
              srcImageUrl: srcPublicCache,
              errorMessage: lastErr.message,
              triedStrategies,
            });
            console.log("[tryOn] diagnosis →", diag.strategy, "·", diag.reason);
            if (
              diag.strategy &&
              (ALL_STRATEGIES as readonly string[]).includes(diag.strategy) &&
              !triedStrategies.includes(diag.strategy)
            ) {
              strategy = diag.strategy as MutationStrategy;
            } else {
              // Fallback: pick any unused strategy from the toolkit.
              const remaining = ALL_STRATEGIES.find(
                (s) => !triedStrategies.includes(s),
              );
              if (!remaining) break;
              strategy = remaining;
            }
          }

          triedStrategies.push(strategy);
          setState({ kind: "refining", attempt: i + 1 });
          try {
            const mutatedLocal = await mutate(photo, strategy);
            const mutatedPublic = await uploadOneShot(mutatedLocal);
            resultUrl = await attempt(mutatedPublic, /* skipPreflight */ true);
            succeeded = true;
            break;
          } catch (mErr) {
            if (mErr instanceof TryOnError) lastErr = mErr;
            console.warn("[tryOn] mutation", strategy, "failed:", mErr);
          }
        }

        if (!succeeded) throw lastErr;
        resultUrl = resultUrl!;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setState({ kind: "done", resultUrl });
      setShowOriginal(false);
      // Save successful try-ons so they show up in the user's hub feed.
      void recordTryOn(post.id, resultUrl).catch((e) =>
        console.warn("[tryOn] save history failed", e),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed";
      console.warn("[tryOn]", post.category, message);
      setState({ kind: "failed", message });
    }
  }, [ensureBodyPhoto, post]);

  const toggleSave = useCallback(async () => {
    if (!post) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
    if (saved) {
      await removeCop(post.id);
      setSaved(false);
    } else {
      await recordCop(post.id);
      setSaved(true);
    }
  }, [post, saved]);

  if (!post) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: theme.fgSubtle }}>Product not found</Text>
        <Pressable onPress={() => router.replace("/feed")} style={{ marginTop: 16 }}>
          <Text style={{ color: theme.primary, fontWeight: "700" }}>Back to feed</Text>
        </Pressable>
      </View>
    );
  }

  const isHair = post.category === "hair" && post.palette_hex;
  const productHero = post.display_image_url ?? post.source_image_url;
  const heroUri =
    state.kind === "done" && !showOriginal ? state.resultUrl : productHero;
  const showOnYouChip = state.kind === "done" && !showOriginal;
  const isWorking =
    state.kind === "rendering" ||
    state.kind === "capturing" ||
    state.kind === "refining";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <BagSheet visible={bagOpen} onClose={() => setBagOpen(false)} />
      <PhotoSheet
        visible={!!sheet}
        title={sheet?.title ?? ""}
        hint={sheet?.hint ?? ""}
        example={sheet?.example}
        actions={
          sheet
            ? [
                {
                  label: "Take a photo",
                  variant: "primary",
                  onPress: () => {
                    sheet.resolve(true);
                    setSheet(null);
                  },
                },
                {
                  label: "Upload from library",
                  variant: "ghost",
                  onPress: () => {
                    sheet.resolveLibrary();
                    setSheet(null);
                  },
                },
              ]
            : []
        }
        onClose={() => {
          sheet?.resolve(false);
          setSheet(null);
        }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 36 }}
      >
        <View>
          <Pressable
            onPress={() => {
              if (state.kind === "done") setViewerOpen(true);
            }}
            disabled={state.kind !== "done"}
            style={{ width: SCREEN_W, height: HERO_H, backgroundColor: theme.bgSoft }}
          >
            {isHair && state.kind !== "done" ? (
              <HairHero hex={post.palette_hex!} name={post.product_name} />
            ) : (
              <Image
                source={{ uri: heroUri }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={150}
              />
            )}
            {isWorking && (
              <RenderingOverlay
                state={state.kind}
                attempt={state.kind === "refining" ? state.attempt : undefined}
              />
            )}
            {state.kind === "done" && <DoneFlourish />}
            {state.kind === "done" && (
              <View
                style={{
                  position: "absolute",
                  top: 110,
                  right: 14,
                  paddingHorizontal: 10,
                  height: 24,
                  borderRadius: radius.pill,
                  backgroundColor: "rgba(0,0,0,0.45)",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 5,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 10 }}>⤢</Text>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 1.2 }}>
                  TAP TO ZOOM
                </Text>
              </View>
            )}
          </Pressable>

          <TopChrome
            onBack={() => router.back()}
            saved={saved}
            onToggleSave={toggleSave}
          />

          <View style={{ position: "absolute", left: 16, bottom: 16, flexDirection: "row", gap: 6 }}>
            <Chip label={CATEGORY_LABEL[post.category]} />
            {showOnYouChip && <Chip label="ON YOU" accent />}
          </View>

          {state.kind === "done" && (
            <Pressable
              onPress={() => setShowOriginal((s) => !s)}
              style={{
                position: "absolute",
                right: 16,
                bottom: 16,
                paddingHorizontal: 12,
                height: 30,
                borderRadius: radius.pill,
                backgroundColor: "rgba(255,255,255,0.95)",
                alignItems: "center",
                justifyContent: "center",
                ...shadow.soft,
              }}
            >
              <Text
                style={{
                  color: theme.primaryDeep,
                  fontSize: 10,
                  letterSpacing: 1.2,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {showOriginal ? "Show on you" : "Show product"}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
          <Text
            style={{
              color: theme.fg,
              fontSize: 26,
              fontWeight: "800",
              letterSpacing: -0.7,
              lineHeight: 30,
            }}
          >
            {post.product_name}
          </Text>
          <Text
            style={{
              color: theme.muted,
              fontSize: 13,
              fontWeight: "500",
              marginTop: 6,
              letterSpacing: -0.05,
            }}
            numberOfLines={1}
          >
            by {post.brand}
          </Text>

          {post.price_usd != null && (
            <Text
              style={{
                color: theme.fg,
                fontSize: 24,
                fontWeight: "800",
                letterSpacing: -0.5,
                marginTop: 14,
              }}
            >
              {formatPrice(post.price_usd)}
            </Text>
          )}

          {post.caption && (
            <Text style={{ color: theme.fgSubtle, fontSize: 14, marginTop: 12, lineHeight: 20 }}>
              {post.caption}
            </Text>
          )}

          <View style={{ marginTop: 24 }}>
            {state.kind === "failed" ? (
              <FailedCard
                message={state.message}
                onRetry={tryOn}
                onRetakePhoto={async () => {
                  const part = CATEGORY_TO_BODY_PART[post.category];
                  await clearBodyPhoto(part);
                  setState({ kind: "idle" });
                  tryOn();
                }}
                partLabel={PART_PROMPT[CATEGORY_TO_BODY_PART[post.category]].title.toLowerCase()}
              />
            ) : (
              <View style={{ gap: 10 }}>
                <PrimaryButton
                  label={state.kind === "done" ? "Try again" : isHair ? "Try this color" : "Try on me"}
                  onPress={tryOn}
                  disabled={isWorking}
                  working={isWorking}
                />
                {post.price_usd != null && (
                  <AddToBagButton
                    label={
                      addedFlash
                        ? "Added · Open bag"
                        : `Add to bag  ·  ${formatPrice(post.price_usd)}`
                    }
                    flashing={addedFlash}
                    onPress={async () => {
                      if (addedFlash) {
                        setBagOpen(true);
                        return;
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
                      await addToBag(post.id);
                      setAddedFlash(true);
                      setTimeout(() => setAddedFlash(false), 1800);
                    }}
                  />
                )}
                {state.kind === "done" && (
                  <Text
                    style={{
                      color: theme.muted,
                      fontSize: 11,
                      letterSpacing: 0.4,
                      textAlign: "center",
                      marginTop: 4,
                    }}
                  >
                    Render powered by Perfect Corp
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        {related.length > 0 && (
          <View style={{ paddingHorizontal: REL_SIDE, paddingTop: 36 }}>
            <Text
              style={{
                color: theme.primary,
                fontSize: 11,
                letterSpacing: 2,
                textTransform: "uppercase",
                fontWeight: "800",
                marginBottom: 14,
              }}
            >
              MORE LIKE THIS
            </Text>
            <RelatedGrid posts={related} onTap={(p) => router.push(`/product/${p.id}`)} />
          </View>
        )}
      </ScrollView>
      <FullscreenImageViewer
        visible={viewerOpen}
        imageUrl={state.kind === "done" ? state.resultUrl : ""}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
}

function TopChrome({
  onBack,
  saved,
  onToggleSave,
}: {
  onBack: () => void;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const heart = useHeartPunch(saved);
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 50,
        left: 0,
        right: 0,
        height: 60,
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
          backgroundColor: "rgba(255,255,255,0.95)",
          alignItems: "center",
          justifyContent: "center",
          ...shadow.soft,
        }}
      >
        <Text style={{ color: theme.fg, fontSize: 18, fontWeight: "300", marginTop: -2 }}>‹</Text>
      </Pressable>

      <Animated.View style={heart}>
        <Pressable
          onPress={onToggleSave}
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            backgroundColor: saved ? theme.primary : "rgba(255,255,255,0.95)",
            alignItems: "center",
            justifyContent: "center",
            ...(saved ? shadow.card : shadow.soft),
          }}
        >
          <Text
            style={{
              color: saved ? "#fff" : theme.primary,
              fontSize: 16,
              marginTop: 1,
            }}
          >
            {saved ? "♥" : "♡"}
          </Text>
        </Pressable>
      </Animated.View>
      </View>
    </View>
  );
}

function AddToBagButton({
  label,
  onPress,
  flashing,
}: {
  label: string;
  onPress: () => void;
  flashing: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 54,
        borderRadius: radius.lg,
        backgroundColor: flashing ? theme.primarySoft : theme.bgElevated,
        borderWidth: 1.5,
        borderColor: flashing ? theme.primary : theme.fg,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text
        style={{
          color: flashing ? theme.primaryDeep : theme.fg,
          fontSize: 15,
          fontWeight: "800",
          letterSpacing: 0.1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  working,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  working?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        height: 58,
        borderRadius: radius.lg,
        backgroundColor: disabled ? theme.primarySoft : theme.primary,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
        opacity: disabled && !working ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...(disabled ? {} : shadow.card),
      })}
    >
      <Text
        style={{
          color: disabled ? theme.primaryDeep : "#fff",
          fontSize: 16,
          fontWeight: "800",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FailedCard({
  message,
  onRetry,
  onRetakePhoto,
  partLabel,
}: {
  message: string;
  onRetry: () => void;
  onRetakePhoto: () => void;
  partLabel: string;
}) {
  return (
    <View>
      <View
        style={{
          padding: 16,
          borderRadius: radius.lg,
          backgroundColor: theme.bgSoft,
          borderWidth: 1,
          borderColor: theme.borderPink,
          marginBottom: 14,
        }}
      >
        <Text
          style={{
            color: theme.primaryDeep,
            fontSize: 10,
            letterSpacing: 1.8,
            fontWeight: "800",
            marginBottom: 6,
          }}
        >
          HEADS UP
        </Text>
        <Text
          style={{
            color: theme.fg,
            fontSize: 15,
            fontWeight: "700",
            lineHeight: 21,
            letterSpacing: -0.1,
          }}
        >
          {message}
        </Text>
      </View>
      <PrimaryButton label={`Retake ${partLabel} & try again`} onPress={onRetakePhoto} />
      <Pressable
        onPress={onRetry}
        hitSlop={10}
        style={{ alignItems: "center", marginTop: 12, paddingVertical: 6 }}
      >
        <Text style={{ color: theme.fgSubtle, fontSize: 13, fontWeight: "600" }}>
          Try again with the same photo
        </Text>
      </Pressable>
    </View>
  );
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 10,
        height: 24,
        borderRadius: radius.pill,
        backgroundColor: accent ? theme.primary : "rgba(255,255,255,0.95)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 5,
        ...shadow.soft,
      }}
    >
      {accent && <Text style={{ color: "#fff", fontSize: 9 }}>✦</Text>}
      <Text
        style={{
          color: accent ? "#fff" : theme.fg,
          fontSize: 9,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          fontWeight: "800",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function HairHero({ hex, name }: { hex: string; name: string }) {
  return (
    <LinearGradient
      colors={[lighten(hex, 0.22), hex, darken(hex, 0.22)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}
    >
      <Text
        style={{
          color: "rgba(255,255,255,0.6)",
          fontSize: 11,
          letterSpacing: 3,
          fontWeight: "800",
          marginBottom: 16,
        }}
      >
        HAIR · COLOR STORY
      </Text>
      <Text
        style={{
          color: "#fff",
          fontSize: 56,
          fontWeight: "800",
          letterSpacing: -2.4,
          textAlign: "center",
          lineHeight: 60,
          textShadowColor: "rgba(0,0,0,0.18)",
          textShadowRadius: 8,
          textShadowOffset: { width: 0, height: 2 },
        }}
      >
        {name}
      </Text>
      <Text
        style={{
          color: "rgba(255,255,255,0.85)",
          fontSize: 14,
          fontWeight: "700",
          marginTop: 16,
          letterSpacing: 1,
        }}
      >
        {hex.toUpperCase()}
      </Text>
    </LinearGradient>
  );
}

function RenderingOverlay({
  state,
  attempt,
}: {
  state: "rendering" | "capturing" | "refining";
  attempt?: number;
}) {
  const label =
    state === "capturing"
      ? "Opening camera"
      : state === "refining"
        ? `Adjusting framing · pass ${attempt ?? 1}`
        : "Rendering on you";
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(35,16,25,0.32)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 18,
          borderRadius: radius.lg,
          backgroundColor: "rgba(255,255,255,0.98)",
          alignItems: "center",
          flexDirection: "row",
          gap: 14,
        }}
      >
        <Spinner />
        <Text
          style={{
            color: theme.fg,
            fontSize: 13,
            fontWeight: "700",
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

function Spinner() {
  // Single rotating arc in primary pink — restrained, no bounce.
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false,
    );
  }, [rot]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));
  return (
    <Animated.View
      style={[
        {
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 2.5,
          borderColor: theme.primarySoft,
          borderTopColor: theme.primary,
        },
        style,
      ]}
    />
  );
}

function DoneFlourish() {
  // Subtle dim → clear of the overlay tint when render completes. No sparkle.
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(255,255,255,0.4)",
        },
        style,
      ]}
    />
  );
}

function useHeartPunch(saved: boolean) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (saved) {
      scale.value = withSequence(withSpring(1.25, spring.pop), withSpring(1, spring.bouncy));
    }
  }, [saved, scale]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

function RelatedGrid({ posts, onTap }: { posts: Post[]; onTap: (p: Post) => void }) {
  const colA: Post[] = [];
  const colB: Post[] = [];
  posts.forEach((p, i) => {
    if (i % 2 === 0) colA.push(p);
    else colB.push(p);
  });
  return (
    <View style={{ flexDirection: "row", gap: REL_GAP }}>
      <RelatedColumn posts={colA} onTap={onTap} />
      <RelatedColumn posts={colB} onTap={onTap} />
    </View>
  );
}

function RelatedColumn({ posts, onTap }: { posts: Post[]; onTap: (p: Post) => void }) {
  return (
    <View style={{ flex: 1, gap: REL_GAP }}>
      {posts.map((p, i) => (
        <Animated.View
          key={p.id}
          entering={FadeInDown.delay(i * 25).duration(260)}
        >
          <RelatedTile post={p} onPress={() => onTap(p)} />
        </Animated.View>
      ))}
    </View>
  );
}

function RelatedTile({ post, onPress }: { post: Post; onPress: () => void }) {
  const height = REL_COL_W / post.aspect_ratio;
  const isHair = post.category === "hair" && post.palette_hex;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: REL_COL_W,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View
        style={{
          width: "100%",
          height,
          borderRadius: radius.lg,
          overflow: "hidden",
          backgroundColor: isHair ? post.palette_hex : theme.bgElevated,
          ...shadow.soft,
        }}
      >
        {isHair ? (
          <LinearGradient
            colors={[lighten(post.palette_hex!, 0.15), post.palette_hex!, darken(post.palette_hex!, 0.15)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1, justifyContent: "flex-end", padding: 12 }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 14,
                fontWeight: "800",
                letterSpacing: -0.2,
              }}
            >
              {post.product_name}
            </Text>
          </LinearGradient>
        ) : (
          <Image
            source={{ uri: post.display_image_url ?? post.source_image_url }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        )}
      </View>
      <View style={{ paddingHorizontal: 4, paddingTop: 8 }}>
        <Text
          style={{ color: theme.primary, fontSize: 9, letterSpacing: 1.4, fontWeight: "800" }}
          numberOfLines={1}
        >
          {post.brand.toUpperCase()}
        </Text>
        <Text
          style={{ color: theme.fg, fontSize: 12, fontWeight: "700", marginTop: 2 }}
          numberOfLines={1}
        >
          {post.product_name}
        </Text>
        {post.price_usd != null && (
          <Text style={{ color: theme.fgSubtle, fontSize: 11, fontWeight: "700", marginTop: 1 }}>
            {formatPrice(post.price_usd)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function lighten(hex: string, amount: number): string {
  return mix(hex, "#FFFFFF", amount);
}
function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}
function mix(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blu = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${blu.toString(16).padStart(2, "0")}`;
}
