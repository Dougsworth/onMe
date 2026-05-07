import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { radius, shadow, theme } from "@/constants/theme";
import { CATEGORY_LABEL, formatPrice, getPostById } from "@/lib/feed";
import {
  type BagItem,
  clearBag,
  getBag,
  removeFromBag,
  setQty,
} from "@/lib/bag";

const SHEET_H = Dimensions.get("window").height * 0.86;

interface Props {
  visible: boolean;
  onClose: () => void;
}

type FlowState = "shop" | "placed";

export function BagSheet({ visible, onClose }: Props) {
  const [items, setItems] = useState<BagItem[]>([]);
  const [flow, setFlow] = useState<FlowState>("shop");

  const refresh = useCallback(async () => {
    setItems(await getBag());
  }, []);

  useEffect(() => {
    if (visible) {
      setFlow("shop");
      refresh();
    }
  }, [refresh, visible]);

  const subtotal = items.reduce((sum, item) => {
    const post = getPostById(item.postId);
    return sum + (post?.price_usd ?? 0) * item.qty;
  }, 0);

  const handleQty = async (postId: string, next: number) => {
    await setQty(postId, next);
    await refresh();
  };

  const handleRemove = async (postId: string) => {
    await removeFromBag(postId);
    await refresh();
  };

  const handleCheckout = async () => {
    if (items.length === 0) return;
    setFlow("placed");
    await clearBag();
    await refresh();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={{
          flex: 1,
          backgroundColor: "rgba(44,24,32,0.45)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Animated.View
          entering={SlideInDown.duration(280).easing(Easing.out(Easing.cubic))}
          exiting={SlideOutDown.duration(200).easing(Easing.in(Easing.cubic))}
          style={{
            height: SHEET_H,
            backgroundColor: theme.bgElevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            ...shadow.card,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 44,
              height: 5,
              borderRadius: radius.pill,
              backgroundColor: theme.borderStrong,
              marginTop: 12,
              marginBottom: 8,
            }}
          />

          {flow === "placed" ? (
            <PlacedScreen onClose={onClose} />
          ) : (
            <ShopScreen
              items={items}
              subtotal={subtotal}
              onQty={handleQty}
              onRemove={handleRemove}
              onCheckout={handleCheckout}
              onClose={onClose}
            />
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function ShopScreen({
  items,
  subtotal,
  onQty,
  onRemove,
  onCheckout,
  onClose,
}: {
  items: BagItem[];
  subtotal: number;
  onQty: (postId: string, qty: number) => void;
  onRemove: (postId: string) => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const empty = items.length === 0;
  const itemsCount = items.reduce((s, i) => s + i.qty, 0);
  const shipping = empty ? 0 : 12;
  const total = subtotal + shipping;

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <View>
          <Text
            style={{
              color: theme.primary,
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            YOUR BAG
          </Text>
          <Text
            style={{
              color: theme.fg,
              fontSize: 24,
              fontWeight: "800",
              letterSpacing: -0.6,
              marginTop: 2,
            }}
          >
            {empty ? "Empty" : `${itemsCount} item${itemsCount === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            backgroundColor: theme.bgSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.fg, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: 16,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        {empty ? (
          <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 32 }}>
            <Text
              style={{
                color: theme.primary,
                fontSize: 38,
                marginBottom: 14,
              }}
            >
              ♡
            </Text>
            <Text
              style={{
                color: theme.fg,
                fontSize: 17,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              No items saved yet.
            </Text>
            <Text
              style={{
                color: theme.fgSubtle,
                fontSize: 13,
                marginTop: 6,
                textAlign: "center",
                lineHeight: 19,
              }}
            >
              Try things on, then add the loves to checkout.
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <BagRow
              key={item.postId}
              item={item}
              onInc={() => onQty(item.postId, item.qty + 1)}
              onDec={() => onQty(item.postId, item.qty - 1)}
              onRemove={() => onRemove(item.postId)}
            />
          ))
        )}
      </ScrollView>

      {!empty && (
        <View
          style={{
            paddingHorizontal: 22,
            paddingTop: 16,
            paddingBottom: 28,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            backgroundColor: theme.bgElevated,
          }}
        >
          <Row label="Subtotal" value={formatPrice(subtotal)} />
          <Row label="Shipping" value={formatPrice(shipping)} muted />
          <View style={{ height: 8 }} />
          <Row label="Total" value={formatPrice(total)} bold />
          <Pressable
            onPress={onCheckout}
            style={({ pressed }) => ({
              height: 58,
              borderRadius: radius.lg,
              backgroundColor: theme.primary,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              marginTop: 16,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              ...shadow.card,
            })}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 16,
                fontWeight: "800",
                letterSpacing: 0.2,
              }}
            >
              Checkout · {formatPrice(total)}
            </Text>
          </Pressable>
          <Text
            style={{
              color: theme.muted,
              fontSize: 11,
              textAlign: "center",
              marginTop: 12,
              letterSpacing: 0.4,
            }}
          >
            Demo mode · no charge processed
          </Text>
        </View>
      )}
    </View>
  );
}

function BagRow({
  item,
  onInc,
  onDec,
  onRemove,
}: {
  item: BagItem;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
}) {
  const post = getPostById(item.postId);
  if (!post) return null;
  const lineTotal = (post.price_usd ?? 0) * item.qty;
  const displayUri = post.display_image_url ?? post.source_image_url;
  const isHair = post.category === "hair" && post.palette_hex;

  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 12,
        borderRadius: radius.lg,
        backgroundColor: theme.bgWash,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View
        style={{
          width: 64,
          height: 84,
          borderRadius: radius.md,
          overflow: "hidden",
          backgroundColor: isHair ? post.palette_hex : theme.bgSoft,
        }}
      >
        {!isHair && (
          <Image
            source={{ uri: displayUri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        )}
      </View>

      <View style={{ flex: 1, justifyContent: "space-between" }}>
        <View>
          <Text
            style={{
              color: theme.primary,
              fontSize: 9,
              fontWeight: "800",
              letterSpacing: 1.4,
            }}
          >
            {post.brand.toUpperCase()} · {CATEGORY_LABEL[post.category].toUpperCase()}
          </Text>
          <Text
            style={{
              color: theme.fg,
              fontSize: 14,
              fontWeight: "700",
              letterSpacing: -0.2,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {post.product_name}
          </Text>
          <Text style={{ color: theme.fg, fontSize: 13, fontWeight: "700", marginTop: 4 }}>
            {formatPrice(lineTotal)}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: theme.bgElevated,
              borderRadius: radius.pill,
              paddingHorizontal: 4,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <QtyButton label="−" onPress={onDec} />
            <Text style={{ color: theme.fg, fontSize: 13, fontWeight: "800", minWidth: 18, textAlign: "center" }}>
              {item.qty}
            </Text>
            <QtyButton label="+" onPress={onInc} />
          </View>
          <Pressable onPress={onRemove} hitSlop={8}>
            <Text style={{ color: theme.fgSubtle, fontSize: 11, fontWeight: "700" }}>Remove</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function QtyButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: theme.primary, fontSize: 16, fontWeight: "800", marginTop: -1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 4,
      }}
    >
      <Text
        style={{
          color: muted ? theme.muted : theme.fgSubtle,
          fontSize: bold ? 14 : 13,
          fontWeight: bold ? "800" : "600",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: bold ? theme.fg : muted ? theme.muted : theme.fgSubtle,
          fontSize: bold ? 16 : 13,
          fontWeight: bold ? "800" : "700",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function PlacedScreen({ onClose }: { onClose: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 36,
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: theme.primarySoft,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 22,
        }}
      >
        <Text style={{ color: theme.primaryDeep, fontSize: 44 }}>✦</Text>
      </View>
      <Text
        style={{
          color: theme.fg,
          fontSize: 28,
          fontWeight: "800",
          letterSpacing: -0.8,
          textAlign: "center",
        }}
      >
        Order placed.
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
        You'll get a tracking link as soon as it ships.{"\n"}Demo mode — no charge was processed.
      </Text>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => ({
          marginTop: 28,
          height: 54,
          width: "100%",
          borderRadius: radius.lg,
          backgroundColor: theme.primary,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed ? 0.97 : 1 }],
          ...shadow.card,
        })}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 }}>
          Back to feed
        </Text>
      </Pressable>
    </View>
  );
}
