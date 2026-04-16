export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { brand, model, version, yearFrom, yearTo } = req.body || {};
  if (!brand || !model) return res.status(400).json({ error: 'Marca y modelo requeridos' });

  let yearDesc = '';
  if (yearFrom && yearTo && yearFrom !== yearTo) yearDesc = ` año ${yearFrom} al ${yearTo}`;
  else if (yearFrom) yearDesc = ` desde ${yearFrom}`;
  else if (yearTo) yearDesc = ` hasta ${yearTo}`;
  const vehiculo = `${brand} ${model}${version ? ' ' + version : ''}${yearDesc}`;

  // Load Infoauto from GitHub
  let infoautoContext = '';
  let infoautoLabel = null;
  try {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (owner && repo && token) {
      const ghRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/data/infoauto.json`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
      );
      if (ghRes.ok) {
        const file = await ghRes.json();
        const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        if (data.text && data.text.length > 100) {
          infoautoLabel = data.label;
          const txt = data.text.toUpperCase();
          const brandUpper = brand.toUpperCase();
          const modelUpper = model.toUpperCase();
          let bestIdx = -1, bestDist = Infinity, searchFrom = 0;
          while (true) {
            const idx = txt.indexOf(brandUpper, searchFrom);
            if (idx === -1) break;
            const mIdx = txt.substring(idx, idx + 8000).indexOf(modelUpper);
            if (mIdx !== -1 && mIdx < bestDist) { bestDist = mIdx; bestIdx = idx; }
            searchFrom = idx + 1;
          }
          if (bestIdx === -1) bestIdx = txt.indexOf(brandUpper);
          const snippet = bestIdx >= 0
            ? data.text.substring(Math.max(0, bestIdx - 100), bestIdx + 10000)
            : data.text.substring(0, 8000);
          infoautoContext = `PRECIOS INFOAUTO PDF (${infoautoLabel}) — ignorá motos, buscá el auto:\n${snippet}`;
        }
      }
    }
  } catch (e) { console.log('Infoauto error:', e.message); }

  const prompt = `Buscá precios de referencia en Argentina para: ${vehiculo}

${infoautoContext ? `DATOS INFOAUTO DEL PDF (${infoautoLabel}):\n${infoautoContext}\n` : ''}

Buscá en la web y devolvé un JSON con esta estructura exacta:
{
  "vehiculo": "${vehiculo}",
  "infoauto": {
    "precio_min": número entero en ARS o null,
    "precio_max": número entero en ARS o null,
    "precio_promedio": número entero en ARS o null,
    "version": "versión encontrada o null",
    "nota": "${infoautoLabel ? 'PDF ' + infoautoLabel : 'web'}"
  },
  "mercadolibre": [
    {
      "año": número,
      "version": "texto",
      "km": número o null,
      "precio_ars": número entero o null,
      "precio_usd": número entero o null,
      "fecha_publicacion": "texto",
      "ubicacion": "ciudad",
      "url": "url completa con https://"
    }
  ],
  "rosario_garage": [
    {
      "año": número,
      "version": "texto",
      "km": número o null,
      "precio_ars": número entero o null,
      "precio_usd": número entero o null,
      "fecha_publicacion": "texto",
      "vendedor": "texto",
      "url": "url completa con https://"
    }
  ]
}

Instrucciones:
- Buscá publicaciones reales de ${vehiculo} en autos.mercadolibre.com.ar (5-8 resultados)
- Buscá publicaciones reales de ${vehiculo} en rosariogarage.com (todas las que encuentres)
${infoautoLabel ? `- Para Infoauto usá los datos del PDF de arriba` : `- Buscá precio de referencia en infoauto.com.ar`}
- Precios ARS como números enteros sin puntos ni comas
- Si el precio está en USD multiplicá por 1260 para ARS y completá ambos campos
- URLs completas con https://
- Devolvé SOLO el JSON, sin texto antes ni después`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 300));
      return res.status(500).json({ error: 'Error al consultar la API' });
    }

    // Extract text from all content blocks
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Robust JSON extraction
    let parsed = null;
    try {
      // Try direct parse first
      const clean = text.replace(/```json|```/g, '').trim();
      // Find the outermost JSON object
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        parsed = JSON.parse(clean.substring(start, end + 1));
      }
    } catch (e) {
      console.error('Parse error:', e.message, '\nText:', text.substring(0, 400));
    }

    if (!parsed) {
      console.error('Could not parse response. Full text:', text.substring(0, 800));
      return res.status(500).json({ error: 'No se pudo procesar la respuesta' });
    }

    return res.status(200).json({ ...parsed, _infoautoLabel: infoautoLabel });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}
