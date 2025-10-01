// api/ig-followers.js
// Handler minimalista y robusto para extraer "Followers" del espejo.
// Evita regex complejas y cualquier posibilidad de crash por llaves/undefined.

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

      const followers = extractFollowersSimple(text);
      if (followers) {
        const out = { followers, source: url };
        if (debug) out.debug_sample = sampleAround(text, /(Followers|followers|Seguidores)/, 220);
        return res.json(out);
      }
    }

    return res.status(404).json({ error: "followers no encontrado" });
  } catch (err) {
    // Nunca re-lanzamos: devolvemos JSON con el detalle para evitar 500 silencioso
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

// ====== EXTRACCIÓN SENCILLA Y SEGURA ======

// Normaliza "1,234", "3.5K", "2.1M" → entero
function toNumber(s) {
  if (!s) return null;
  let t = String(s).trim().replace(/,/g, "").replace(/\s+/g, "");
  const suf = t.slice(-1).toLowerCase();
  let mul = 1;
  if (suf === "k" || suf === "m" || suf === "b") {
    t = t.slice(0, -1);
    if (suf === "k") mul = 1e3;
    if (suf === "m") mul = 1e6;
    if (suf === "b") mul = 1e9;
  }
  const v = Number(t);
  if (!isFinite(v) || v <= 0) return null;
  return Math.round(v * mul);
}

// Devuelve el número más cercano a la palabra "Followers/Seguidores"
// procurando NO confundir con "Following/Siguiendo/Seguidos" ni "Posts/Publicaciones"
function extractFollowersSimple(text) {
  const low = text.toLowerCase();
  // Todas las posiciones de 'followers'/'seguidores'
  const labelRegex = /\b(followers|seguidores)\b/g;
  let best = null;

  let m;
  while ((m = labelRegex.exec(low)) !== null) {
    const idx = m.index;

    // Ventana alrededor de la etiqueta
    const start = Math.max(0, idx - 160);
    const end   = Math.min(text.length, idx + 160);
    const win   = text.slice(start, end);
    const winLow = win.toLowerCase();

    // Si en la ventana hay 'following/siguiendo/seguidos' pegado al número, lo evitamos
    // 1) Busca número antes de la etiqueta (pegado)
    let num = findNumberBefore(win, winLow, m.index - start);
    // 2) Si no hay, busca número después de la etiqueta (pegado)
    if (!num) num = findNumberAfter(win, winLow, m.index - start);

    if (num) {
      const val = toNumber(num);
      if (val) {
        // Guardrail: descarta valores absurdos que coincidan con posts altos si hay "posts" pegado
        if (likelyWrongWithPosts(winLow, val)) {
          // intenta al revés (si antes miró antes, ahora después, o viceversa)
          const alt = num === "before" ? findNumberAfter(win, winLow, m.index - start) 
                                       : findNumberBefore(win, winLow, m.index - start);
          const valAlt = toNumber(alt);
          if (valAlt) return valAlt;
        }
        best = val;
        break;
      }
    }
  }
  return best;
}

// Busca un token numérico inmediatamente ANTES de la etiqueta dentro de la ventana
function findNumberBefore(win, winLow, relIdx) {
  // retrocede desde relIdx-1 hasta encontrar el token numérico
  let i = relIdx - 1;
  while (i >= 0 && /[\s>)/]/.test(win[i])) i--;
  let tok = "";
  while (i >= 0 && /[\d.,KkMmBb]/.test(win[i])) { tok = win[i] + tok; i--; }
  tok = tok.trim();
  if (!tok) return null;

  // Evitar que justo detrás del número haya "following/siguiendo/seguidos"
  const afterNum = winLow.slice(i+1, i+1 + 30);
  if (/\b(following|siguiendo|seguidos)\b/.test(afterNum)) return null;
  return tok;
}

// Busca un token numérico inmediatamente DESPUÉS de la etiqueta dentro de la ventana
function findNumberAfter(win, winLow, relIdx) {
  // avanza desde relIdx+len(label) → pero no sabemos el len exacto aquí
  // simplificamos: saltamos unas pocas palabras/espacios
  let i = relIdx + 12; // "followers" ~ 9 letras; margen extra
  if (i < 0) i = 0;
  while (i < win.length && /[\s<(:]/.test(win[i])) i++;
  let tok = "";
  while (i < win.length && /[\d.,KkMmBb]/.test(win[i])) { tok += win[i]; i++; }
  tok = tok.trim();
  if (!tok) return null;

  // Evitar que justo antes del número haya "following/siguiendo/seguidos"
  const beforeNum = winLow.slice(Math.max(0, i - 30), i);
  if (/\b(following|siguiendo|seguidos)\b/.test(beforeNum)) return null;
  return tok;
}

// Si la ventana sugiere que el número es más bien "posts", y es muy alto, evita
function likelyWrongWithPosts(winLow, val) {
  if (val > 1000 && /\b(posts|publicaciones)\b/.test(winLow)) return true;
  return false;
}

// Devuelve un trocito de texto (para debug controlado) alrededor de la 1ª ocurrencia del patrón
function sampleAround(text, pattern, radius) {
  const m = text.match(pattern);
  if (!m) return text.slice(0, Math.min(400, text.length));
  const idx = text.toLowerCase().indexOf(m[0].toLowerCase());
  const s = Math.max(0, idx - radius);
  const e = Math.min(text.length, idx + radius);
  return text.slice(s, e);
}
