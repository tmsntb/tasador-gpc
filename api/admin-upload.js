import { jwtVerify } from 'jose';

export const config = { api: { bodyParser: { sizeLimit: '30mb' } } };

async function verifyToken(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'gpc_default_secret');
  await jwtVerify(token, secret);
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=([^\s;]+)/);
      if (!bm) return reject(new Error('No boundary'));
      const boundary = '--' + bm[1];
      const parts = body.toString('binary').split(boundary);
      for (const part of parts) {
        if (part.includes('filename=') || part.includes('application/pdf')) {
          const idx = part.indexOf('\r\n\r\n');
          if (idx === -1) continue;
          const content = part.slice(idx + 4, part.lastIndexOf('\r\n'));
          resolve(Buffer.from(content, 'binary'));
          return;
        }
      }
      reject(new Error('No PDF found'));
    });
    req.on('error', reject);
  });
}

async function extractTextFromPDF(pdfBuffer) {
  const { writeFileSync, readFileSync, unlinkSync, existsSync } = await import('fs');
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const execAsync = promisify(exec);

  const tmpIn = join(tmpdir(), `ia_${Date.now()}.pdf`);
  const tmpOut = tmpIn.replace('.pdf', '.txt');
  try {
    writeFileSync(tmpIn, pdfBuffer);
    await execAsync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`);
    return readFileSync(tmpOut, 'utf8');
  } finally {
    if (existsSync(tmpIn)) unlinkSync(tmpIn);
    if (existsSync(tmpOut)) unlinkSync(tmpOut);
  }
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

  // Get current file SHA (needed to update)
  let sha = null;
  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  // Commit the file
  const body = {
    message: `Infoauto ${label} — actualización automática`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  };

  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub error: ${err}`);
  }
  return await putRes.json();
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
    const pdfBuffer = await parseMultipart(req);
    const text = await extractTextFromPDF(pdfBuffer);
    if (!text || text.trim().length < 100)
      return res.status(422).json({ error: 'No se pudo extraer texto del PDF' });

    const now = new Date();
    const label = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    await saveToGitHub(text, label);

    return res.status(200).json({ ok: true, label, chars: text.length });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
