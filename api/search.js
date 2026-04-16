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
          const txt = data.text;
          const brandIdx = txt.toUpperCase().indexOf(brand.toUpperCase());
          const snippet = brandIdx >= 0
            ? txt.substring(Math.max(0, brandIdx - 200), brandIdx + 5000)
            : txt.substring(0, 5000);
          infoautoContext = 'PRECIOS INFOAUTO PDF (' + data.label + '):\n' + snippet + '\n';
        }
      }
    }
  } catch (e) {
    console.log('Infoauto load error:', e.message);
  }

  const prompt = `Buscá precios de referencia para: ${vehiculo} en Argentina.
${infoautoContext ? '\nDATOS INFOAUTO DEL PDF (usá estos para la seccion infoauto):\n' + infoautoContext : ''}

INSTRUCCIONES:
1. Buscá en MercadoLibre Argentina: site:autos.mercadolibre.com.ar ${vehiculo} - necesito al menos 5 publicaciones reales con precio, año, km y URL
2. Buscá en Rosario Garage: site:rosariogarage.com ${vehiculo} - todas las publicaciones que encuentres
${infoautoLabel ? '3. Infoauto: usa los datos del PDF arriba' : '3. Buscá precio Infoauto de referencia en infoauto.com.ar'}

Respondé ÚNICAMENTE con este JSON exacto sin texto ni backticks:
{"vehiculo":"${vehiculo}","infoauto":{"precio_min":número o null,"precio_max":número o null,"precio_promedio":número o null,"version":"versión","nota":"${infoautoLabel || 'web'}"},"mercadolibre":[{"año":número,"version":"texto","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"texto","ubicacion":"ciudad","url":"https://..."}],"rosario_garage":[{"año":número,"version":"texto","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"texto","vendedor":"texto","url":"https://..."}]}

IMPORTANTE: precios en ARS como enteros puros (ej: 45000000). Si el precio está en USD multiplicá por 1260 para ARS. URLs completas con https://.`;

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 400));
      return res.status(500).json({ error: 'Error al consultar la API' });
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed = null;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (e) { console.error('Parse error:', e.message, text.substring(0, 200)); }

    if (!parsed) return res.status(500).json({ error: 'No se pudo procesar la respuesta' });
    return res.status(200).json({ ...parsed, _infoautoLabel: infoautoLabel });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
