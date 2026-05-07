import * as ImageManipulator from "expo-image-manipulator";

// Each strategy reshapes the source photo to coax YouCam into rendering
// successfully. Strategies are picked from the failure code/message + an
// optional GPT diagnosis between attempts.
export type MutationStrategy =
  | "zoomGentle"   // 90% center crop, upscale — body part slightly small
  | "zoomMedium"   // 75% center crop, upscale — body part moderately small
  | "zoomAggressive" // 60% center crop, upscale — body part very small
  | "padOut"       // resize to 80% — body part too close to edge
  | "padBig"       // resize to 70% — body part way too close to edge
  | "flipH";       // mirror horizontally — sometimes helps detection

export const ALL_STRATEGIES: MutationStrategy[] = [
  "zoomGentle",
  "zoomMedium",
  "zoomAggressive",
  "padOut",
  "padBig",
  "flipH",
];

// Default plan based purely on the failure signature. Callers can override
// individual passes with a GPT-diagnosed strategy.
export function planFromMessage(
  message: string,
  code?: string,
): MutationStrategy[] {
  const lower = message.toLowerCase();
  // Code 4 / "size out of range" / "hand size" → body part proportions wrong
  if (code === "4" || lower.includes("hand size") || lower.includes("framing")) {
    return ["zoomMedium", "padOut", "zoomAggressive", "padBig"];
  }
  // Code 2 / "not detected" → could go either way
  if (code === "2" || lower.includes("not detected") || lower.includes("spot")) {
    return ["padOut", "zoomMedium", "padBig", "flipH"];
  }
  // Face-specific failures → usually need more headroom or a flip
  if (lower.includes("face")) {
    return ["padOut", "zoomGentle", "flipH", "padBig"];
  }
  // "too small" / low-res → we can't add pixels but cropping puts the body
  // part on more pixels relative to the frame; YouCam often re-accepts.
  if (lower.includes("too small") || lower.includes("low-res")) {
    return ["zoomMedium", "zoomAggressive"];
  }
  // Default — try the safest first, then more aggressive.
  return ["zoomGentle", "padOut", "zoomMedium", "padBig"];
}

interface SourceMeta {
  width: number;
  height: number;
}

async function probe(uri: string): Promise<SourceMeta> {
  const result = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { width: result.width, height: result.height };
}

async function centerCrop(
  uri: string,
  meta: SourceMeta,
  ratio: number,
): Promise<string> {
  const cropW = Math.floor(meta.width * ratio);
  const cropH = Math.floor(meta.height * ratio);
  const originX = Math.floor((meta.width - cropW) / 2);
  const originY = Math.floor((meta.height - cropH) / 2);
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [
      { crop: { originX, originY, width: cropW, height: cropH } },
      { resize: { width: meta.width, height: meta.height } },
    ],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

async function shrink(uri: string, meta: SourceMeta, ratio: number): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: Math.floor(meta.width * ratio), height: Math.floor(meta.height * ratio) } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

async function flipH(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ flip: ImageManipulator.FlipType.Horizontal }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

export async function mutate(uri: string, strategy: MutationStrategy): Promise<string> {
  const meta = await probe(uri);
  switch (strategy) {
    case "zoomGentle":
      return centerCrop(uri, meta, 0.9);
    case "zoomMedium":
      return centerCrop(uri, meta, 0.75);
    case "zoomAggressive":
      return centerCrop(uri, meta, 0.6);
    case "padOut":
      return shrink(uri, meta, 0.8);
    case "padBig":
      return shrink(uri, meta, 0.7);
    case "flipH":
      return flipH(uri);
  }
}
