// api/ig-followers.js
// Extrae Followers reales de páginas públicas (vía espejos de texto)
// Soporta: "34 Followers", "Followers 34", "34 Seguidores", "Seguidores 34"
// y evita confundirlo con "Following/Siguiendo" o "Posts/Publicaciones"

module.exports = async function (req, res) {
  try {
    const username = (req.query.username || "").trim().toLowerCase();
    if (!username) return res.status(400).json({ error: "username requerido" });

    // Fuentes (vía espejo texto) + anti caché
    const t = Date.now();
    const sources = [
      `https://r.jina.ai/https://instastatistics.com/${encodeURIComponent(username)}?nocache=${t}`,
      `https://r.jina.ai/https://socialcounts.org/instagram-user-live-follower-count/${encodeURIComponent(username)}?nocache=${t}`
    ];

    // Parsear cada fuente hasta obtener "followers"
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

// Convierte "1,234", "3.5K", "2.1M" -> entero
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

// Extrae métricas etiquetadas; devuelve { followers, following, posts }
function extractMetrics(text) {
  const labels = {
    followers: /(followers|seguidores)\b/i,
    following: /(following|siguiendo)\b/i,
    posts: /(posts|publicaciones)\b/i
  };

  let followers = null, following = null, posts = null;

  // 1) Patrones: NUM LABEL  (ej: "34 Followers")
  const reNumLabel = /(\d[\d.,]*\s*[KkMmBb]?)\s*(Followers|followers|Seguidores|SEGUIDORES|Following|following|Siguiendo|SIGUIENDO|Posts|posts|Publicaciones)/g;
  let m;
  while ((m = reNumLabel.exec(text)) !== null) {
    const n = normalizeNumber(m[1]);
    if (!n) continue;
    const lab = m[2].toLowerCase();
    if (/followers|seguidores/.test(lab)) followers = n;
    else if (/following|siguiendo/.test(lab)) following = n;
    else if (/posts|publicaciones/.test(lab)) posts = n;
  }

  // 2) Patrones: LABEL NUM  (ej: "Followers 34")
  const reLabelNum = /(Followers|followers|Seguidores|SEGUIDORES|Following|following|Siguiendo|SIGUIENDO|Posts|posts|Publicaciones)\s*:\s*(\d[\d.,]*\s*[KkMmBb]?)|(?:Followers|followers|Seguidores|SEGUIDORES|Following|following|Siguiendo|SIGUIENDO|Posts|posts|Publicaciones)\s+(\d[\d.,]*\s*[KkMmBb]?)/g;
  while ((m = reLabelNum.exec(text)) !== null) {
    const lab = (m[1] || m[0]).toLowerCase();
    const numStr = m[2] || m[3];
    const n = normalizeNumber(numStr);
    if (!n) continue;
    if (/followers|seguidores/.test(lab)) followers = n;
    else if (/following|siguiendo/.test(lab)) following = n;
    else if (/posts|publicaciones/.test(lab)) posts = n;
  }

  // 3) Si no encontró explícito, buscar la pareja más cercana a la palabra "Followers/Seguidores"
  if (!followers) {
    const reKey = /(Followers|followers|Seguidores|SEGUIDORES)/g;
    let km;
    while ((km = reKey.exec(text)) !== null) {
      const around = sliceAround(text, km.index, 140); // ventana alrededor
      const cand = findClosestNumber(around);
      const n = normalizeNumber(cand);
      if (n) { followers = n; break; }
    }
  }

  return (followers || following || posts) ? { followers, following, posts } : null;
}

// Devuelve ventana alrededor de una posición
function sliceAround(s, idx, radius) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(s.length, idx + radius);
  return s.slice(start, end);
}

// Toma el número "más cercano" en una ventana (mira antes y después)
function findClosestNumber(win) {
  // busca número justo antes
  let m = win.match(/(\d[\d.,]*\s*[KkMmBb]?)\s*(?:<\/?\w+[^>]*>|\s){0,6}$/i);
  if (m && m[1]) return m[1];
  // o justo después
  m = win.match(/^(?:<\/?\w+[^>]*>|\s){0,6}(\d[\d.,]*\s*[KkMmBb]?)/i);
  if (m && m[1]) return m[1];
  // fallback: cualquiera en la ventana
  m = win.match(/(\d[\d.,]*\s*[KkMmBb]?)/);
  return m ? m[1] : null;
}
