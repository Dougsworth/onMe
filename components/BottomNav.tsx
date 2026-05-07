import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { usePathname, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, shadow, theme } from "@/constants/theme";

interface Tab {
  path: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive?: keyof typeof Ionicons.glyphMap;
  alsoActiveFor?: string[];
  // When set, the tab routes to `path + routeWith` and never highlights as
  // active. Used for the Bag tab, which opens a sheet on /feed via ?bag=1.
  routeWith?: string;
}

const TABS: Tab[] = [
  { path: "/feed", icon: "home-outline", iconActive: "home", alsoActiveFor: ["/product"] },
  { path: "/photos", icon: "shirt-outline", iconActive: "shirt" },
  // Index 2 = the raised center scan button. Always rendered as the camera.
  { path: "/scan", icon: "camera", alsoActiveFor: ["/tryon-real"] },
  { path: "/feed", icon: "bag-outline", iconActive: "bag", routeWith: "?bag=1" },
  { path: "/settings", icon: "person-outline", iconActive: "person", alsoActiveFor: ["/legal"] },
];

// Persistent bottom navigation — banner-style: 5 line icons with a raised
// pink camera button at the center. Sits above the home indicator via
// SafeAreaView insets.
export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: Math.max(insets.bottom, 12),
        paddingHorizontal: 18,
        paddingTop: 18,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          alignSelf: "stretch",
          height: 60,
          backgroundColor: "rgba(255,255,255,0.98)",
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 18,
          ...shadow.card,
        }}
      >
        {TABS.map((t, i) => {
          const isCenter = i === 2;
          const matchPaths = [t.path, ...(t.alsoActiveFor ?? [])];
          const active =
            !t.routeWith &&
            matchPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

          if (isCenter) {
            return (
              <Pressable
                key="scan-center"
                hitSlop={10}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  router.push(t.path as never);
                }}
                style={({ pressed }) => ({
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  backgroundColor: theme.primary,
                  alignItems: "center",
                  justifyContent: "center",
                  // Lift the center button above the pill so it reads as the
                  // primary action.
                  marginTop: -28,
                  borderWidth: 4,
                  borderColor: "#fff",
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                  ...shadow.card,
                })}
              >
                <Ionicons name="camera" size={26} color="#fff" />
              </Pressable>
            );
          }

          const iconName = active ? (t.iconActive ?? t.icon) : t.icon;
          return (
            <Pressable
              key={`${t.path}-${i}`}
              hitSlop={10}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                const target = t.routeWith ? `${t.path}${t.routeWith}` : t.path;
                router.push(target as never);
              }}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons
                name={iconName}
                size={24}
                color={active ? theme.primary : theme.fgSubtle}
              />
              {active && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 4,
                    width: 18,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: theme.primary,
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
