import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { FullscreenImageViewer } from "@/components/FullscreenImageViewer";
import { Logo } from "@/components/Logo";
import { PhotoSheet } from "@/components/PhotoSheet";
import { radius, shadow, theme } from "@/constants/theme";
import { CATEGORY_LABEL, getPostById } from "@/lib/feed";
import { getAllBodyPhotos, saveBodyPhoto } from "@/lib/snap";
import { getTryOns, type TryOnEntry } from "@/lib/tryons";
import type { BodyPart } from "@/types";

interface PartConfig {
  part: BodyPart;
  title: string;
  hint: string;
  example: string;
  aspect: [number, number];
  front: boolean;
  categories: string;
}

const PARTS: PartConfig[] = [
  {
    part: "ear",
    title: "Face & ears",
    hint: "Front-facing, ears visible.",
    example:
      "https://plugins-media.makeupar.com/strapi/assets/earring_user_01_05727a3c72.png",
    aspect: [3, 4],
    front: true,
    categories: "earrings · hair color",
  },
  {
    part: "wrist",
    title: "Wrist",
    hint: "Bare wrist, palm down. No bracelets/watches.",
    example:
      "https://plugins-media.makeupar.com/strapi/assets/watch_and_bracelet_user_01_09f16603cb.png",
    aspect: [3, 4],
    front: false,
    categories: "watches · bracelets",
  },
  {
    part: "finger",
    title: "Hand",
    hint: "Open hand, fingers spread, no rings.",
    example:
      "https://plugins-media.makeupar.com/strapi/assets/ring_user_01_6d9893abd0.png",
    aspect: [3, 4],
    front: false,
    categories: "rings",
  },
  {
    part: "neck",
    title: "Neck",
    hint: "Collarbone visible, no necklace.",
    example:
      "https://plugins-media.makeupar.com/strapi/assets/necklace_user_01_ce1b7e81ec.png",
    aspect: [3, 4],
    front: true,
    categories: "necklaces",
  },
  {
    part: "body",
    title: "Full body",
    hint: "Stand back, full body in frame.",
    example:
      "https://plugins-media.makeupar.com/strapi/assets/clothes_01_10be1e1a9b.png",
    aspect: [3, 5],
    front: false,
    categories: "outfits",
  },
];

export default function PhotosScreen() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Partial<Record<BodyPart, string>>>({});
  const [working, setWorking] = useState<BodyPart | null>(null);
  const [tryOns, setTryOns] = useState<TryOnEntry[]>([]);
  const [sheetCfg, setSheetCfg] = useState<PartConfig | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [all, history] = await Promise.all([getAllBodyPhotos(), getTryOns()]);
    const map: Partial<Record<BodyPart, string>> = {};
    for (const part of Object.keys(all) as BodyPart[]) {
      const entry = all[part];
      if (entry?.localUri) map[part] = entry.localUri;
    }
    setPhotos(map);
    setTryOns(history);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh history every time the page gains focus so try-ons completed on
  // the product detail screen show up immediately when the user comes back.
  useFocusEffect(
    useCallback(() => {
      getTryOns().then(setTryOns);
    }, []),
  );

  const retake = useCallback(
    async (cfg: PartConfig) => {
      setWorking(cfg.part);
      try {
        // Wait out the PhotoSheet's slide-down so iOS can present the camera
        // modal cleanly. Skipping this leads to a camera that opens slowly
        // or silently no-ops.
        await new Promise((r) => setTimeout(r, 420));
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera permission needed", "Enable it in Settings.");
          return;
        }
        let res: ImagePicker.ImagePickerResult;
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
          console.warn("[camera] launch failed, falling back to library:", err);
          res = await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true,
            quality: 0.95,
            aspect: cfg.aspect,
          });
        }
        if (res.canceled || !res.assets[0]) return;
        const local = res.assets[0].uri;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await saveBodyPhoto(cfg.part, local);
        await refresh();
      } catch (err) {
        Alert.alert("Couldn't capture", String(err));
      } finally {
        setWorking(null);
      }
    },
    [refresh],
  );

  const pickFromLibrary = useCallback(
    async (cfg: PartConfig) => {
      setWorking(cfg.part);
      try {
        await new Promise((r) => setTimeout(r, 420));
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Photos permission needed", "Enable it in Settings.");
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          allowsEditing: true,
          quality: 0.95,
          aspect: cfg.aspect,
        });
        if (res.canceled || !res.assets[0]) return;
        const local = res.assets[0].uri;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await saveBodyPhoto(cfg.part, local);
        await refresh();
      } finally {
        setWorking(null);
      }
    },
    [refresh],
  );

  const onTap = (cfg: PartConfig) => setSheetCfg(cfg);

  const captured = Object.keys(photos).length;

  return (
    <Background>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
          <View
            style={{
              height: 60,
              marginBottom: 18,
              justifyContent: "center",
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
              }}
            >
              <Pressable
                onPress={() => router.back()}
                hitSlop={16}
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
                <Text style={{ color: theme.fg, fontSize: 18, fontWeight: "300", marginTop: -2 }}>
                  ‹
                </Text>
              </Pressable>
              <View style={{ width: 36 }} />
            </View>
          </View>

          <View style={{ marginBottom: 20, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text
                style={{
                  color: theme.primary,
                  fontSize: 11,
                  fontWeight: "800",
                  letterSpacing: 2.4,
                  textTransform: "uppercase",
                }}
              >
                YOUR KIT
              </Text>
              <View
                style={{
                  paddingHorizontal: 8,
                  height: 20,
                  borderRadius: radius.pill,
                  backgroundColor: theme.primarySoft,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: theme.primaryDeep,
                    fontSize: 9,
                    letterSpacing: 1.4,
                    fontWeight: "800",
                  }}
                >
                  {captured} / {PARTS.length}
                </Text>
              </View>
            </View>
            <Text
              style={{
                color: theme.fg,
                fontSize: 30,
                fontWeight: "800",
                letterSpacing: -1.2,
                marginTop: 4,
              }}
            >
              Photos that power try-on.
            </Text>
            <Text style={{ color: theme.fgSubtle, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
              Tap any to retake. Each one unlocks a category.
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 100, gap: 12 }}
          >
            {tryOns.length > 0 && (
              <TriedOnRail
                entries={tryOns}
                onTap={(e) => {
                  // Open fullscreen viewer with zoom + share. The result
                  // image is the previously-rendered try-on that we cached
                  // when it was first generated. Tapping a card immediately
                  // gives the user the "look at me" hero view instead of
                  // routing back to the product detail (which they've seen).
                  if (e.resultUrl) setViewerUrl(e.resultUrl);
                  else router.push(`/product/${e.postId}`);
                }}
              />
            )}
            {PARTS.map((cfg, i) => (
              <Animated.View
                key={cfg.part}
                entering={FadeInDown.delay(i * 35).duration(280)}
              >
                <PartRow
                  cfg={cfg}
                  photo={photos[cfg.part] ?? null}
                  busy={working === cfg.part}
                  onPress={() => onTap(cfg)}
                />
              </Animated.View>
            ))}
          </ScrollView>

          <PhotoSheet
            visible={!!sheetCfg}
            title={sheetCfg?.title ?? ""}
            hint={sheetCfg?.hint ?? ""}
            example={sheetCfg?.example}
            actions={
              sheetCfg
                ? [
                    {
                      label: "Take a new photo",
                      variant: "primary",
                      onPress: () => {
                        const cfg = sheetCfg;
                        setSheetCfg(null);
                        retake(cfg);
                      },
                    },
                    {
                      label: "Pick from photo library",
                      variant: "ghost",
                      onPress: () => {
                        const cfg = sheetCfg;
                        setSheetCfg(null);
                        pickFromLibrary(cfg);
                      },
                    },
                  ]
                : []
            }
            onClose={() => setSheetCfg(null)}
          />

          <View style={{ paddingTop: 8, paddingBottom: 8 }}>
            <Pressable
              onPress={() => router.replace("/feed")}
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
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.2 }}>
                Back to the feed
              </Text>
              <Text style={{ color: "#fff", fontSize: 14, opacity: 0.8 }}>›</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
      <BottomNav />
      <FullscreenImageViewer
        visible={!!viewerUrl}
        imageUrl={viewerUrl ?? ""}
        onClose={() => setViewerUrl(null)}
      />
    </Background>
  );
}

function PartRow({
  cfg,
  photo,
  busy,
  onPress,
}: {
  cfg: PartConfig;
  photo: string | null;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        borderRadius: radius.lg,
        backgroundColor: theme.bgElevated,
        borderWidth: 1,
        borderColor: photo ? theme.border : theme.borderPink,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadow.soft,
      })}
    >
      <View
        style={{
          width: 64,
          height: 84,
          borderRadius: radius.md,
          overflow: "hidden",
          backgroundColor: theme.bgSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <Image
            source={{ uri: cfg.example }}
            style={{ width: "100%", height: "100%", opacity: 0.55 }}
            contentFit="cover"
          />
        )}
        {busy && (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.7)",
            }}
          >
            <ActivityIndicator color={theme.primary} />
          </View>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: theme.fg, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 }}>
            {cfg.title}
          </Text>
          {photo ? <Tag label="SAVED" /> : <Tag label="MISSING" accent />}
        </View>
        <Text style={{ color: theme.primary, fontSize: 11, marginTop: 4, fontWeight: "700", letterSpacing: 0.4 }} numberOfLines={1}>
          For {cfg.categories}
        </Text>
        <Text
          style={{ color: theme.fgSubtle, fontSize: 11, marginTop: 4, lineHeight: 15 }}
          numberOfLines={2}
        >
          {cfg.hint}
        </Text>
      </View>

      <Text style={{ color: theme.muted, fontSize: 18, fontWeight: "300" }}>›</Text>
    </Pressable>
  );
}

function TriedOnRail({
  entries,
  onTap,
}: {
  entries: TryOnEntry[];
  onTap: (e: TryOnEntry) => void;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 4,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: theme.primary,
            fontSize: 11,
            fontWeight: "800",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          RECENTLY TRIED ON
        </Text>
        <Text style={{ color: theme.muted, fontSize: 11, fontWeight: "700" }}>
          {entries.length}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingHorizontal: 4, paddingRight: 16 }}
      >
        {entries.map((entry) => (
          <TriedOnCard key={entry.postId + entry.createdAt} entry={entry} onPress={() => onTap(entry)} />
        ))}
      </ScrollView>
    </View>
  );
}

function TriedOnCard({ entry, onPress }: { entry: TryOnEntry; onPress: () => void }) {
  const post = getPostById(entry.postId);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 124,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View
        style={{
          width: 124,
          height: 160,
          borderRadius: radius.lg,
          overflow: "hidden",
          backgroundColor: theme.bgSoft,
          ...shadow.soft,
        }}
      >
        <Image
          source={{ uri: entry.resultUrl }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={140}
        />
        <View
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            paddingHorizontal: 7,
            height: 20,
            borderRadius: radius.pill,
            backgroundColor: theme.primary,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 4,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 8 }}>✦</Text>
          <Text
            style={{
              color: "#fff",
              fontSize: 9,
              letterSpacing: 1.2,
              fontWeight: "800",
            }}
          >
            ON YOU
          </Text>
        </View>
      </View>
      <Text
        style={{ color: theme.primary, fontSize: 9, fontWeight: "800", letterSpacing: 1.2, marginTop: 8 }}
        numberOfLines={1}
      >
        {post ? post.brand.toUpperCase() : CATEGORY_LABEL.outfit.toUpperCase()}
      </Text>
      <Text
        style={{ color: theme.fg, fontSize: 12, fontWeight: "700", marginTop: 2 }}
        numberOfLines={1}
      >
        {post?.product_name ?? "Saved try-on"}
      </Text>
    </Pressable>
  );
}

function Tag({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        height: 20,
        borderRadius: radius.pill,
        backgroundColor: accent ? theme.primarySoft : theme.bgSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: accent ? theme.primaryDeep : theme.fgSubtle,
          fontSize: 9,
          letterSpacing: 1.2,
          fontWeight: "800",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
