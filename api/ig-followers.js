// api/ig-followers.js
// Parser posicional robusto: empareja etiquetas (followers/following/posts)
// con el número más cercano (mismo renglón, antes/después, o renglón siguiente).

module.exports = async function (req, res) {
  try {
    const username = (req.query.username || "").trim().toLowerCase();
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

      const metrics = extractByProximity(text);
      if (metrics && metrics.followers) {
        return res.json({ followers: metrics.followers, source: url });
      }
    }
    return res.status(404).json({ error: "followers no encontrado en fuentes" });
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

// --- Utilidades de números ---
function normalizeNumber(s) {
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

// Tokeniza: números y etiquetas con su posición en el texto
function tokenize(text) {
  const tokens = [];
  const numRe = /(\d[\d.,]*\s*[KkMmBb]?)/g;
  const labRe = /\b(Followers|followers|Seguidores|SEGUIDORES|Following|following|Siguiendo|seguidos|SIGUIENDO|Posts|posts|Publicaciones)\b/g;

  let m;
  while ((m = numRe.exec(text)) !== null) {
    tokens.push({ type: "num", raw: m[1], idx: m.index });
  }
  while ((m = labRe.exec(text)) !== null) {
    const lab = m[1].toLowerCase();
    let kind = null;
    if (/followers|seguidores/.test(lab)) kind = "followers";
    else if (/following|siguiendo|seguidos/.test(lab)) kind = "following";
    else if (/posts|publicaciones/.test(lab)) kind = "posts";
    if (kind) tokens.push({ type: "label", kind, raw: m[1], idx: m.index });
  }
  // ordenar por posición
  tokens.sort((a, b) => a.idx - b.idx);
  return tokens;
}

// Busca la pareja numérica MÁS CERCANA a cada etiqueta (antes o después),
// con límites de distancia y evitando cruzarse con otra etiqueta.
function pairClosest(text, labelTokens, numTokens, maxDist = 80) {
  const pairs = []; // { kind, value }
  for (const lab of labelTokens) {
    let best = null;
    // buscar a la izquierda
    for (let i = numTokens.length - 1; i >= 0; i--) {
      const tok = numTokens[i];
      if (tok.idx >= lab.idx) break;
      const dist = lab.idx - tok.idx;
      if (dist > maxDist) continue;
      // Si entre el número y la etiqueta hay otra etiqueta, lo descartamos
      const between = text.slice(
