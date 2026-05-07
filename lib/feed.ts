import type { Category, Post } from "@/types";

// Fallback YouCam test product images per category — used when a seed
// doesn't have a catalog-specific URL in CATALOG_TRYON_URLS below.
const FALLBACK_PRODUCT_IMG: Record<Exclude<Category, "hair">, string> = {
  watch:
    "https://plugins-media.makeupar.com/strapi/assets/watch_product_01_aab8053028.png",
  ring:
    "https://plugins-media.makeupar.com/strapi/assets/ring_product_01_9a4d0680f2.png",
  necklace:
    "https://plugins-media.makeupar.com/strapi/assets/necklace_product_01_124206cfbe.png",
  earring:
    "https://plugins-media.makeupar.com/strapi/assets/earring_product_01_41c943f9fc.png",
  bracelet:
    "https://plugins-media.makeupar.com/strapi/assets/bracelet_product_01_5d90b684ce.png",
  outfit:
    "https://plugins-media.makeupar.com/strapi/assets/clothes_reference_full_body_01_8190f45a28.png",
};

// Per-seed try-on reference image (sent to YouCam as `ref_file_url`).
// These are the Unsplash catalog photos rehosted on Supabase — YouCam can
// fetch them, whereas it can't reach images.unsplash.com directly.
// Built one-time by /tmp/build_clean_catalog.py; keyed by `<category>-<idx>`.
const CATALOG_TRYON_URLS: Record<string, string> = {
  "watch-0":    "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295929-ce5326.jpg",
  "watch-1":    "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295963-vgtsqv.jpg",
  "watch-2":    "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295959-fojgvs.jpg",
  "watch-3":    "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295999-zw6vg8.jpg",
  "watch-4":    "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295952-kx0fj1.jpg",
  "ring-0":     "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295935-duawbw.jpg",
  "ring-1":     "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295967-at2v4n.jpg",
  "necklace-0": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141295989-jwwd1m.jpg",
  "necklace-1": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141296860-b80m1n.jpg",
  "necklace-2": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141296959-nk84bh.jpg",
  "necklace-3": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141296975-bdt8qs.jpg",
  "necklace-4": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297002-p9tpck.jpg",
  "earring-0":  "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297067-uierna.jpg",
  "earring-1":  "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297131-0lxfy6.jpg",
  "bracelet-0": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297235-6j50is.jpg",
  "bracelet-1": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297462-7ke49y.jpg",
  "bracelet-2": "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297926-ccwwi1.jpg",
  "outfit-0":   "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141297899-t9yn7d.jpg",
  "outfit-1":   "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141298035-rrf352.jpg",
  "outfit-2":   "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141298083-qx9kqn.jpg",
  "outfit-3":   "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141298111-hjwnit.jpg",
  "outfit-4":   "https://yzzkuexsttkycwrmutaj.supabase.co/storage/v1/object/public/selfies/1778141298238-2ivywo.jpg",
};

function tryOnImage(category: Exclude<Category, "hair">, idx: number): string {
  return CATALOG_TRYON_URLS[`${category}-${idx}`] ?? FALLBACK_PRODUCT_IMG[category];
}

// Hand-curated Unsplash product imagery — each ID was downloaded and
// visually verified to be a real catalog/lifestyle shot of the named
// category (no random Flickr stand-ins). Index N pairs with seed N below;
// when a list is shorter than its seed list, extra seeds fall back to the
// YouCam clean product reference (which is also a real product photo).
const CATEGORY_IMAGES: Record<Exclude<Category, "hair">, string[]> = {
  watch: [
    "1523275335684-37898b6baf30", // white minimalist smartwatch on light gray
    "1524592094714-0f0654e20314", // rose-gold dress watch with leather strap
    "1548171915-e79a380a2a4b",    // sport chrono with orange bezel on black
    "1620625515032-6ed0c1790c75", // datejust-style two-tone on warm wood
    "1551816230-ef5deaed4a26",    // black smartwatch with apps on magazine
  ],
  ring: [
    "1605100804763-247f67b3557e", // engagement halo ring on black jewelry box
    "1633934542430-0905ccb5f050", // hands wearing layered rings (lifestyle)
  ],
  necklace: [
    "1602173574767-37ac01994b2a", // chunky gold chain on a magazine spread
    "1515562141207-7a88fb7ce338", // pearl strand in red velvet box
    "1599643478518-a784e5dc4c8f", // layered crystal + crescent pendants
    "1611652022419-a9419f74343d", // woman wearing layered chains (lifestyle)
    "1610694955371-d4a3e0ce4b52", // gold marble rectangle pendant
  ],
  earring: [
    "1535632787350-4e68ef0ac584", // crystal drop earrings lined on pink
    "1601121141461-9d6647bca1ed", // antique gold + garnet earring + necklace set
  ],
  bracelet: [
    "1573408301185-9146fe634ad0", // diamond tennis bracelet on black, sparkle
    "1611591437281-460bfbe1220a", // rose-gold pavé bracelet on pink
    "1583292650898-7d22cd27ca6f", // gold + copper bangle stack (lifestyle)
  ],
  outfit: [
    "1515886657613-9f3515b0c78f", // yellow cropped hoodie + sweatpants set
    "1496747611176-843222e1e57c", // floral wrap dress at the seaside
    "1542295669297-4d352b042bca", // red mini slip dress with floral print
    "1483985988355-763728e1935b", // burgundy double-breasted coat, shopping
    "1539109136881-3be0616acf4b", // cerulean belted trench in Milan plaza
  ],
};

function displayImage(
  category: Exclude<Category, "hair">,
  idx: number,
): string | undefined {
  const id = CATEGORY_IMAGES[category][idx];
  if (!id) return undefined;
  // `auto=format,compress` lets Unsplash pick webp where supported.
  return `https://images.unsplash.com/photo-${id}?w=800&q=80&auto=format,compress`;
}

// Hair "products" are color stories. The display image is a transparent 1x1
// — the tile renders a custom swatch in the palette color so the catalog
// looks designed, not stock-y.
const HAIR_SWATCH_PLACEHOLDER =
  "https://plugins-media.makeupar.com/strapi/assets/necklace_user_01_ce1b7e81ec.png";

interface Seed {
  brand: string;
  name: string;
  caption?: string;
  // Repeats for variety in masonry layout.
  aspect: number;
  // Whole USD; hair seeds skip this since they're preview-only.
  price?: number;
  // Hex color, only set on hair seeds.
  paletteHex?: string;
}

// Brand + product names are paired to the first N curated images so the
// listing reads like a real catalog (no rose-gold watch labelled "Solar
// Sand"). Seeds beyond the curated count fall back to the YouCam clean
// product reference.
const SEEDS: Record<Category, Seed[]> = {
  watch: [
    { brand: "Maison Verre", name: "Atlas 40 White", caption: "Minimalist quartz, sapphire crystal.", aspect: 1.0, price: 295 },
    { brand: "Atelier Onze", name: "Rose Bleu Auto", caption: "Rose-gold case, calf leather strap.", aspect: 0.85, price: 620 },
    { brand: "Northshore Co.", name: "Diver 42 Chrono", caption: "Steel chronograph · 200m water-rated.", aspect: 0.78, price: 480 },
    { brand: "Course Athletic", name: "Heritage Bicolor 36", caption: "Two-tone bracelet, sapphire dial.", aspect: 0.92, price: 540 },
    { brand: "Plein Air", name: "Pulse Black 44", caption: "Smart fitness, 7-day battery.", aspect: 0.7, price: 215 },
  ],
  ring: [
    { brand: "Atelier Onze", name: "Solitaire Halo 1.0ct", caption: "Conflict-free brilliant cut, halo set.", aspect: 1.05, price: 1280 },
    { brand: "Aureate", name: "Stacker Trio", caption: "Three thin bands · 14k yellow gold.", aspect: 0.95, price: 320 },
    { brand: "Form & Cast", name: "Bevel Band 9k", caption: "Brushed yellow gold, 4mm.", aspect: 0.8, price: 245 },
    { brand: "Course Athletic", name: "Knot Sterling", caption: "Hand-finished sterling silver.", aspect: 0.75, price: 145 },
    { brand: "Maison Verre", name: "Wave Half-Band", caption: "Stackable · 18k yellow gold.", aspect: 0.88, price: 410 },
  ],
  necklace: [
    { brand: "Maison Verre", name: "Chain 18k Box", caption: "1.6mm box link, 18\".", aspect: 0.85, price: 420 },
    { brand: "Atelier Onze", name: "Pearl Strand", caption: "Single-strand freshwater · 16\".", aspect: 0.88, price: 295 },
    { brand: "Aureate", name: "Layered Crystal", caption: "Two-strand · crystal + crescent.", aspect: 1.0, price: 245 },
    { brand: "Form & Cast", name: "Rope 14k Matte", caption: "Brushed gold, lobster clasp.", aspect: 0.74, price: 365 },
    { brand: "Plein Air", name: "Marble Pendant", caption: "White howlite, gold-fill chain.", aspect: 0.92, price: 165 },
  ],
  earring: [
    { brand: "Aureate", name: "Drop Crystal Trio", caption: "Hypoallergenic posts, three-stone drop.", aspect: 0.7, price: 180 },
    { brand: "Maison Verre", name: "Garnet Antique Set", caption: "Vintage gold setting, garnet center.", aspect: 0.82, price: 420 },
    { brand: "Atelier Onze", name: "Pearl Stud 7mm", caption: "Single freshwater pearl.", aspect: 0.76, price: 78 },
    { brand: "Course Athletic", name: "Cuff Sterling", caption: "No piercing — adjustable cuff.", aspect: 0.88, price: 89 },
    { brand: "Form & Cast", name: "Geo Triangle", caption: "Architectural stud, brushed.", aspect: 1.05, price: 145 },
  ],
  bracelet: [
    { brand: "Aureate", name: "Diamond Tennis", caption: "1.5ctw lab-grown · sterling.", aspect: 0.94, price: 580 },
    { brand: "Maison Verre", name: "Rose Pavé", caption: "Rose gold pavé, butterfly clasp.", aspect: 0.78, price: 365 },
    { brand: "Aureate", name: "Liquid Bangle Stack", caption: "Three brushed bangles, 18mm.", aspect: 1.0, price: 225 },
    { brand: "Plein Air", name: "Cord Wrap", caption: "Cotton + brass detail.", aspect: 0.72, price: 65 },
    { brand: "Course Athletic", name: "Curb 14k 8mm", caption: "Heavy curb chain · 7.5\".", aspect: 0.85, price: 395 },
  ],
  outfit: [
    { brand: "Course Athletic", name: "Sun Tracksuit Set", caption: "Cropped hoodie + jogger · butter yellow.", aspect: 0.7, price: 235 },
    { brand: "Plein Air", name: "Bloom Wrap Dress", caption: "Linen-blend · floral · midi.", aspect: 0.66, price: 285 },
    { brand: "Aureate", name: "Slip Dress Crimson", caption: "Bias-cut viscose, micro-print.", aspect: 0.72, price: 180 },
    { brand: "Maison Verre", name: "Wool Trench Burgundy", caption: "Italian wool, double-breasted.", aspect: 0.65, price: 680 },
    { brand: "Atelier Onze", name: "Belted Coat Cerulean", caption: "Belted A-line · cashmere blend.", aspect: 0.7, price: 540 },
  ],
  hair: [
    { brand: "Petal Studio", name: "Cherry Blossom", caption: "Soft rose all-over.", aspect: 0.92, paletteHex: "#FF7AAF" },
    { brand: "Petal Studio", name: "Lavender Milk", caption: "Pastel violet wash.", aspect: 0.78, paletteHex: "#B5A0F2" },
    { brand: "Petal Studio", name: "Peach Soda", caption: "Warm sun-kissed copper.", aspect: 0.88, paletteHex: "#FFB098" },
    { brand: "Salon Nine", name: "Honey Gold", caption: "Sweet caramel balayage.", aspect: 0.96, paletteHex: "#E8B05A" },
    { brand: "Salon Nine", name: "Cocoa Noir", caption: "Deep espresso brown.", aspect: 0.74, paletteHex: "#3D2419" },
  ],
};

function buildPosts(): Post[] {
  const posts: Post[] = [];
  const cats = Object.keys(SEEDS) as Category[];
  const created = new Date().toISOString();
  for (const cat of cats) {
    SEEDS[cat].forEach((seed, i) => {
      const isHair = cat === "hair";
      posts.push({
        id: `${cat}-${i}`,
        user_id: "seed",
        category: cat,
        source_image_url: isHair ? HAIR_SWATCH_PLACEHOLDER : tryOnImage(cat, i),
        display_image_url: isHair ? undefined : displayImage(cat, i),
        product_name: seed.name,
        brand: seed.brand,
        product_url: null,
        caption: seed.caption ?? null,
        aspect_ratio: seed.aspect,
        palette_hex: seed.paletteHex,
        price_usd: seed.price,
        created_at: created,
      });
    });
  }
  return interleave(posts, cats.length);
}

function interleave(posts: Post[], stride: number): Post[] {
  const out: Post[] = [];
  const buckets: Post[][] = Array.from({ length: stride }, () => []);
  for (const p of posts) {
    const idx = (Object.keys(SEEDS) as Category[]).indexOf(p.category);
    buckets[idx].push(p);
  }
  let cursor = 0;
  while (out.length < posts.length) {
    const b = buckets[cursor % stride];
    const next = b.shift();
    if (next) out.push(next);
    cursor += 1;
  }
  return out;
}

const POSTS = buildPosts();

export async function getFeed(): Promise<Post[]> {
  return POSTS;
}

export function getPostById(id: string): Post | null {
  return POSTS.find((p) => p.id === id) ?? null;
}

export function getRelated(post: Post, limit = 8): Post[] {
  return POSTS.filter((p) => p.category === post.category && p.id !== post.id).slice(0, limit);
}

export function formatPrice(usd: number): string {
  return `$${usd.toLocaleString("en-US")}`;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  watch: "Watch",
  ring: "Ring",
  necklace: "Necklace",
  earring: "Earring",
  bracelet: "Bracelet",
  outfit: "Outfit",
  hair: "Hair",
};
