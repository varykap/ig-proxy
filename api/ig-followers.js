// api/ig-followers.js
// Extrae Followers reales de páginas públicas (vía espejos de texto)
// Soporta: "34 Followers", "Followers 34", "34 Seguidores", "Seguidores 34"
// y NO confunde con Following/Seguidos ni Posts/Publicaciones.

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
      const parsed = extractMetrics(text);
      if (parsed && parsed.followers > 0) {
        return res.json({ followers: parsed.followers, source: url });
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
        "Accept": "text/plain, text/html;q=0.9,*/*;q=0.8"
      }
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// Normaliza "1,234", "3.5K", "2.1M" -> entero
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

// Extrae métricas con mapeo de etiquetas (ES/EN) y proximidad
function extractMetrics(text) {
  const L = text;                 // texto original
  const low = L.toLowerCase();    // para búsquedas
  // Etiquetas por tipo:
  const labs = {
    followers: ["followers","seguidores"],
    following: ["following","siguiendo","seguidos"],
    posts:     ["posts","publicaciones"]
  };

  // 1) Intento estructurado: por líneas (más fácil anclar número correcto)
  let followers = findLabeledNumberByLines(L, labs.followers);
  let following = findLabeledNumberByLines(L, labs.following);
  let posts     = findLabeledNumberByLines(L, labs.posts);

  // 2) Si followers aún no está, intenta con patrones globales
  if (!followers) followers = findLabeledNumberAnywhere(L, labs.followers);

  // 3) Sanidad básica: si followers coincide con posts y posts >> 1000, descarta y busca otra vez
  if (followers && posts && followers === posts && posts > 1000) {
    // Reintento más estricto alrededor de la etiqueta
    followers = findClosestToLabel(L, labs.followers);
  }

  return (followers || following || posts) ? { followers, following, posts } : null;
}

// Busca en líneas: etiqueta y número en la misma línea (antes o después), el más cercano
function findLabeledNumberByLines(text, labelList) {
  const lines = text.split(/\r?\n/);
  let best = null;

  for (const line of lines) {
    const lineLow = line.toLowerCase();
    const hasLabel = labelList.some(lb => lineLow.includes(lb));
    if (!hasLabel) continue;

    // Busca números en la línea
    const numRe = /(\d[\d.,]*\s*[KkMmBb]?)/g;
    const nums = [];
    let m;
    while ((m = numRe.exec(line)) !== null) {
      nums.push({ val: m[1], idx: m.index });
    }
    if (nums.length === 0) continue;

    // Posición de la etiqueta (primera coincidencia)
    let labIdx = -1;
    for (const lb of labelList) {
      const i = lineLow.indexOf(lb);
      if (i >= 0) { labIdx = i; break; }
    }
    if (labIdx < 0) continue;

    // Elige el número más cercano a la etiqueta
    nums.sort((a, b) => Math.abs(a.idx - labIdx) - Math.abs(b.idx - labIdx));
    for (const candidate of nums) {
      const n = normalizeNumber(candidate.val);
      if (n) { best = n; break; }
    }
    if (best) break;
  }
  return best;
}

// Busca “etiqueta + número” o “número + etiqueta” en todo el texto
function findLabeledNumberAnywhere(text, labelList) {
  const labelAlt = labelList.join("|");
  const reNumLabel = new RegExp(`(\\d[\\d.,]*\\s*[KkMmBb]?)\\s*(?:${labelAlt})\\b`, "gi");
  const reLabelNum = new RegExp(`\\b(?:${labelAlt})\\b\\s*:?\\s*(\\d[\\d.,]*\\s*[KkMmBb]?)`, "gi");

  let m;
  while ((m = reNumLabel.exec(text)) !== null) {
    const n = normalizeNumber(m[1]); if (n) return n;
  }
  while ((m = reLabelNum.exec(text)) !== null) {
    const n = normalizeNumber(m[1]); if (n) return n;
  }
  return null;
}

// Como último recurso, toma el número más cercano a la etiqueta (ventana local)
function findClosestToLabel(text, labelList) {
  const low = text.toLowerCase();
  let pos = -1;
  for (const lb of labelList) {
    pos = low.indexOf(lb);
    if (pos >= 0) break;
  }
  if (pos < 0) return null;

  const start = Math.max(0, pos - 200);
  const end   = Math.min(text.length, pos + 200);
  const win   = text.slice(start, end);

  // intenta antes de la etiqueta
  let m = win.match(/(\d[\d.,]*\s*[KkMmBb]?)\s*(?:<\/?\w+[^>]*>|\s){0,8}$/i);
  if (m && m[1]) { const n = normalizeNumber(m[1]); if (n) return n; }
  // intenta después de la etiqueta
  m = win.match(/^(?:<\/?\w+[^>]*>|\s){0,8}(\d[\d.,]*\s*[KkMmBb]?)/i);
  if (m && m[1]) { const n = normalizeNumber(m[1]); if (n) return n; }

  // cualquier número en ventana
  m = win.match(/(\d[\d.,]*\s*[KkMmBb]?)/);
  if (m && m[1]) { const n = normalizeNumber(m[1]); if (n) return n; }

  return null;
}
