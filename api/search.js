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
          infoautoContext = 'PRECIOS INFOAUTO PDF (' + infoautoLabel + '):\n' + snippet;
        }
      }
    }
  } catch (e) { console.log('Infoauto error:', e.message); }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY no configurada' });

  const prompt = 'Busca precios de referencia en Argentina para: ' + vehiculo + '\n' +
    (infoautoContext ? '\nDATOS INFOAUTO PDF (' + infoautoLabel + ') - ignora motos, busca el auto:\n' + infoautoContext + '\n' : '') +
    '\nBusca en Google resultados reales y actuales:\n' +
    '1. ' + vehiculo + ' en autos.mercadolibre.com.ar - 5 a 8 publicaciones con precio, km, año y URL\n' +
    '2. ' + vehiculo + ' en rosariogarage.com - todas las que encuentres\n' +
    (infoautoLabel ? '3. Infoauto: usa los datos del PDF de arriba' : '3. Precio referencia de infoauto.com.ar') + '\n' +
    '\nResponde SOLO con JSON valido sin texto ni backticks:\n' +
    '{"vehiculo":"' + vehiculo + '","infoauto":{"precio_min":numero,"precio_max":numero,"precio_promedio":numero,"version":"texto","nota":"fuente"},' +
    '"mercadolibre":[{"año":numero,"version":"texto","km":numero,"precio_ars":numero,"precio_usd":numero,"fecha_publicacion":"texto","ubicacion":"ciudad","url":"https://..."}],' +
    '"rosario_garage":[{"año":numero,"version":"texto","km":numero,"precio_ars":numero,"precio_usd":numero,"fecha_publicacion":"texto","vendedor":"texto","url":"https://..."}]}\n' +
    'Precios ARS como enteros sin separadores. Si precio en USD calcula ARS al tipo blue actual (~1260).';

  try {
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        })
      }
    );
    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error('Gemini error:', JSON.stringify(geminiData).substring(0, 300));
      return res.status(500).json({ error: 'Error Gemini: ' + (geminiData.error?.message || 'desconocido') });
    }
    const text = (geminiData.candidates?.[0]?.content?.parts || [])
      .filter(p => p.text).map(p => p.text).join('');
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
    return res.status(500).json({ error: 'Error: ' + err.message });
  }
}
