// Reel/video generator -- item 3. Upload furniture photos, pick a promo
// tag, get bilingual (EN/ES) captions via the same Anthropic call pattern
// drafter.ts already uses, and a real generated video via fal.ai using the
// same two-call shape (submit -> poll status -> fetch result) proven live
// in kostya-studio and igor-hq/worker/main.ts's Listing-to-video route.
// A furniture showroom photo is usable as-is (no hand-modeling stage
// needed), so this is the single-stage pipeline.
//
// Gated on FAL_KEY: if unset, generateReelVideo() returns a clear
// {configured:false} result instead of failing the whole request, same
// graceful-fallback pattern as Twilio/Square/QuickBooks in
// feliks-valet-cockpit/worker/main.ts.

import { kvGet, kvSet, nanoid } from "./kv.ts";
import { getEnv } from "./env.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";
const FAL_KEY = (): string => getEnv("FAL_KEY") ?? "";
const FAL_VIDEO_APP = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const FAL_TEXT_VIDEO_APP = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";
const REEL_JOB_TTL_MS = 60 * 60 * 1000;
const RES = "reel_jobs";

export interface PromoTag {
  id: string;
  label_en: string;
  label_es: string;
}

// Starter list -- matches the theme ids already wired into docs/index.html
// (REEL_THEMES + I18N theme_* strings), so the existing UI needs no
// changes to call the real backend.
export const PROMO_TAGS: PromoTag[] = [];
PROMO_TAGS.push({ id: "memorial_day", label_en: "Memorial Day Sale", label_es: "Venta del Dia de los Caidos" });
PROMO_TAGS.push({ id: "july4", label_en: "4th of July", label_es: "4 de Julio" });
PROMO_TAGS.push({ id: "summer", label_en: "Summer Blowout", label_es: "Liquidacion de Verano" });
PROMO_TAGS.push({ id: "back_school", label_en: "Back to School", label_es: "Regreso a Clases" });
PROMO_TAGS.push({ id: "labor_day", label_en: "Labor Day", label_es: "Dia del Trabajo" });
PROMO_TAGS.push({ id: "blackfri", label_en: "Black Friday", label_es: "Viernes Negro" });
PROMO_TAGS.push({ id: "xmas", label_en: "Christmas", label_es: "Navidad" });
PROMO_TAGS.push({ id: "no_credit", label_en: "No Credit Needed", label_es: "No Se Necesita Credito" });
PROMO_TAGS.push({ id: "tx_pride", label_en: "Texas Pride", label_es: "Orgullo de Texas" });
PROMO_TAGS.push({ id: "mothers", label_en: "Mothers Day", label_es: "Dia de las Madres" });
PROMO_TAGS.push({ id: "clearance", label_en: "Floor Model Clearance", label_es: "Liquidacion de Modelos de Piso" });
PROMO_TAGS.push({ id: "new_arrival", label_en: "New Arrival", label_es: "Recien Llegado" });

export interface CaptionResult {
  en: string;
  es: string;
}

// Bilingual caption generation -- same Anthropic Messages API call shape
// as lib/drafter.ts's draftReply(), reused here against a different prompt.
export async function generateCaptions(
  theme: string,
  userScript: string,
  productName?: string,
): Promise<CaptionResult> {
  const key = getEnv("ANTHROPIC_KEY");
  if (!key) throw new Error("ANTHROPIC_KEY not set");
  const tag = PROMO_TAGS.find((t) => t.id === theme);
  const promoLabel = tag ? tag.label_en : theme;
  const sys = "You write short (2-3 sentence) FB/IG/TikTok reel captions for 210 Discount Furniture, Furniture and Mattress Warehouse in San Antonio TX. Warm, direct, no emojis, ends with a foot-traffic CTA -- come by today, Mon-Sat 9am-7pm, phone 210-712-4700. Mention no-credit-needed financing if the promo is financing-adjacent. Return STRICT JSON with exactly two string keys: en (the English caption) and es (a natural Spanish rewrite, not a literal translation). No prose outside the JSON.";
  const userMsg = "Promo tag: " + promoLabel + (productName ? "\nFeatured item: " + productName : "") + "\nSellers draft script or notes: " + (userScript || "none supplied, write from the promo tag alone") + "\n\nReturn the JSON caption pair now.";
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: sys,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error("Anthropic " + res.status + ": " + await res.text());
  const data = await res.json();
  const raw = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Caption generation did not return parseable JSON");
    return JSON.parse(match[0]);
  }
}

// fal.ai queue API -- submit/status/result, same three-call shape as
// igor-hq/worker/main.ts's falSubmit/falStatus/falResult.
async function falSubmit(appId: string, input: Record<string, unknown>): Promise<{ request_id: string; status_url: string; response_url: string }> {
  const res = await fetch("https://queue.fal.run/" + appId, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Key " + FAL_KEY() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("fal submit failed (" + res.status + ")");
  return res.json();
}
async function falStatus(statusUrl: string): Promise<{ status: string }> {
  const res = await fetch(statusUrl, { headers: { authorization: "Key " + FAL_KEY() } });
  if (!res.ok) throw new Error("fal status check failed (" + res.status + ")");
  return res.json();
}
// deno-lint-ignore no-explicit-any
async function falResult(responseUrl: string): Promise<any> {
  const res = await fetch(responseUrl, { headers: { authorization: "Key " + FAL_KEY() } });
  if (!res.ok) throw new Error("fal result fetch failed (" + res.status + ")");
  return res.json();
}

// ── Clip stitching -- real N-clip concatenation into one continuous video ───
// Kling caps every single generation at 10s (fal's own published schema:
// enum values 5/10, no higher option). A genuinely longer video needs
// multiple separate generations stitched end to end via fal-ai/ffmpeg-api/
// compose -- ONE video track with sequential keyframes (increasing
// timestamps), not the simultaneous-tracks-at-timestamp-0 shape used for a
// logo overlay elsewhere in this portfolio (see igor-hq/worker/main.ts's
// kostyaSubmitBranding for that other shape). Built 2026-09-14 for the
// Oxana (Bread by Oxana) proposal's "3x 30-second video" ask.
const FAL_COMPOSE_APP = "fal-ai/ffmpeg-api/compose";
export interface StitchJob {
  stage: "pending" | "done" | "error";
  statusUrl?: string;
  responseUrl?: string;
  videoUrl?: string;
  error?: string;
  createdAt: number;
}
const STITCH_RES = "stitch_jobs";
export async function startStitchJob(videoUrls: string[]): Promise<string> {
  if (videoUrls.length < 2) throw new Error("stitch needs at least 2 video URLs");
  const jobId = nanoid();
  const clipDurationMs = 10_000;
  const submitted = await falSubmit(FAL_COMPOSE_APP, {
    tracks: [
      {
        id: "video",
        type: "video",
        keyframes: videoUrls.map((url, i) => ({ timestamp: i * clipDurationMs, duration: clipDurationMs, url })),
      },
    ],
  });
  const job: StitchJob = { stage: "pending", statusUrl: submitted.status_url, responseUrl: submitted.response_url, createdAt: Date.now() };
  await kvSet(STITCH_RES, jobId, job, REEL_JOB_TTL_MS);
  return jobId;
}
export async function advanceStitchJob(jobId: string): Promise<StitchJob | null> {
  const job = await kvGet<StitchJob>(STITCH_RES, jobId);
  if (!job || job.stage === "done" || job.stage === "error") return job;
  try {
    const s = await falStatus(job.statusUrl!);
    if (s.status === "COMPLETED") {
      const result = await falResult(job.responseUrl!);
      // fal-ai/ffmpeg-api/compose's real output schema is flat ({video_url,
      // thumbnail_url}), NOT the nested {video:{url}} shape the Kling
      // generation and audio-merge apps return -- confirmed against fal's
      // own published API docs after a real job returned "no video URL"
      // with the nested-shape assumption. Different app, different schema;
      // don't assume all fal.ai video-producing apps share one response shape.
      const videoUrl = result?.video_url;
      if (!videoUrl) throw new Error("Stitch completed but returned no video URL (raw result: " + JSON.stringify(result).slice(0, 300) + ")");
      job.videoUrl = videoUrl;
      job.stage = "done";
    } else if (s.status === "ERROR" || s.status === "FAILED") {
      job.stage = "error";
      job.error = "Stitch failed on fal.ai's side.";
    }
    await kvSet(STITCH_RES, jobId, job, REEL_JOB_TTL_MS);
  } catch (e) {
    job.stage = "error";
    job.error = e instanceof Error ? e.message : String(e);
    await kvSet(STITCH_RES, jobId, job, REEL_JOB_TTL_MS);
  }
  return job;
}

const REEL_VIDEO_PROMPT =
  "Slow, subtle cinematic pan and gentle zoom across this furniture showroom photo, as if a professional product videographer shot it. No fast movement, no camera shake, no distortion of the furniture.";

export interface ReelJob {
  stage: "video_pending" | "done" | "error";
  theme: string;
  captions?: CaptionResult;
  videoStatusUrl?: string;
  videoResponseUrl?: string;
  videoUrl?: string;
  error?: string;
  createdAt: number;
}

export interface ReelStartResult {
  configured: boolean;
  jobId?: string;
  captions?: CaptionResult;
  message: string;
}

// Generates bilingual captions unconditionally (Anthropic call, already
// live via drafter.ts pattern), then starts the fal.ai video job only if
// FAL_KEY() is configured -- graceful partial success instead of an
// all-or-nothing failure, same fallback pattern as Twilio/Square/
// QuickBooks in feliks-valet-cockpit/worker/main.ts.
export async function startReel(
  imageDataUrl: string,
  theme: string,
  userScript: string,
  productName?: string,
): Promise<ReelStartResult> {
  const captions = await generateCaptions(theme, userScript, productName);
  if (!FAL_KEY()) {
    return {
      configured: false,
      captions,
      message: "Captions generated. Video generation is not connected yet -- this deployment is missing its FAL_KEY() environment variable (see docs/AD-ROI-SETUP.md sibling docs for the pattern; FAL_KEY() setup itself is a one-line fal.ai dashboard key). Captions can still be copied and posted manually.",
    };
  }
  const submitted = await falSubmit(FAL_VIDEO_APP, {
    prompt: REEL_VIDEO_PROMPT,
    image_url: imageDataUrl,
    duration: "5",
  });
  const jobId = nanoid();
  const job: ReelJob = {
    stage: "video_pending",
    theme,
    captions,
    videoStatusUrl: submitted.status_url,
    videoResponseUrl: submitted.response_url,
    createdAt: Date.now(),
  };
  await kvSet(RES, jobId, job, REEL_JOB_TTL_MS);
  return { configured: true, jobId, captions, message: "Captions generated, video rendering started." };
}

// Ad-hoc single-shot video generation with a caller-supplied prompt/duration,
// bypassing the fixed REEL_VIDEO_PROMPT/5s furniture defaults above. Reuses
// the same RES job store and ReelJob shape so the existing advanceReel()
// polling logic works unchanged -- only the submission differs.
export async function startCustomVideo(
  imageUrl: string,
  prompt: string,
  duration: "5" | "10" = "10",
): Promise<{ jobId: string }> {
  const submitted = await falSubmit(FAL_VIDEO_APP, {
    prompt,
    image_url: imageUrl,
    duration,
  });
  const jobId = nanoid();
  const job: ReelJob = {
    stage: "video_pending",
    theme: "custom",
    videoStatusUrl: submitted.status_url,
    videoResponseUrl: submitted.response_url,
    createdAt: Date.now(),
  };
  await kvSet(RES, jobId, job, REEL_JOB_TTL_MS);
  return { jobId };
}

// Generic (no-face) demo clips -- text-to-video, not tied to any real
// person's photo/likeness. Used for capability-example content where we
// don't have real footage of the actual action yet.
export async function startTextVideo(
  prompt: string,
  duration: "5" | "10" = "10",
): Promise<{ jobId: string }> {
  const submitted = await falSubmit(FAL_TEXT_VIDEO_APP, {
    prompt,
    duration,
  });
  const jobId = nanoid();
  const job: ReelJob = {
    stage: "video_pending",
    theme: "custom-text",
    videoStatusUrl: submitted.status_url,
    videoResponseUrl: submitted.response_url,
    createdAt: Date.now(),
  };
  await kvSet(RES, jobId, job, REEL_JOB_TTL_MS);
  return { jobId };
}

export async function advanceReel(jobId: string): Promise<ReelJob | null> {
  const job = await kvGet<ReelJob>(RES, jobId);
  if (!job || job.stage === "done" || job.stage === "error") return job;
  try {
    if (job.stage === "video_pending") {
      const s = await falStatus(job.videoStatusUrl!);
      if (s.status === "COMPLETED") {
        const result = await falResult(job.videoResponseUrl!);
        const videoUrl = result?.video?.url;
        if (!videoUrl) throw new Error("Video stage completed but returned no video URL");
        job.videoUrl = videoUrl;
        job.stage = "done";
      } else if (s.status === "ERROR" || s.status === "FAILED") {
        job.stage = "error";
        job.error = "Video generation failed on fal.ais side.";
      }
    }
    await kvSet(RES, jobId, job, REEL_JOB_TTL_MS);
  } catch (e) {
    job.stage = "error";
    job.error = e instanceof Error ? e.message : String(e);
    await kvSet(RES, jobId, job, REEL_JOB_TTL_MS);
  }
  return job;
}

export function falConfigured(): boolean {
  return Boolean(FAL_KEY());
}
