// TikTok posting -- item 6. Real Content Posting API call shape for
// publishing a generated reel (see lib/reels.ts) to a connected TikTok
// Business account, gated on env vars with the same graceful "not
// configured" fallback used throughout this worker. See
// docs/TIKTOK-SETUP.md for the developer-portal steps.

export interface TikTokPublishResult {
  configured: boolean;
  ok: boolean;
  publishId?: string;
  message: string;
}

// TikTok Content Posting API (v2) -- PULL_FROM_URL variant, so the video
// never has to round-trip through this worker: TikTok fetches it directly
// from the fal.ai-hosted URL lib/reels.ts already produces. Requires
// TIKTOK_ACCESS_TOKEN (OAuth2 user access token with video.publish scope,
// from the TikTok Login Kit flow -- a real per-creator OAuth connect,
// structurally identical to lib/meta-oauth.ts's flow, is the natural next
// step once Pasha has a TikTok developer app; this function assumes that
// token already exists in the env for now, same "inert until credentials
// are supplied" pattern as the rest of item 6).
export async function publishToTikTok(videoUrl: string, caption: string): Promise<TikTokPublishResult> {
  const accessToken = Deno.env.get("TIKTOK_ACCESS_TOKEN") ?? "";
  if (!accessToken) {
    return { configured: false, ok: false, message: "TikTok not configured (see docs/TIKTOK-SETUP.md) -- set TIKTOK_ACCESS_TOKEN." };
  }
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: caption,
          privacy_level: "SELF_ONLY",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: videoUrl,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error?.code !== "ok") {
      return { configured: true, ok: false, message: "TikTok publish failed: " + JSON.stringify(data) };
    }
    return { configured: true, ok: true, publishId: data.data?.publish_id, message: "TikTok publish initiated -- note privacy_level defaults to SELF_ONLY (draft/private) until Pashas TikTok app passes Content Posting API audit for public posting; see docs/TIKTOK-SETUP.md." };
  } catch (e) {
    return { configured: true, ok: false, message: "TikTok request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

export function tiktokConfigured(): boolean {
  return Boolean(Deno.env.get("TIKTOK_ACCESS_TOKEN"));
}
