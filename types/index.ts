export type Category =
  | "watch"
  | "ring"
  | "necklace"
  | "earring"
  | "bracelet"
  | "outfit"
  | "hair";

export type BodyPart = "wrist" | "neck" | "finger" | "ear" | "body";

export type BodyPhotos = Partial<Record<BodyPart, string>>;

export interface User {
  id: string;
  handle: string;
  profile_pic: string | null;
  body_photos: BodyPhotos;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  category: Category;
  // Sent to YouCam as `ref_file_url` for visual categories. For "hair" the
  // try-on uses palette_hex instead and source_image_url is just a thumbnail.
  source_image_url: string;
  // What the grid + detail hero shows. Defaults to source_image_url; override
  // to give the catalog visual variety without breaking try-on.
  display_image_url?: string;
  // Hex color used for hair-color try-on (only set when category === "hair").
  palette_hex?: string;
  product_name: string;
  brand: string;
  product_url: string | null;
  caption: string | null;
  // Tile width/height ratio in the masonry grid.
  aspect_ratio: number;
  // Whole USD. Hair posts are previews — no price.
  price_usd?: number;
  created_at: string;
}

export type Vote = "cop" | "drop";

export interface TryOn {
  id: string;
  user_id: string;
  post_id: string;
  result_image_url: string | null;
  vote: Vote | null;
  created_at: string;
}

export interface VoteRecord {
  id: string;
  user_id: string;
  post_id: string;
  vote: Vote;
  created_at: string;
}

// Hair recolors operate on the face/ear shot — same selfie, different output.
export const CATEGORY_TO_BODY_PART: Record<Category, BodyPart> = {
  watch: "wrist",
  bracelet: "wrist",
  ring: "finger",
  necklace: "neck",
  earring: "ear",
  outfit: "body",
  hair: "ear",
};
