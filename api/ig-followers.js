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

      const { value, context } = extractFollowersFlexible(text);
      if (value) {
        const out = { followers: value, source: url };
        if (debug) out.debug_context = context;
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

function extractFollowersFlexible(text) {
  // Preproceso suave: quita espacios extra a cada línea, pero conserva el orden
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(l => l.replace(/\s+$/,''));
  const n = lines.length;

  const labelRe = /\b(Followers|Seguidores)\b/i;
  const badLabelRe = /\b(Following|Siguiendo|Seguidos|Posts|Publicaciones)\b/i;
  const numRe = /(\d[\d.,]*\s*[KkMmBb]?)/;

  // Escanea todas las líneas donde aparece "Followers/Seguidores"
  for (let i = 0; i < n; i++) {
    if (!labelRe.test(lines[i])) continue;

    // Construye una ventana de contexto ±3 líneas
    const from = Math.max(0, i - 3);
    const to   = Math.min(n - 1, i + 3);

    // 1) MISMA LÍNEA, número después de la etiqueta (más común)
    {
      const tail = lines[i].slice(lines[i].search(labelRe));
      const block = tail.split(badLabelRe)[0];
      const m = block.match(/\b(Followers|Seguidores)\b\s*:?[\s<]*(\d[\d.,]*\s*[KkMmBb]?)/i);
      if (m && m[2]) {
        const v = toNumber(m[2]);
        if (v) return { value: v, context: contextSlice(lines, i) };
      }
    }

    // 2) LÍNEA ANTERIOR: último token numérico (evitando líneas con etiquetas "malas")
    for (let k = 1; k <= 3; k++) {
      const j = i - k;
      if (j < 0) break;
      if (badLabelRe.test(lines[j])) continue;
      const m = lines[j].match(numRe);
      if (m) {
        const v = toNumber(m[1]);
        if (v) return { value: v, context: contextSlice(lines, i) };
      }
    }

    // 3) LÍNEA SIGUIENTE: primer token numérico (evitando etiquetas malas)
    for (let k = 1; k <= 3; k++) {
      const j = i + k;
      if (j >= n) break;
      if (badLabelRe.test(lines[j])) continue;
      const m = lines[j].match(numRe);
      if (m) {
        const v = toNumber(m[1]);
        if (v) return { value: v, context: contextSlice(lines, i) };
      }
    }

    // 4) Último recurso en ventana: busca el número más cercano mirando hacia atrás y adelante
    // siempre evitando que entre la etiqueta y el número aparezca una etiqueta "mala".
    // Hacia atrás
    for (let j = i - 1; j >= from; j--) {
      if (badLabelRe.test(lines[j])) break;
      const m = lines[j].match(numRe);
      if (m) {
        const v = toNumber(m[1]);
        if (v) return { value: v, context: contextSlice(lines, i) };
      }
    }
    // Hacia delante
    for (let j = i + 1; j <= to; j++) {
      if (badLabelRe.test(lines[j])) break;
      const m = lines[j].match(numRe);
      if (m) {
        const v = toNumber(m[1]);
        if (v) return { value: v, context: contextSlice(lines, i) };
      }
    }
  }

  return { value: null, context: null };
}

function contextSlice(lines, centerIdx, radius = 5) {
  const s = Math.max(0, centerIdx - radius);
  const e = Math.min(lines.length - 1, centerIdx + radius);
  return lines.slice(s, e + 1).join("\n");
}
