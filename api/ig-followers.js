// api/ig-followers.js
module.exports = async function (req, res) {
  try {
    const username = (req.query.username || "").trim().toLowerCase();
    const debug = (req.query.debug || "") === "1";
    if (!username) return res.status(400).json({ error: "username requerido" });

    const t = Date.now();
    const sources = [
      `https://r.jina.ai/https://instastatistics.com/${encodeURIComponent(username)}?nocache=${t}`,
      `https://r.jina.ai/https://socialcounts.org/instagram-user-live-follower-count/${encodeURIComponent(username)}?nocache=${t}`,
      `https://r.jina.ai/https://livecounts.io/instagram-live-follower-counter/${encodeURIComponent(username)}?nocache=${t}`
    ];

    for (const url of sources) {
      const text = await fetchText(url);
      if (!text) continue;

      const followers = extractFollowersStrict3(text);
      if (followers) {
        const out = { followers, source: url };
        if (debug) out.debug_sample = sampleAround(text, /(Followers|Seguidores)/i, 240);
        return res.json(out);
      }
    }

    return res.status(404).json({ error: "followers no encontrado" });
  } catch (err) {
    return res.status(500).json({ error: "error interno", detail: String(err) });
  }
};

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Serverless Fetch)",
        "Accept": "text/plain, text/html;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function toNumber(s) {
  if (!s) return null;
  let t = String(s).trim().replace(/,/g, "").replace(/\s+/g, "");
  const suf = t.slice(-1).toLowerCase();
  let mul = 1;
  if (["k","m","b"].includes(suf)) {
    t = t.slice(0, -1);
    if (suf === "k") mul = 1e3;
    if (suf === "m") mul = 1e6;
    if (suf === "b") mul = 1e9;
  }
  const v = Number(t);
  if (!isFinite(v) || v <= 0) return null;
  return Math.round(v * mul);
}

// ===== extractor: misma línea, línea anterior y línea siguiente =====
function extractFollowersStrict3(text) {
  const lines = text.split(/\r?\n/);

  // 1) MISMA LÍNEA: "Followers 34" o "Followers: 34"
  for (const line of lines) {
    const idx = line.search(/\b(Followers|Seguidores)\b/i);
    if (idx < 0) continue;

    // Bloque desde la etiqueta, pero cortamos si aparece Following/Siguiendo/Seguidos
    const tail = line.slice(idx).split(/(Following|Siguiendo|Seguidos)/i)[0];
    const m = tail.match(/\b(Followers|Seguidores)\b\s*:?[\s<]*(\d[\d.,]*\s*[KkMmBb]?)/i);
    if (m && m[2]) {
      const n = toNumber(m[2]);
      if (n) return n;
    }
  }

  // 2) LÍNEA ANTERIOR: número en la línea anterior a la etiqueta (tu caso)
  for (let i = 1; i < lines.length; i++) {
    if (!/\b(Followers|Seguidores)\b/i.test(lines[i])) continue;
    // Evitar confusión si en la línea de etiqueta hay "Following/Siguiendo/Seguidos"
    if (/\b(Following|Siguiendo|Seguidos)\b/i.test(lines[i])) continue;

    // última "palabra numérica" de la línea anterior
    const prev = lines[i - 1];
    const mPrev = prev && prev.match(/(\d[\d.,]*\s*[KkMmBb]?)\s*$/);
    if (mPrev && mPrev[1]) {
      const n = toNumber(mPrev[1]);
      if (n) return n;
    }
  }

  // 3) LÍNEA SIGUIENTE: número al inicio de la línea siguiente
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/\b(Followers|Seguidores)\b/i.test(lines[i])) continue;
    if (/\b(Following|Siguiendo|Seguidos)\b/i.test(lines[i])) continue;

    const mNext = lines[i + 1].match(/^\s*(\d[\d.,]*\s*[KkMmBb]?)/);
    if (mNext && mNext[1]) {
      const n = toNumber(mNext[1]);
      if (n) return n;
    }
  }

  return null;
}

function sampleAround(text, pattern, radius) {
  const low = text.toLowerCase();
  const m = low.match(new RegExp(pattern, "i"));
  if (!m) return text.slice(0, Math.min(400, text.length));
  const idx = low.indexOf(m[0].toLowerCase());
  const s = Math.max(0, idx - radius);
  const e = Math.min(text.length, idx + radius);
  return text.slice(s, e);
}
