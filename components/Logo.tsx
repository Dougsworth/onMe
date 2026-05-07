import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import WORDMARK from "../assets/images/wordmark.png";

// Source is 1536x1024 → 3:2.
const ASPECT = 1.5;

const HEIGHTS: Record<"sm" | "md" | "lg" | "xl" | "xxl", number> = {
  sm: 60,
  md: 110,
  lg: 170,
  xl: 240,
  xxl: 320,
};

interface Props {
  size?: "sm" | "md" | "lg" | "xl" | "xxl";
  style?: ViewStyle;
  // When true, a soft pink shimmer sweeps across the wordmark on a slow loop.
  // Use on the landing hero; leave off in toolbars where it'd be busy.
  shimmer?: boolean;
}

export function Logo({ size = "md", style, shimmer = false }: Props) {
  const h = HEIGHTS[size];
  const w = h * ASPECT;
  return (
    <View style={[{ alignItems: "center" }, style]}>
      <View style={{ width: w, height: h, overflow: "hidden" }}>
        <Image
          source={WORDMARK}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
        />
        {shimmer && <Shimmer width={w} height={h} />}
      </View>
    </View>
  );
}

// Gentle rose-tinted glow that breathes (opacity 0 → 0.18 → 0) over the
// wordmark on a slow loop. No translating rectangle, no visible edges —
// just a soft sheen that comes and goes.
function Shimmer({ width, height }: { width: number; height: number }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.18, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", top: 0, left: 0, width, height },
        style,
      ]}
    >
      <LinearGradient
        colors={["rgba(246,165,184,0)", "rgba(246,165,184,1)", "rgba(246,165,184,0)"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}
