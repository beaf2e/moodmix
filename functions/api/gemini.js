/**
 * /api/gemini — Vision으로 사진 분석 + 장르별 플레이리스트 큐레이션
 * Body: { dataUrl: "data:image/jpeg;base64,...", genre: "K-Indie", mood: {...} }
 */

const SYSTEM_PROMPT = `너는 이미지 분석을 통해 사용자의 음악 취향에 맞춘 '스트리밍 앱 스타일 플레이리스트'를 생성하는 전문 큐레이터이다.

[Instruction]
사용자가 사진을 업로드하고 관심 장르를 선택하면, Vision으로 사진을 분석하여 아래의 JSON 형식으로만 응답하라.

1. Vision & Narrative Analysis
- 이미지 분석: 색감(Hex 코드), 광원, 피사체의 질감을 분석하여 사진의 '온도'와 '습도'를 결정한다.
- 서사 생성: 분석된 시각 데이터를 바탕으로 사용자가 사진 속 상황에 몰입할 수 있는 1~2문장의 짧은 스토리텔링을 작성한다.

2. Streaming UI Title & Metadata
- Display Title: 서사형 문구 + 감성적 특수문자(⋆彡, 🌙, ✦, ♡, [ ᴘʟᴀʏʟɪsᴛ ] 등)를 조합한 감성적 제목.
- Playlist Description: 스트리밍 앱 에디터가 작성한 듯한 세련된 1~2문장.
- Mood Parameters: energy / chill / acousticness 를 0.0~1.0 수치화.

3. Tracklist Curation
- 장르 고정: 사용자가 선택한 장르를 절대 벗어나지 말 것.
- 선곡 이유(curator_note): 해당 곡이 사진의 '어떤 시각적 요소' 때문에 선곡되었는지 앱의 큐레이션 노트처럼 1문장으로.
- 실존 데이터: 반드시 실제 스트리밍 서비스에 등록된 곡/아티스트만. 환각 절대 금지.
- 같은 장르라도 사진의 분위기/색감/광원에 따라 매번 다른 곡 조합으로 큐레이션할 것.
- 정확히 10곡.

[출력: JSON만, 다른 텍스트/코드블록 금지]
{
  "ui_metadata": {
    "playlist_title": "감성적 제목",
    "description": "재생목록 설명 문구",
    "vibe_tags": ["#태그1", "#태그2", "#태그3"],
    "audio_profile": { "energy": 0.0, "chill": 0.0, "acousticness": 0.0 }
  },
  "image_log": {
    "detected_colors": ["#Hex1", "#Hex2", "#Hex3", "#Hex4"],
    "scene_analysis": "사진 분위기에 대한 1~2문장 해석"
  },
  "tracklist": [
    {
      "track_id": "01",
      "title": "정확한 곡 제목",
      "artist": "정확한 아티스트명",
      "curator_note": "사진의 [요소]와 곡의 [분위기/가사]가 연결되는 이유, 한글 1문장",
      "duration": "MM:SS"
    }
  ]
}`;

function modelPriority(name) {
  if (/^gemini-2\.5-flash$/.test(name)) return 100;
  if (/^gemini-2\.5-flash-lite$/.test(name)) return 95;
  if (/^gemini-2\.5-flash-preview/.test(name)) return 90;
  if (/^gemini-2\.0-flash$/.test(name)) return 80;
  if (/^gemini-2\.0-flash-lite$/.test(name)) return 75;
  if (/^gemini-2\.0-flash-/.test(name)) return 70;
  if (/^gemini-1\.5-flash-latest$/.test(name)) return 60;
  if (/^gemini-1\.5-flash$/.test(name)) return 55;
  if (/flash/i.test(name)) return 30;
  return 0;
}

async function listFlashModels(key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
    .map(m => m.name.replace(/^models\//, ""))
    .filter(n => /flash/i.test(n))
    .sort((a, b) => modelPriority(b) - modelPriority(a));
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_KEY) {
    return jsonError("Server config missing: GEMINI_KEY", 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Invalid JSON", 400); }

  const { dataUrl, genre, mood } = body || {};
  if (!dataUrl || !genre) return jsonError("Missing dataUrl or genre", 400);

  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return jsonError("Invalid dataUrl", 400);
  const mime = m[1];
  const base64 = m[2];

  const safeMood = {
    energy: Number(mood?.energy ?? 0.5),
    chill: Number(mood?.chill ?? 0.5),
    acousticness: Number(mood?.acousticness ?? 0.5),
  };

  const userText = `사용자 선택 장르: ${genre}
분위기 보정 (참고용, 0~1): energy=${safeMood.energy.toFixed(2)}, chill=${safeMood.chill.toFixed(2)}, acousticness=${safeMood.acousticness.toFixed(2)}

위 사진을 분석하여 ${genre} 장르의 10곡짜리 플레이리스트를 만들어줘.
- 같은 사진/장르라도 색감·광원·피사체에 따라 다양한 곡 조합을 보여줄 것.
- 정확히 10곡, 실존하는 곡만.
- 응답은 지정된 JSON 형식 단 하나만, 코드 블록 없이.`;

  const reqBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: "user",
      parts: [
        { text: userText },
        { inline_data: { mime_type: mime, data: base64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 1.0,
    }
  };

  const models = await listFlashModels(env.GEMINI_KEY);
  if (!models.length) return jsonError("No usable Gemini model found for this key", 502);

  const errors = [];
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_KEY)}`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      errors.push(`${model}: ${(err.error?.message || `HTTP ${res.status}`).slice(0, 80)}`);
      continue;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) { errors.push(`${model}: empty response`); continue; }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) { errors.push(`${model}: JSON parse failed`); continue; }
      try { parsed = JSON.parse(match[0]); }
      catch (e) { errors.push(`${model}: ${e.message}`); continue; }
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return jsonError("All models failed — " + errors.slice(0, 2).join(" / "), 502);
}
