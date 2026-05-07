import { Image } from "expo-image";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { radius, shadow, theme } from "@/constants/theme";

export interface PhotoSheetAction {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
}

interface Props {
  visible: boolean;
  title: string;
  hint: string;
  example?: string;
  actions: PhotoSheetAction[];
  onClose: () => void;
}

// Soft, glassy bottom sheet. Replaces the dated system `Alert.alert`
// confirmations whenever we need a styled choice (e.g. "Open camera?",
// "Take photo / pick from library").
export function PhotoSheet({ visible, title, hint, example, actions, onClose }: Props) {
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
          backgroundColor: "rgba(44,24,32,0.42)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Animated.View
          entering={SlideInDown.duration(280).easing(Easing.out(Easing.cubic))}
          exiting={SlideOutDown.duration(200).easing(Easing.in(Easing.cubic))}
          style={{
            backgroundColor: theme.bgElevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 36,
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
              marginBottom: 18,
            }}
          />

          {example && (
            <Image
              source={{ uri: example }}
              style={{
                width: 92,
                height: 122,
                borderRadius: radius.md,
                marginBottom: 18,
                alignSelf: "center",
                ...shadow.soft,
              }}
              contentFit="cover"
            />
          )}

          <Text
            style={{
              color: theme.fg,
              fontSize: 26,
              fontWeight: "800",
              letterSpacing: -0.8,
              textAlign: "center",
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: theme.fgSubtle,
              fontSize: 14,
              marginTop: 8,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {hint}
          </Text>

          <View style={{ marginTop: 24, gap: 10 }}>
            {actions.map((a, i) => (
              <SheetButton key={i} {...a} />
            ))}
          </View>

          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={{ alignItems: "center", marginTop: 14, paddingVertical: 8 }}
          >
            <Text style={{ color: theme.fgSubtle, fontSize: 13, fontWeight: "600" }}>
              Cancel
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function SheetButton({ label, onPress, variant = "primary" }: PhotoSheetAction) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 56,
        borderRadius: radius.lg,
        backgroundColor: isPrimary ? theme.primary : "rgba(255,122,175,0.10)",
        borderWidth: isPrimary ? 0 : 1.5,
        borderColor: theme.borderPink,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...(isPrimary ? shadow.card : {}),
      })}
    >
      <Text
        style={{
          color: isPrimary ? "#fff" : theme.primaryDeep,
          fontSize: 15,
          fontWeight: "800",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
