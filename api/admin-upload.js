import { jwtVerify } from 'jose';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

async function verifyToken(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'gpc_default_secret');
  await jwtVerify(token, secret);
}

async function saveToGitHub(text, label) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) throw new Error('GitHub env vars not set');

  const path = 'data/infoauto.json';
  const content = JSON.stringify({
    text: text.substring(0, 60000),
    label,
    updatedAt: new Date().toISOString(),
    chars: text.length
  }, null, 2);

  let sha = null;
  const getRes = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path, {
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' }
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const body = {
    message: 'Infoauto ' + label + ' — actualización automática',
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  };

  const putRes = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path, {
    method: 'PUT',
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error('GitHub error: ' + err.substring(0, 200));
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try { await verifyToken(req); }
  catch { return res.status(401).json({ error: 'No autorizado' }); }

  try {
    const { text, label } = req.body || {};
    if (!text || text.trim().length < 100)
      return res.status(422).json({ error: 'Texto vacío o muy corto' });

    const finalLabel = label || (String(new Date().getMonth()+1).padStart(2,'0') + '/' + new Date().getFullYear());
    await saveToGitHub(text, finalLabel);

    return res.status(200).json({ ok: true, label: finalLabel, chars: text.length });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
