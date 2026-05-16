/**
 * /api/youtube — 아티스트+제목으로 검색, Topic 채널 우선 video ID 배열 반환
 * Body: { artist: "...", title: "..." }
 * Response: { videoIds: ["...", ...] }   (실패해도 200, 빈 배열)
 */

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.YOUTUBE_KEY) {
    return jsonError("Server config missing: YOUTUBE_KEY", 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Invalid JSON", 400); }

  const artist = (body?.artist || "").trim();
  const title = (body?.title || "").trim();
  if (!artist || !title) return jsonError("Missing artist or title", 400);

  const cleanTitle = title.replace(/\([^)]*\)|\[[^\]]*\]|\s*feat\.?[^,]*$/gi, "").trim();
  const cleanArtist = artist.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();

  const queries = [
    `${artist} ${title}`,
    `${cleanArtist} ${cleanTitle}`,
    cleanTitle,
  ].filter((q, i, arr) => q && q.trim() && arr.indexOf(q) === i);

  for (const query of queries) {
    const q = encodeURIComponent(query);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoEmbeddable=true&maxResults=10&key=${encodeURIComponent(env.YOUTUBE_KEY)}`;

    let res;
    try { res = await fetch(url); }
    catch (e) { return jsonError(`Network: ${e.message}`, 502); }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return jsonError(err.error?.message || `YouTube HTTP ${res.status}`, 502);
    }

    const data = await res.json();
    const items = (data.items || []).filter(it => it.id?.videoId);
    if (!items.length) continue;

    const isTopic    = it => (it.snippet.channelTitle || "").trim().endsWith("- Topic");
    const hasTopic   = it => /topic/i.test(it.snippet.channelTitle || "");
    const isOfficial = it => /official|vevo/i.test(it.snippet.channelTitle || "");
    const ranked = [
      ...items.filter(isTopic),
      ...items.filter(it => hasTopic(it) && !isTopic(it)),
      ...items.filter(it => isOfficial(it) && !hasTopic(it)),
      ...items.filter(it => !hasTopic(it) && !isOfficial(it)),
    ];
    const ids = [...new Set(ranked.map(it => it.id.videoId))];
    if (!ids.length) continue;

    return new Response(JSON.stringify({ videoIds: ids }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response(JSON.stringify({ videoIds: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
