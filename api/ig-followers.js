// api/ig-followers.js  (Node 18+ / Vercel Serverless)
// Devuelve { followers: <n> } tomando la cifra de una página pública
// a través de un espejo de texto (sin JS). Ejemplo: ?username=gridphotogallery

export default async function handler(req, res) {
  try {
    const username = (req.query.username || "").trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ error: "username requerido" });
    }

    // Espejo de texto (usa la URL HTTPS del destino dentro del path):
    const mirrorUrl = `https://r.jina.ai/https://instastatistics.com/${encodeURIComponent(username)}`;

    const r = await fetch(mirrorUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Serverless Fetch)",
        "Accept": "text/plain, text/html;q=0.9,*/*;q=0.8",
      },
    });

    if (!r.ok) {
      return res.status(502).json({ error: "fuente no disponible", status: r.status });
    }

    const text = await r.text();

    // Caso principal: número inmediatamente antes de 'Followers'/'Seguidores'
    const re = /(\d[\d.,]*\s*[KkMmBb]?)\s*(Followers|followers|Seguidores|SEGUIDORES)/;
    const m = text.match(re);

    if (!m) {
      // Fallback por líneas: última "palabra numérica" antes de la clave en la misma línea
      let followers = null;
      for (const line of text.split(/\r?\n/)) {
        if (/Followers|followers|Seguidores|SEGUIDORES/.test(line)) {
          const left = line.split(/Followers|followers|Seguidores|SEGUIDORES/)[0];
          const m2 = left.match(/(\d[\d.,]*\s*[KkMmBb]?)\s*$/);
          if (m2) { followers = m2[1]; break; }
        }
      }
      if (!followers) return res.status(404).json({ error: "no encontrado" });
      return res.json({ followers: normalizeNumber(followers), source: "instastatistics (mirror line)" });
    }

    const rawNum = m[1];
    return res.json({ followers: normalizeNumber(rawNum), source: "instastatistics (mirror)" });

  } catch (err) {
    return res.status(500).json({ error: "error interno", detail: String(err) });
  }
}

function normalizeNumber(s) {
  let t = (s || "").trim().replace(/,/g, "").replace(/\s+/g, "");
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
