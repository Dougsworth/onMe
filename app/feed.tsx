import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Dimensions, Pressable, ScrollView, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Background } from "@/components/Background";
import { BagSheet } from "@/components/BagSheet";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { radius, shadow, theme } from "@/constants/theme";
import { bagCount } from "@/lib/bag";
import { formatPrice, getFeed } from "@/lib/feed";
import { loadCops, recordCop, removeCop } from "@/lib/persistence";
import { getUserPhoto } from "@/lib/snap";
import type { Category, Post } from "@/types";

const { width: SCREEN_W } = Dimensions.get("window");
const COL_GAP = 14;
const SIDE_PAD = 18;
const COL_WIDTH = (SCREEN_W - SIDE_PAD * 2 - COL_GAP) / 2;

// Categories shown in the browse chip rail. "all" sentinel keeps the chip set
// stable while letting Tile filter receive a real Category union elsewhere.
type ChipKey = "all" | Category;
const BROWSE_CHIPS: { key: ChipKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "outfit", label: "Outfits" },
  { key: "hair", label: "Hair" },
  { key: "watch", label: "Watches" },
  { key: "necklace", label: "Necklaces" },
  { key: "ring", label: "Rings" },
  { key: "earring", label: "Earrings" },
  { key: "bracelet", label: "Bracelets" },
];

export default function FeedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bag?: string }>();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [bagOpen, setBagOpen] = useState(false);
  const [bagN, setBagN] = useState(0);
  const [activeChip, setActiveChip] = useState<ChipKey>("all");

  // BottomNav's bag tab navigates to /feed?bag=1 to open the bag sheet.
  // Open it once, then strip the param so subsequent focuses don't reopen.
  useEffect(() => {
    if (params.bag === "1") {
      setBagOpen(true);
      router.replace("/feed");
    }
  }, [params.bag, router]);

  useEffect(() => {
    (async () => {
      const [feed, photo, cops, count] = await Promise.all([
        getFeed(),
        getUserPhoto(),
        loadCops(),
        bagCount(),
      ]);
      setPosts(feed);
      setUserPhoto(photo);
      setSavedIds(cops);
      setBagN(count);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadCops(), getUserPhoto(), bagCount()]).then(
        ([cops, photo, count]) => {
          setSavedIds(cops);
          setUserPhoto(photo);
          setBagN(count);
        },
      );
    }, []),
  );

  // When the bag closes, the count may have changed (checkout clears it).
  useEffect(() => {
    if (!bagOpen) bagCount().then(setBagN);
  }, [bagOpen]);

  const onToggleSave = useCallback(async (post: Post) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(post.id)) {
        next.delete(post.id);
        void removeCop(post.id);
      } else {
        next.add(post.id);
        void recordCop(post.id);
      }
      return next;
    });
  }, []);

  if (!posts) {
    return (
      <Background>
        <FeedSkeleton />
      </Background>
    );
  }

  const filtered = activeChip === "all" ? posts : posts.filter((p) => p.category === activeChip);
  const colA: Post[] = [];
  const colB: Post[] = [];
  filtered.forEach((p, i) => {
    if (i % 2 === 0) colA.push(p);
    else colB.push(p);
  });

  return (
    <Background>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: 110,
          paddingBottom: 110,
        }}
      >
        <Header />
        <CategoryRail active={activeChip} onChange={setActiveChip} />
        <View style={{ paddingHorizontal: SIDE_PAD, flexDirection: "row", gap: COL_GAP }}>
          <Column
            posts={colA}
            savedIds={savedIds}
            onTap={(p) => router.push(`/product/${p.id}`)}
            onToggleSave={onToggleSave}
          />
          <Column
            posts={colB}
            savedIds={savedIds}
            onTap={(p) => router.push(`/product/${p.id}`)}
            onToggleSave={onToggleSave}
          />
        </View>
        {filtered.length === 0 && (
          <View style={{ alignItems: "center", paddingTop: 56, paddingHorizontal: 32 }}>
            <Text style={{ color: theme.fgSubtle, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
              Nothing in this category yet — scan a video to add the first piece.
            </Text>
          </View>
        )}
      </ScrollView>

      <TopBar
        userPhoto={userPhoto}
        bagCount={bagN}
        onBack={() => router.replace("/")}
        onProfile={() => router.push("/photos")}
        onBag={() => setBagOpen(true)}
        onScan={() => router.push("/scan")}
      />
      <BagSheet visible={bagOpen} onClose={() => setBagOpen(false)} />
      <BottomNav />
    </Background>
  );
}

function Header() {
  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      style={{ marginBottom: 14, paddingHorizontal: SIDE_PAD }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LiveDot />
        <Text
          style={{
            color: theme.primary,
            fontSize: 10,
            fontWeight: "800",
            letterSpacing: 2.2,
            textTransform: "uppercase",
          }}
        >
          Today's drop
        </Text>
      </View>
      <Text
        style={{
          color: theme.fg,
          fontSize: 26,
          fontWeight: "800",
          letterSpacing: -0.9,
          marginTop: 6,
          lineHeight: 30,
        }}
      >
        Shop the look.
      </Text>
    </Animated.View>
  );
}

function CategoryRail({
  active,
  onChange,
}: {
  active: ChipKey;
  onChange: (k: ChipKey) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: SIDE_PAD,
        gap: 8,
        paddingBottom: 14,
      }}
      style={{ marginBottom: 4 }}
    >
      {BROWSE_CHIPS.map((c) => {
        const on = active === c.key;
        return (
          <Pressable
            key={c.key}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(c.key);
            }}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              height: 34,
              borderRadius: radius.pill,
              backgroundColor: on ? theme.fg : theme.bgElevated,
              borderWidth: 1,
              borderColor: on ? theme.fg : theme.border,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                color: on ? "#fff" : theme.fg,
                fontSize: 13,
                fontWeight: on ? "700" : "600",
                letterSpacing: -0.1,
              }}
            >
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function LiveDot() {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.3, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        { width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.primary },
        style,
      ]}
    />
  );
}

function Column({
  posts,
  savedIds,
  onTap,
  onToggleSave,
}: {
  posts: Post[];
  savedIds: Set<string>;
  onTap: (p: Post) => void;
  onToggleSave: (p: Post) => void;
}) {
  return (
    <View style={{ flex: 1, gap: COL_GAP + 6 }}>
      {posts.map((p, i) => (
        <Animated.View
          key={p.id}
          entering={FadeInDown.delay(i * 28).duration(280)}
        >
          <Tile
            post={p}
            saved={savedIds.has(p.id)}
            onPress={() => onTap(p)}
            onToggleSave={() => onToggleSave(p)}
          />
        </Animated.View>
      ))}
    </View>
  );
}

function Tile({
  post,
  saved,
  onPress,
  onToggleSave,
}: {
  post: Post;
  saved: boolean;
  onPress: () => void;
  onToggleSave: () => void;
}) {
  const height = COL_WIDTH / post.aspect_ratio;
  const isHair = post.category === "hair" && post.palette_hex;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: COL_WIDTH,
        opacity: pressed ? 0.96 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View
        style={{
          width: "100%",
          height,
          borderRadius: radius.lg,
          overflow: "hidden",
          backgroundColor: isHair ? post.palette_hex : theme.bgSoft,
        }}
      >
        {isHair ? (
          <HairSwatch hex={post.palette_hex!} name={post.product_name} />
        ) : (
          <Image
            source={{ uri: post.display_image_url ?? post.source_image_url }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={120}
            recyclingKey={post.id}
            cachePolicy="memory-disk"
          />
        )}
        <Pressable
          onPress={onToggleSave}
          hitSlop={10}
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: saved ? theme.primary : "rgba(255,255,255,0.96)",
            alignItems: "center",
            justifyContent: "center",
            ...shadow.soft,
          }}
        >
          <Text
            style={{
              color: saved ? "#fff" : theme.fg,
              fontSize: 16,
              marginTop: 1,
            }}
          >
            {saved ? "♥" : "♡"}
          </Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 2, paddingTop: 10 }}>
        <Text
          style={{
            color: theme.fg,
            fontSize: 14,
            fontWeight: "600",
            lineHeight: 18,
            letterSpacing: -0.15,
          }}
          numberOfLines={2}
        >
          {post.product_name}
        </Text>
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            fontWeight: "500",
            marginTop: 4,
            letterSpacing: -0.05,
          }}
          numberOfLines={1}
        >
          {post.brand}
        </Text>
        {post.price_usd != null && (
          <Text
            style={{
              color: theme.fg,
              fontSize: 14,
              fontWeight: "800",
              marginTop: 6,
              letterSpacing: -0.2,
            }}
          >
            {formatPrice(post.price_usd)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function HairSwatch({ hex, name }: { hex: string; name: string }) {
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={[lighten(hex, 0.18), hex, darken(hex, 0.18)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, padding: 16, justifyContent: "space-between" }}
      >
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 8,
            height: 22,
            borderRadius: radius.pill,
            backgroundColor: "rgba(255,255,255,0.9)",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: hex,
              fontSize: 9,
              letterSpacing: 1.6,
              fontWeight: "800",
            }}
          >
            HAIR
          </Text>
        </View>
        <Text
          style={{
            color: "#fff",
            fontSize: 22,
            fontWeight: "800",
            letterSpacing: -0.6,
            lineHeight: 26,
            textShadowColor: "rgba(0,0,0,0.18)",
            textShadowRadius: 6,
            textShadowOffset: { width: 0, height: 1 },
          }}
        >
          {name}
        </Text>
      </LinearGradient>
    </View>
  );
}

function TopBar({
  userPhoto,
  bagCount: bagN,
  onBack,
  onProfile,
  onBag,
  onScan,
}: {
  userPhoto: string | null;
  bagCount: number;
  onBack: () => void;
  onProfile: () => void;
  onBag: () => void;
  onScan: () => void;
}) {
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
          paddingHorizontal: SIDE_PAD,
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

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={onScan} hitSlop={8}>
          <View
            style={{
              paddingHorizontal: 12,
              height: 36,
              borderRadius: radius.md,
              backgroundColor: theme.primary,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 5,
              ...shadow.card,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }}>
              SCAN
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={onBag} hitSlop={8}>
          <View
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
            <Text style={{ fontSize: 15, color: theme.fg }}>♥</Text>
            {bagN > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 5,
                  borderRadius: 9,
                  backgroundColor: theme.primary,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: theme.bg,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: "800",
                    letterSpacing: 0.2,
                  }}
                >
                  {bagN}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

        <Pressable onPress={onProfile} hitSlop={8}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.md,
              backgroundColor: theme.bgElevated,
              borderWidth: 1.5,
              borderColor: theme.borderPink,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              ...shadow.soft,
            }}
          >
            {userPhoto ? (
              <Image
                source={{ uri: userPhoto }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
              />
            ) : (
              <Text style={{ color: theme.primary, fontSize: 16, fontWeight: "700" }}>+</Text>
            )}
          </View>
        </Pressable>
      </View>
    </View>
    </View>
  );
}

function FeedSkeleton() {
  // Lay out shimmering placeholder cards in two columns so the first frame
  // hints at the masonry rhythm rather than flashing empty cream.
  const heights = [180, 220, 160, 240, 200, 180];
  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: 110,
        paddingBottom: 36,
        paddingHorizontal: SIDE_PAD,
      }}
      pointerEvents="none"
    >
      <View style={{ marginBottom: 18 }}>
        <View
          style={{
            width: 90,
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.bgSoft,
          }}
        />
        <View
          style={{
            width: 200,
            height: 24,
            borderRadius: 8,
            backgroundColor: theme.bgSoft,
            marginTop: 10,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
        {[60, 80, 70, 90].map((w, i) => (
          <View
            key={i}
            style={{
              width: w,
              height: 34,
              borderRadius: radius.pill,
              backgroundColor: theme.bgSoft,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: COL_GAP }}>
        {[0, 1].map((col) => (
          <View key={col} style={{ flex: 1, gap: COL_GAP + 6 }}>
            {heights
              .filter((_, i) => i % 2 === col)
              .map((h, i) => (
                <View
                  key={i}
                  style={{
                    width: COL_WIDTH,
                    height: h,
                    borderRadius: radius.lg,
                    backgroundColor: theme.bgSoft,
                  }}
                />
              ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// Light/dark a hex color by mixing with white/black. Used so hair swatch
// gradients have depth without needing to hand-author 3 colors per palette.
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

