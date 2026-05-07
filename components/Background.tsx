import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { View } from "react-native";
import { theme } from "@/constants/theme";

// Near-white canvas with a barely-there blush kiss in the top-left. Used to
// be a much heavier pink-to-cream gradient; we pulled it back so screens
// feel airy and the pink primary stays an accent, not a wash.
export function Background({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient
        colors={[theme.bgSoft, theme.bg, theme.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 0.5 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.5,
        }}
      />
      {children}
    </View>
  );
}
