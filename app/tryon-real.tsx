import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { FullscreenImageViewer } from "@/components/FullscreenImageViewer";
import { Logo } from "@/components/Logo";
import { PhotoSheet } from "@/components/PhotoSheet";
import { radius, shadow, theme } from "@/constants/theme";
import { CATEGORY_LABEL, formatPrice, getFeed } from "@/lib/feed";
import { diagnoseStrategy, runTryOn, TryOnError } from "@/lib/perfectcorp/client";
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
import { CATEGORY_TO_BODY_PART, type BodyPart, type Category, type Post } from "@/types";

const { width: SCREEN_W } = Dimensions.get("window");
const HERO_H = SCREEN_W * 1.15;

// Categories YouCam can render. Detection-only categories (sunglasses,
// glasses, hat, bag, scarf, shoes, belt, makeup) shouldn't reach this screen
// — scan.tsx hides the Try OnMe button for them.
const SUPPORTED: ReadonlySet<Category> = new Set<Category>([
  "watch",
  "ring",
  "necklace",
  "earring",
  "bracelet",
  "outfit",
]);

interface PartPrompt {
  title: string;
  hint: string;
  aspect: [number, number];
  front: boolean;
  example: string;
}

const PART_PROMPT: Record<BodyPart, PartPrompt> = {
  ear: {
    title: "Face & ears",
    hint: "Front-facing, ears visible. Fill the frame head to chin.",
    aspect: [3, 4],
    front: true,
    example: "https://plugins-media.makeupar.com/strapi/assets/earring_user_01_05727a3c72.png",
  },
  wrist: {
    title: "Wrist",
    hint: "Bare wrist, palm down. Wrist should fill most of the frame.",
    aspect: [3, 4],
    front: false,
    example: "https://plugins-media.makeupar.com/strapi/assets/watch_and_bracelet_user_01_09f16603cb.png",
  },
  finger: {
    title: "Hand",
    hint: "Open hand, fingers spread, palm filling two-thirds of the frame.",
    aspect: [3, 4],
    front: false,
    example: "https://plugins-media.makeupar.com/strapi/assets/ring_user_01_6d9893abd0.png",
  },
  neck: {
    title: "Neck",
    hint: "Collarbone visible, no necklace. Shoulders in frame.",
    aspect: [3, 4],
    front: true,
    example: "https://plugins-media.makeupar.com/strapi/assets/necklace_user_01_ce1b7e81ec.png",
  },
  body: {
    title: "Full body",
    hint: "Stand back, full body in frame. Head to feet.",
    aspect: [3, 5],
    front: false,
    example: "https://plugins-media.makeupar.com/strapi/assets/clothes_01_10be1e1a9b.png",
  },
};

type RenderState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "capturing" }
  | { kind: "rendering" }
  | { kind: "refining"; attempt: number }
  | { kind: "done"; resultUrl: string }
  | { kind: "failed"; message: string };

// The scanned-product try-on accepts everything via search params (the post
// is ad-hoc, not in the catalog). We keep the params shape mirror of what
// scan.tsx sends so the route is symmetric.
interface ScreenParams {
  category: string;
  productImageUrl: string;
  brand?: string;
  name?: string;
  price?: string;
  buyLink?: string;
}

export default function TryOnRealScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<keyof ScreenParams, string>>();
  const category = params.category as Category;
  const productImageUrl = decodeParam(params.productImageUrl);
  const brand = decodeParam(params.brand);
  const name = decodeParam(params.name);
  const buyLink = decodeParam(params.buyLink);

  const [state, setState] = useState<RenderState>({ kind: "idle" });
  const [showOriginal, setShowOriginal] = useState(false);
  const [rehostedUrl, setRehostedUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [similar, setSimilar] = useState<Post[]>([]);
  const [sheet, setSheet] = useState<{
    title: string;
    hint: string;
    example: string;
    resolve: (open: boolean) => void;
    resolveLibrary: () => void;
  } | null>(null);

  // Pull up to 4 catalog posts in the same category for the "Similar Looks"
  // rail shown after a try-on succeeds.
  useEffect(() => {
    let cancelled = false;
    getFeed().then((feed) => {
      if (cancelled) return;
      setSimilar(feed.filter((p) => p.category === category).slice(0, 4));
    });
    return () => {
      cancelled = true;
    };
  }, [category]);

  const supported = SUPPORTED.has(category);

  const ensureBodyPhoto = useCallback(async (part: BodyPart): Promise<string | null> => {
    const existing = await getBodyPhoto(part);
    if (existing) return existing;
    const cfg = PART_PROMPT[part];
    const choice = await new Promise<"camera" | "library" | null>((resolve) => {
      setSheet({
        title: cfg.title,
        hint: cfg.hint,
        example: cfg.example,
        resolve: (open) => resolve(open ? "camera" : null),
        resolveLibrary: () => resolve("library"),
      });
    });
    if (!choice) return null;
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
          cameraType: cfg.front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        });
      } catch (err) {
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

  // YouCam can't fetch arbitrary CDNs reliably (Google thumbnails, retailer
  // hosts that block bots). Download the scraped/SerpAPI image and rehost it
  // on Supabase before submitting to YouCam.
  const ensureRehosted = useCallback(async (): Promise<string> => {
    if (rehostedUrl) return rehostedUrl;
    const localPath = `${FileSystem.cacheDirectory}prod-${Date.now()}.jpg`;
    const dl = await FileSystem.downloadAsync(productImageUrl, localPath);
    if (dl.status !== 200) {
      throw new Error(`Couldn't fetch product image (${dl.status})`);
    }
    const url = await uploadOneShot(dl.uri);
    setRehostedUrl(url);
    return url;
  }, [productImageUrl, rehostedUrl]);

  const tryOn = useCallback(async () => {
    if (!supported) return;
    const part = CATEGORY_TO_BODY_PART[category];

    setState({ kind: "preparing" });
    let productPublic: string;
    try {
      productPublic = await ensureRehosted();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't fetch product image";
      setState({ kind: "failed", message });
      return;
    }

    setState({ kind: "capturing" });
    const photo = await ensureBodyPhoto(part);
    if (!photo) {
      setState({ kind: "idle" });
      return;
    }

    setState({ kind: "rendering" });
    const attempt = async (override?: string, skipPre = false): Promise<string> => {
      const res = await runTryOn({
        category,
        productImageUrl: productPublic,
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
        const initialPlan = planFromMessage(err.message, err.code);
        let lastErr: TryOnError = err;
        let succeeded = false;
        let srcPublicCache: string | null = null;
        for (let i = 0; i < MAX_RETRIES; i++) {
          let strategy: MutationStrategy | null = null;
          for (const candidate of initialPlan) {
            if (!triedStrategies.includes(candidate) && i < 2) {
              strategy = candidate;
              break;
            }
          }
          if (!strategy) {
            if (!srcPublicCache) {
              srcPublicCache = await resolvePublicUrlForPart(part);
            }
            const diag = await diagnoseStrategy({
              category,
              srcImageUrl: srcPublicCache,
              errorMessage: lastErr.message,
              triedStrategies,
            });
            if (
              diag.strategy &&
              (ALL_STRATEGIES as readonly string[]).includes(diag.strategy) &&
              !triedStrategies.includes(diag.strategy)
            ) {
              strategy = diag.strategy as MutationStrategy;
            } else {
              const remaining = ALL_STRATEGIES.find((s) => !triedStrategies.includes(s));
              if (!remaining) break;
              strategy = remaining;
            }
          }
          triedStrategies.push(strategy);
          setState({ kind: "refining", attempt: i + 1 });
          try {
            const mutatedLocal = await mutate(photo, strategy);
            const mutatedPublic = await uploadOneShot(mutatedLocal);
            resultUrl = await attempt(mutatedPublic, true);
            succeeded = true;
            break;
          } catch (mErr) {
            if (mErr instanceof TryOnError) lastErr = mErr;
          }
        }
        if (!succeeded) throw lastErr;
        resultUrl = resultUrl!;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setState({ kind: "done", resultUrl });
      setShowOriginal(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed";
      setState({ kind: "failed", message });
    }
  }, [category, ensureBodyPhoto, ensureRehosted, supported]);

  if (!productImageUrl || !category) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: theme.fgSubtle }}>Missing product info</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: theme.primary, fontWeight: "700" }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const heroUri =
    state.kind === "done" && !showOriginal ? state.resultUrl : productImageUrl;
  const showOnYouChip = state.kind === "done" && !showOriginal;
  const isWorking =
    state.kind === "preparing" ||
    state.kind === "capturing" ||
    state.kind === "rendering" ||
    state.kind === "refining";
  const label = CATEGORY_LABEL[category] ?? category;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36 }}>
        <View>
          <Pressable
            onPress={() => {
              if (state.kind === "done") setViewerOpen(true);
            }}
            disabled={state.kind !== "done"}
            style={{ width: SCREEN_W, height: HERO_H, backgroundColor: theme.bgSoft }}
          >
            <Image
              source={{ uri: heroUri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={150}
            />
            {isWorking && (
              <RenderingOverlay
                state={state.kind === "preparing" ? "preparing" : state.kind === "refining" ? "refining" : state.kind}
                attempt={state.kind === "refining" ? state.attempt : undefined}
              />
            )}
            {state.kind === "done" && (
              <View
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  paddingHorizontal: 10,
                  height: 26,
                  borderRadius: radius.pill,
                  backgroundColor: "rgba(0,0,0,0.55)",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 6,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}>
                  TAP TO VIEW
                </Text>
              </View>
            )}
          </Pressable>

          <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
            <View
              style={{
                height: 60,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
              }}
            >
              <Pressable
                onPress={() => router.back()}
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
              <View pointerEvents="none" style={{ flex: 1, alignItems: "center" }}>
                <Logo size="sm" />
              </View>
              <View style={{ width: 36 }} />
            </View>
          </SafeAreaView>

          <View style={{ position: "absolute", left: 16, bottom: 16, flexDirection: "row", gap: 6 }}>
            <Chip label={label} />
            {showOnYouChip && <Chip label="ON YOU" accent />}
            {showOnYouChip && <PoweredByChip />}
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
          {brand && (
            <Text
              style={{ color: theme.primary, fontSize: 11, letterSpacing: 1.8, fontWeight: "800" }}
              numberOfLines={1}
            >
              {brand.toUpperCase()}
            </Text>
          )}
          {name && (
            <Text
              style={{
                color: theme.fg,
                fontSize: 24,
                fontWeight: "800",
                marginTop: 5,
                letterSpacing: -0.6,
                lineHeight: 30,
              }}
              numberOfLines={3}
            >
              {name}
            </Text>
          )}

          <View style={{ marginTop: 24, gap: 10 }}>
            {state.kind === "failed" ? (
              <FailedCard
                message={state.message}
                onRetry={tryOn}
                onRetakePhoto={async () => {
                  const part = CATEGORY_TO_BODY_PART[category];
                  await clearBodyPhoto(part);
                  setState({ kind: "idle" });
                  tryOn();
                }}
                partLabel={PART_PROMPT[CATEGORY_TO_BODY_PART[category]].title.toLowerCase()}
              />
            ) : state.kind === "done" ? (
              <>
                {similar.length > 0 && (
                  <SimilarLooks
                    posts={similar}
                    onTap={(p) => router.push(`/product/${p.id}`)}
                  />
                )}
                <SaveLookButton
                  saved={saved}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    setSaved((s) => !s);
                  }}
                />
                <Pressable
                  onPress={tryOn}
                  hitSlop={10}
                  style={{ alignSelf: "center", marginTop: 2, paddingVertical: 6 }}
                >
                  <Text style={{ color: theme.fgSubtle, fontSize: 13, fontWeight: "600" }}>
                    Try again
                  </Text>
                </Pressable>
              </>
            ) : supported ? (
              <PrimaryButton
                label="Try OnMe"
                onPress={tryOn}
                disabled={isWorking}
              />
            ) : (
              <View
                style={{
                  padding: 16,
                  borderRadius: radius.lg,
                  backgroundColor: theme.bgSoft,
                  borderWidth: 1,
                  borderColor: theme.borderPink,
                }}
              >
                <Text
                  style={{
                    color: theme.primaryDeep,
                    fontSize: 10,
                    letterSpacing: 1.6,
                    fontWeight: "800",
                    marginBottom: 6,
                  }}
                >
                  HEADS UP
                </Text>
                <Text style={{ color: theme.fg, fontSize: 14, fontWeight: "700", lineHeight: 20 }}>
                  Try-on isn't supported for this category yet — you can still shop the real one.
                </Text>
              </View>
            )}
            {buyLink ? (
              <Pressable
                onPress={() => Linking.openURL(buyLink).catch(() => {})}
                style={({ pressed }) => ({
                  height: 54,
                  borderRadius: radius.lg,
                  backgroundColor: "rgba(255,122,175,0.10)",
                  borderWidth: 1.5,
                  borderColor: theme.borderPink,
                  alignItems: "center",
                  justifyContent: "center",
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text
                  style={{
                    color: theme.primaryDeep,
                    fontSize: 15,
                    fontWeight: "800",
                    letterSpacing: 0.2,
                  }}
                >
                  Shop the real one
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <FullscreenImageViewer
        visible={viewerOpen}
        imageUrl={state.kind === "done" ? state.resultUrl : ""}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
}

function decodeParam(v: string | string[] | undefined): string {
  if (!v) return "";
  const raw = Array.isArray(v) ? v[0] : v;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
        opacity: disabled ? 0.85 : 1,
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

function PoweredByChip() {
  return (
    <View
      style={{
        paddingHorizontal: 9,
        height: 24,
        borderRadius: radius.pill,
        backgroundColor: "rgba(0,0,0,0.55)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "rgba(255,255,255,0.95)",
          fontSize: 9,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          fontWeight: "800",
        }}
      >
        Powered by Perfect Corp
      </Text>
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

function RenderingOverlay({
  state,
  attempt,
}: {
  state: "preparing" | "rendering" | "capturing" | "refining";
  attempt?: number;
}) {
  const label =
    state === "preparing"
      ? "Preparing the product"
      : state === "capturing"
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
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
  }, [rot]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
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

function SimilarLooks({
  posts,
  onTap,
}: {
  posts: Post[];
  onTap: (post: Post) => void;
}) {
  return (
    <View style={{ marginTop: 4, marginBottom: 6 }}>
      <Text
        style={{
          color: theme.fg,
          fontSize: 14,
          fontWeight: "800",
          letterSpacing: -0.2,
          marginBottom: 10,
        }}
      >
        Similar Looks
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 4 }}
      >
        {posts.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => onTap(p)}
            style={({ pressed }) => ({
              width: 84,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <View
              style={{
                width: 84,
                height: 108,
                borderRadius: radius.md,
                overflow: "hidden",
                backgroundColor: theme.bgSoft,
              }}
            >
              {p.display_image_url || p.source_image_url ? (
                <Image
                  source={{ uri: p.display_image_url ?? p.source_image_url }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              ) : null}
            </View>
            <Text
              style={{
                color: theme.fg,
                fontSize: 11,
                fontWeight: "700",
                marginTop: 6,
                letterSpacing: -0.1,
              }}
              numberOfLines={1}
            >
              {p.product_name}
            </Text>
            {p.price_usd != null ? (
              <Text
                style={{
                  color: theme.fgSubtle,
                  fontSize: 10,
                  fontWeight: "700",
                  marginTop: 1,
                }}
              >
                {formatPrice(p.price_usd)}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function SaveLookButton({
  saved,
  onPress,
}: {
  saved: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 56,
        borderRadius: radius.lg,
        overflow: "hidden",
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...shadow.card,
      })}
    >
      <LinearGradient
        colors={[theme.primary, theme.primaryDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 15,
            fontWeight: "800",
            letterSpacing: 0.2,
          }}
        >
          {saved ? "Saved" : "Save Look"}
        </Text>
        <Ionicons name={saved ? "heart" : "heart-outline"} size={18} color="#fff" />
      </LinearGradient>
    </Pressable>
  );
}
