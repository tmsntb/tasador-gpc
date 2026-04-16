import { kv } from '@vercel/kv';

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

  // Load Infoauto data from KV (uploaded by admin)
  let infoautoContext = '';
  let infoautoLabel = null;
  try {
    const kvData = await kv.get('infoauto:current');
    if (kvData && kvData.text) {
      infoautoLabel = kvData.label;
      // Extract relevant section for this vehicle (send max 4000 chars around brand mentions)
      const text = kvData.text;
      const brandUpper = brand.toUpperCase();
      const idx = text.toUpperCase().indexOf(brandUpper);
      const snippet = idx >= 0 
        ? text.substring(Math.max(0, idx - 100), idx + 4000)
        : text.substring(0, 4000);
      infoautoContext = `\nPRECIOS INFOAUTO DEL PDF (${kvData.label}) — usá estos datos para la sección infoauto:\n${snippet}\n`;
    }
  } catch (e) {
    console.log('KV not available, skipping Infoauto PDF data');
  }

  const prompt = `Buscá precios de referencia para: ${vehiculo} en Argentina.
${infoautoContext}
Fuentes:
${infoautoContext ? `1. Infoauto: usá los datos del PDF (${infoautoLabel}) que te pasé arriba. Son los precios oficiales de referencia.` : '1. Infoauto (infoauto.com.ar): buscá precio de referencia online.'}
2. MercadoLibre Argentina (autos.mercadolibre.com.ar)
3. Rosario Garage (rosariogarage.com)

Respondé ÚNICAMENTE con JSON válido sin texto ni backticks:

{"vehiculo":"nombre completo","infoauto":{"precio_min":número o null,"precio_max":número o null,"precio_promedio":número o null,"version":"versión exacta encontrada","nota":"${infoautoLabel ? 'PDF ' + infoautoLabel : 'web'}"},"mercadolibre":[{"año":número,"version":"versión","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"fecha","ubicacion":"ciudad","url":"url completa con https://"}],"rosario_garage":[{"año":número,"version":"versión","km":número o null,"precio_ars":número o null,"precio_usd":número o null,"fecha_publicacion":"fecha","vendedor":"nombre","url":"url completa con https://"}]}

Reglas: 5-8 listings de MercadoLibre, todos los de Rosario Garage. Precios ARS como números puros. Si precio en USD estimalo en ARS al blue actual. URLs completas con https://.`;

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
