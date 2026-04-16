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

  // Load Infoauto text from GitHub
  let infoautoContext = '';
  let infoautoLabel = null;
  try {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/data/infoauto.json`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (ghRes.ok) {
      const file = await ghRes.json();
      const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      infoautoLabel = data.label;
      // Extract relevant snippet around the brand
      const txt = data.text || '';
      const brandIdx = txt.toUpperCase().indexOf(brand.toUpperCase());
      const snippet = brandIdx >= 0
        ? txt.substring(Math.max(0, brandIdx - 200), brandIdx + 5000)
        : txt.substring(0, 5000);
      infoautoContext = `\nPRECIOS INFOAUTO PDF (${data.label}) — usá estos datos exactos para la sección infoauto:\n${snippet}\n`;
    }
  } catch (e) {
    console.log('Could not load Infoauto data:', e.message);
  }

  const prompt = `Buscá precios de referencia para: ${vehiculo} en Argentina.
${infoautoContext}
Fuentes:
${infoautoLabel
  ? `1. Infoauto: usá los datos del PDF ${infoautoLabel} que te pasé arriba. Son los precios oficiales. Buscá el modelo exacto o el más cercano.`
  : `1. Infoauto (infoauto.com.ar): buscá precio de referencia online.`}
2. MercadoLibre Argentina (autos.mercadolibre.com.ar)
3. Rosario Garage (rosariogarage.com)

Respondé ÚNICAMENTE con JSON válido sin texto ni backticks:

{"vehiculo":"nombre completo","infoauto":{"precio_min":número o null,"precio_max":número o null,"precio_promedio":número o null,"version":"versión encontrada en PDF","nota":"${infoautoLabel ? 'PDF ' + infoautoLabel : 'web'}"},"mercadolibre":[{"año":número,"version":"versión","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"fecha","ubicacion":"ciudad","url":"url completa https://"}],"rosario_garage":[{"año":número,"version":"versión","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"fecha","vendedor":"nombre","url":"url completa https://"}]}

Reglas: 5-8 listings MercadoLibre, todos los de Rosario Garage. Precios ARS números puros sin separadores. Si precio en USD estimalo en ARS al blue actual. URLs con https://.`;

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
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Error al consultar la API' });
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed = null;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (e) { console.error('Parse error:', e); }

    if (!parsed) return res.status(500).json({ error: 'No se pudo procesar la respuesta' });
    return res.status(200).json({ ...parsed, _infoautoLabel: infoautoLabel });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
