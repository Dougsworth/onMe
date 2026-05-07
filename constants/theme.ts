// OnMe — boutique palette pulled from the wordmark's warm brown silhouettes.
// Cream canvas + soft rose primary + warm brown text. Light, polished, less
// "neon nightclub", more "hand-picked storefront".
//
// User-supplied palette spec:
//   Background:      #FFF7F2
//   Cards/Sections:  #FCE8EE
//   Main Buttons:    #F27FA3
//   Button Text:     #FFFFFF
//   Logo/Text:       #7A4A3A | #2B1712
//   Soft Highlights: #F6A5B8

export const theme = {
  // Near-white cream canvas — pulled almost flat-white so pink reads as
  // accent, not the dominant note. Was #FFF7F2 (warmer cream).
  bg: "#FDFAF8",
  bgElevated: "#FFFFFF",
  // Card / section surface — barely-there pink hint. Was #FCE8EE (much pinker).
  bgSoft: "#FBF0F3",
  // Subtle band / press state. Was #FFF2F7.
  bgWash: "#FCF6F8",

  // Body text — warm dark brown, matches logo silhouettes.
  fg: "#2B1712",
  // Secondary text — same family, lighter.
  fgSubtle: "#7A4A3A",
  // Muted captions, footnotes, subtle metadata.
  muted: "#A48F84",

  // Borders barely there; warm brown rather than black so they belong on cream.
  border: "rgba(43,23,18,0.07)",
  borderStrong: "rgba(43,23,18,0.14)",
  borderPink: "rgba(242,127,163,0.32)",

  // Primary heartbeat — softer rose, not neon.
  primary: "#F27FA3",
  primaryDeep: "#D26385",
  primaryDarker: "#9E3F5E",
  // Soft pink highlight — chips, light-fill buttons, accents.
  primarySoft: "#F6A5B8",
  // Pinker mist for very subtle backgrounds inside cards.
  primaryMist: "#FCE8EE",
  primaryRgb: "242,127,163",

  // Lavender accent — sparingly.
  lavender: "#C29DFB",
  lavenderSoft: "#EADCFF",

  // Warm peach for save/streak moments.
  peach: "#FFB098",
  peachSoft: "#FFE2D7",

  // Sparkle / highlight gold (kept for accent variety, used minimally).
  gold: "#F4D08A",
} as const;

// Generous, candy-rounded corners.
export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

// Springs — kept for haptic reactions (heart punch). Page-level transitions
// use eased timings now, not springs, so the app feels less bouncy.
export const spring = {
  gentle: { damping: 18, stiffness: 130, mass: 1 },
  bouncy: { damping: 12, stiffness: 160, mass: 1 },
  pop: { damping: 9, stiffness: 220, mass: 0.8 },
} as const;

// Soft pink-tinted drop shadow for primary CTAs and elevated cards.
export const shadow = {
  card: {
    shadowColor: "#F27FA3",
    shadowOpacity: 0.20,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  soft: {
    shadowColor: "#2B1712",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;
