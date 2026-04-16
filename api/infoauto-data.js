import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const data = await kv.get('infoauto:current');
    if (!data) return res.status(200).json({ available: false });
    return res.status(200).json({
      available: true,
      label: data.label,
      uploadedAt: data.uploadedAt,
      chars: data.chars
    });
  } catch {
    return res.status(200).json({ available: false });
  }
}
