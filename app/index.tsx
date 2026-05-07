import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);
import { Logo } from "@/components/Logo";
import { radius, spring, theme } from "@/constants/theme";

export default function LandingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 28,
            paddingTop: 16,
            paddingBottom: 32,
            justifyContent: "center",
          }}
        >
          <Hero />
          <Footer />
        </View>
      </SafeAreaView>
    </View>
  );
}

function Hero() {
  const router = useRouter();
  const enter = useEnter(120);
  // The pink "you" IS the CTA. Tapping it fires the same navigation that
  // the dedicated "Show me on me" button used to. The underline + arrow
  // pointing at it (CurvyArrow below) signal that it's interactive.
  const onYouPress = () => {
    router.push("/feed");
  };
  return (
    <Animated.View style={[{ alignItems: "center" }, enter]}>
      <Sparkle />
      <Logo size="xxl" />
      <View style={{ marginTop: 28, alignItems: "center", position: "relative" }}>
        <Text
          style={{
            color: theme.fg,
            fontSize: 44,
            fontWeight: "800",
            letterSpacing: -2.0,
            textAlign: "center",
            lineHeight: 48,
          }}
        >
          See it on{" "}
          <Text
            onPress={onYouPress}
            suppressHighlighting={false}
            style={{
              color: theme.primary,
              textDecorationLine: "underline",
              textDecorationColor: theme.primary,
              textDecorationStyle: "solid",
            }}
          >
            you
          </Text>
          <Text style={{ color: theme.fg }}>.</Text>
        </Text>
        {/* Arrow positioned absolutely so its tip lands directly under the
            "you" word — visually anchors attention to the CTA. */}
        <CurvyArrow />
      </View>
      <Text
        style={{
          color: theme.fgSubtle,
          fontSize: 14,
          marginTop: 22,
          letterSpacing: 0.1,
          textAlign: "center",
          lineHeight: 21,
        }}
      >
        Watches, rings, fits, hair —{"\n"}rendered on the actual you in seconds.
      </Text>
      <LiveTicker />
    </Animated.View>
  );
}

function Footer() {
  const enter = useEnter(260);
  return (
    <Animated.View style={[{ alignItems: "center", marginTop: 36 }, enter]}>
      <Text
        style={{
          color: theme.muted,
          fontSize: 11,
          textAlign: "center",
          letterSpacing: 0.5,
        }}
      >
        Tap "you" to begin · Powered by Perfect Corp
      </Text>
    </Animated.View>
  );
}

// Hand-drawn-feel curvy arrow that loops up from below-right of the
// headline and points its tip at the pink "you". Animated stroke "draws
// in" on mount via stroke-dashoffset, then a subtle wobble adds life.
function CurvyArrow() {
  // Total path length is the perimeter of the curve + arrowhead lines.
  // We pre-measured roughly so we can run a stroke-dashoffset draw-in.
  const PATH_LEN = 180;
  const draw = useSharedValue(PATH_LEN);
  const wobble = useSharedValue(0);

  useEffect(() => {
    draw.value = withDelay(
      280,
      withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
    wobble.value = withDelay(
      1200,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [draw, wobble]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(wobble.value, [0, 1], [-2, 2])}deg` },
    ],
  }));
  const animatedPathProps = useAnimatedProps(() => ({
    strokeDashoffset: draw.value,
  }));

  // The headline "See it on you." is centered. "you" sits at roughly
  // 60-65% across the headline. We position the arrow absolutely with
  // its tip at the top center of the SVG, then nudge horizontally so the
  // tip lands right under the "you" word.
  const SVG_W = 90;
  const SVG_H = 60;
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 50, // headline lineHeight is 48 → place just under it
          left: "55%", // ~where "you" sits horizontally on a centered line
          marginLeft: -SVG_W / 2 + 8, // center SVG on that anchor, fudge right toward "you"
          width: SVG_W,
          height: SVG_H,
        },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      <Svg width={SVG_W} height={SVG_H} viewBox="0 0 90 60">
        {/* Tip at top-center pointing UP at "you". Tail curves down-right
            with a hand-drawn S-shape. */}
        <AnimatedPath
          d="M 45 6 C 30 18, 75 28, 60 56"
          stroke={theme.primary}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={PATH_LEN}
          animatedProps={animatedPathProps}
        />
        {/* Arrowhead: two short marks fanning out from the tip (45, 6)
            downward — the directions the curve approached from. */}
        <AnimatedPath
          d="M 45 6 L 38 13 M 45 6 L 52 13"
          stroke={theme.primary}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={PATH_LEN}
          animatedProps={animatedPathProps}
        />
      </Svg>
    </Animated.View>
  );
}

// Tiny 4-point sparkle above the wordmark — two crossed pink bars that
// breathe (scale + opacity) on a slow loop. Replaces the old shimmer glow:
// gives the hero something alive to look at without painting a faint
// background wash over the entire logo.
function Sparkle() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.45, 1]),
    transform: [
      { scale: interpolate(t.value, [0, 1], [0.85, 1.1]) },
      { rotate: `${interpolate(t.value, [0, 1], [0, 45])}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        { width: 22, height: 22, marginBottom: 14, alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      <View
        style={{
          position: "absolute",
          width: 22,
          height: 3,
          borderRadius: 2,
          backgroundColor: theme.primary,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 3,
          height: 22,
          borderRadius: 2,
          backgroundColor: theme.primary,
        }}
      />
    </Animated.View>
  );
}

// Faux live counter beneath the hero — gives the page a "this is happening
// right now" pulse so the user feels they're entering an active feed.
function LiveTicker() {
  const dot = useSharedValue(0.4);
  useEffect(() => {
    dot.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.4, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [dot]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 22,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: theme.bgElevated,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Animated.View
        style={[
          {
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: theme.primary,
          },
          dotStyle,
        ]}
      />
      <Text
        style={{
          color: theme.fgSubtle,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.5,
        }}
      >
        Live · in beta
      </Text>
    </View>
  );
}

function useEnter(delay: number) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }),
    );
    translateY.value = withDelay(delay, withSpring(0, spring.gentle));
  }, [delay, opacity, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

