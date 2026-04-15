export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { brand, model, version, yearFrom, yearTo } = req.body;
  if (!brand || !model) return res.status(400).json({ error: 'Marca y modelo son requeridos' });

  let yearDesc = '';
  if (yearFrom && yearTo && yearFrom !== yearTo) yearDesc = ` año ${yearFrom} al ${yearTo}`;
  else if (yearFrom) yearDesc = ` desde ${yearFrom}`;
  else if (yearTo) yearDesc = ` hasta ${yearTo}`;

  const vehiculo = `${brand} ${model}${version ? ' ' + version : ''}${yearDesc}`;

  const prompt = `Buscá precios de referencia actualizados para: ${vehiculo} en Argentina.

Fuentes:
1. Infoauto (infoauto.com.ar)
2. MercadoLibre Argentina (autos.mercadolibre.com.ar)
3. Rosario Garage (rosariogarage.com)

Respondé ÚNICAMENTE con JSON válido sin texto ni backticks:

{"vehiculo":"nombre completo","infoauto":{"precio_min":número o null,"precio_max":número o null,"precio_promedio":número o null,"version":"versión","fuente_url":"url","nota":"aclaración"},"mercadolibre":[{"año":número,"version":"versión","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"fecha","ubicacion":"ciudad","url":"url"}],"rosario_garage":[{"año":número,"version":"versión","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"fecha","vendedor":"agencia o Particular","url":"url"}]}

Reglas: 5-12 listings reales de MercadoLibre, todos los de Rosario Garage. Precios en ARS como números puros sin puntos ni comas ni símbolos. Si el precio está en USD estimalo en ARS al tipo blue actual e incluí ambos.`;

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
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(500).json({ error: 'Error al consultar la API' });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    let parsed = null;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (e) {
      console.error('Parse error:', e);
    }

    if (!parsed) return res.status(500).json({ error: 'No se pudo procesar la respuesta' });

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
