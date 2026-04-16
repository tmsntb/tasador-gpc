export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { brand, model, version, yearFrom, yearTo } = req.body || {};
  if (!brand || !model) return res.status(400).json({ error: 'Marca y modelo requeridos' });

  let yearDesc = '';
  if (yearFrom && yearTo && yearFrom !== yearTo) yearDesc = ' año ' + yearFrom + ' al ' + yearTo;
  else if (yearFrom) yearDesc = ' desde ' + yearFrom;
  else if (yearTo) yearDesc = ' hasta ' + yearTo;
  const vehiculo = brand + ' ' + model + (version ? ' ' + version : '') + yearDesc;

  // Load Infoauto text from GitHub
  let infoautoContext = '';
  let infoautoLabel = null;
  try {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (owner && repo && token) {
      const ghRes = await fetch(
        'https://api.github.com/repos/' + owner + '/' + repo + '/contents/data/infoauto.json',
        { headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' } }
      );
      if (ghRes.ok) {
        const file = await ghRes.json();
        const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        if (data.text && data.text.length > 100) {
          infoautoLabel = data.label;
          const txt = data.text.toUpperCase();
          const brandUpper = brand.toUpperCase();
          const modelUpper = model.toUpperCase();
          let bestIdx = -1;
          let bestDist = Infinity;
          let searchFrom = 0;
          while (true) {
            const idx = txt.indexOf(brandUpper, searchFrom);
            if (idx === -1) break;
            const chunk = txt.substring(idx, idx + 8000);
            const modelIdx = chunk.indexOf(modelUpper);
            if (modelIdx !== -1 && modelIdx < bestDist) {
              bestDist = modelIdx;
              bestIdx = idx;
            }
            searchFrom = idx + 1;
          }
          if (bestIdx === -1) bestIdx = txt.indexOf(brandUpper);
          const snippet = bestIdx >= 0
            ? data.text.substring(Math.max(0, bestIdx - 100), bestIdx + 10000)
            : data.text.substring(0, 8000);
          infoautoContext = 'PRECIOS INFOAUTO PDF (' + infoautoLabel + '):\n' + snippet;
        }
      }
    }
  } catch (e) {
    console.log('Infoauto error:', e.message);
  }

  const prompt = `Buscá precios de referencia en Argentina para: ${vehiculo}

${infoautoContext ? 'DATOS INFOAUTO DEL PDF (' + infoautoLabel + ') — extraé los precios exactos de este texto, ignorá sección de motos:\n' + infoautoContext + '\n' : ''}

TAREA: Buscá en Google las siguientes fuentes y devolvé resultados reales:
1. Publicaciones de ${vehiculo} en MercadoLibre Argentina (autos.mercadolibre.com.ar) — necesito 5 a 8 publicaciones con precio, km, año y URL
2. Publicaciones de ${vehiculo} en Rosario Garage (rosariogarage.com) — todas las que encuentres
${infoautoLabel ? '3. Infoauto: usá los datos del PDF de arriba' : '3. Precio de referencia Infoauto de infoauto.com.ar'}

Respondé SOLO con JSON válido, sin texto ni backticks:
{"vehiculo":"${vehiculo}","infoauto":{"precio_min":número o null,"precio_max":número o null,"precio_promedio":número o null,"version":"texto o null","nota":"${infoautoLabel ? 'PDF ' + infoautoLabel : 'web'}"},"mercadolibre":[{"año":número,"version":"texto","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"texto","ubicacion":"ciudad","url":"https://..."}],"rosario_garage":[{"año":número,"version":"texto","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"texto","vendedor":"texto","url":"https://..."}]}

Precios ARS como enteros sin separadores. Si precio en USD, calculá ARS al tipo blue actual.`;

  try {
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + process.env.GEMINI_API_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        })
      }
    );

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error('Gemini error:', JSON.stringify(geminiData).substring(0, 300));
      return res.status(500).json({ error: 'Error al consultar Gemini' });
    }

    const text = geminiData.candidates?.[0]?.content?.parts
      ?.filter(p => p.text)
      ?.map(p => p.text)
      ?.join('') || '';

    let parsed = null;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (e) { console.error('Parse error:', e.message); }

    if (!parsed) return res.status(500).json({ error: 'No se pudo procesar la respuesta' });
    return res.status(200).json({ ...parsed, _infoautoLabel: infoautoLabel });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
      }
