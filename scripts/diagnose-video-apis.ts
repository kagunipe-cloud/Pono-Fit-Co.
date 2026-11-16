/**
 * One-shot Serper + YouTube API health check (run in Railway Shell).
 *   npm run diagnose-video-apis
 */

const serperKey = process.env.SERPER_API_KEY?.trim();
const ytKey = process.env.YOUTUBE_API_KEY?.trim();

async function main() {
  console.log("Keys present:", { serper: Boolean(serperKey), youtube: Boolean(ytKey) });

  if (serperKey) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": serperKey },
      body: JSON.stringify({ q: "barbell squat proper form site:youtube.com", num: 3 }),
    });
    const text = await res.text();
    console.log("\nSerper status:", res.status);
    console.log(text.slice(0, 400));
  } else {
    console.log("\nSerper: skipped (no key)");
  }

  if (ytKey) {
    const q = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: "barbell squat proper form tutorial",
      maxResults: "3",
      key: ytKey,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${q}`);
    const text = await res.text();
    console.log("\nYouTube search status:", res.status);
    console.log(text.slice(0, 400));
  } else {
    console.log("\nYouTube: skipped (no key)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});