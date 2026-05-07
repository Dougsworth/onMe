import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useEffect } from "react";
import { Alert, Dimensions, Modal, Pressable, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { radius, shadow, theme } from "@/constants/theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const MIN_SCALE = 1;
const MAX_SCALE = 5;

interface Props {
  visible: boolean;
  imageUrl: string;
  onClose: () => void;
}

// Full-bleed image viewer for rendered try-on results. Pinch-to-zoom,
// double-tap to zoom, drag-to-pan when zoomed, drag-down-to-dismiss when at
// rest, plus a share button and a save-to-camera-roll button.
export function FullscreenImageViewer({ visible, imageUrl, onClose }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Reset transforms when the modal closes so reopening starts fresh.
  useEffect(() => {
    if (!visible) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
    }
  }, [visible, scale, savedScale, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Snap back to 1 if the user pinched smaller than 1 (won't happen with
      // our min clamp but defensive in case clamp logic changes).
      if (scale.value < 1.05) {
        scale.value = withSpring(1);
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Only pan when zoomed in. When at scale 1, drag-down dismisses.
      if (scale.value <= 1.02) {
        if (e.translationY > 0) ty.value = e.translationY;
      } else {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value <= 1.02) {
        // Dismiss if dragged down far enough; otherwise snap back.
        if (e.translationY > 100) {
          ty.value = withTiming(SCREEN_H, { duration: 200 }, () => {
            runOnJS(onClose)();
          });
        } else {
          ty.value = withSpring(0);
        }
      } else {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.02) {
        scale.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
        tx.value = withTiming(0, { duration: 220 });
        ty.value = withTiming(0, { duration: 220 });
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2.5, { duration: 220, easing: Easing.out(Easing.cubic) });
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const onShare = async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const localPath = `${FileSystem.cacheDirectory}share-${Date.now()}.jpg`;
      const dl = await FileSystem.downloadAsync(imageUrl, localPath);
      if (dl.status !== 200) throw new Error(`download failed (${dl.status})`);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing not available", "Try a different device.");
        return;
      }
      await Sharing.shareAsync(dl.uri, { mimeType: "image/jpeg" });
    } catch (err) {
      Alert.alert("Couldn't share", err instanceof Error ? err.message : String(err));
    }
  };

  const onSave = async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Photos permission needed", "Enable it in Settings to save.");
        return;
      }
      const localPath = `${FileSystem.cacheDirectory}save-${Date.now()}.jpg`;
      const dl = await FileSystem.downloadAsync(imageUrl, localPath);
      if (dl.status !== 200) throw new Error(`download failed (${dl.status})`);
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert("Saved", "Added to your camera roll.");
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(180)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)" }}
        >
          <GestureDetector gesture={composed}>
            <Animated.View
              style={[
                {
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                },
                imageStyle,
              ]}
            >
              <Image
                source={{ uri: imageUrl }}
                style={{ width: SCREEN_W, height: SCREEN_H }}
                contentFit="contain"
              />
            </Animated.View>
          </GestureDetector>

          {/* Top chrome — close button. */}
          <SafeAreaView edges={["top"]} pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 16 }}>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "rgba(255,255,255,0.18)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "300", marginTop: -2 }}>✕</Text>
              </Pressable>
            </View>
          </SafeAreaView>

          {/* Bottom chrome — share + save. */}
          <SafeAreaView edges={["bottom"]} pointerEvents="box-none" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, padding: 20 }}>
              <ActionPill label="Share" onPress={onShare} />
              <ActionPill label="Save to photos" onPress={onSave} />
            </View>
            <Text
              style={{
                color: "rgba(255,255,255,0.55)",
                fontSize: 11,
                textAlign: "center",
                paddingBottom: 8,
                letterSpacing: 0.4,
              }}
            >
              Pinch to zoom · double-tap · drag down to close
            </Text>
          </SafeAreaView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ActionPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 44,
        paddingHorizontal: 22,
        borderRadius: radius.pill,
        backgroundColor: "rgba(255,255,255,0.95)",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
        ...shadow.card,
      })}
    >
      <Text style={{ color: theme.fg, fontSize: 14, fontWeight: "800", letterSpacing: 0.4 }}>
        {label}
      </Text>
    </Pressable>
  );
}
