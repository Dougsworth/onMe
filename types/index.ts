export type Category =
  | "watch"
  | "ring"
  | "necklace"
  | "earring"
  | "bracelet"
  | "outfit";

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
  source_image_url: string;
  product_name: string;
  product_url: string | null;
  caption: string | null;
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

export const CATEGORY_TO_BODY_PART: Record<Category, BodyPart> = {
  watch: "wrist",
  bracelet: "wrist",
  ring: "finger",
  necklace: "neck",
  earring: "ear",
  outfit: "body",
};
