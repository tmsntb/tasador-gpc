import { jwtVerify } from 'jose';
import { kv } from '@vercel/kv';

export const config = { api: { bodyParser: { sizeLimit: '25mb' } } };

function verifyToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) throw new Error('No token');
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET || (process.env.ADMIN_PASSWORD + '_jwt')
  );
  return jwtVerify(token, secret);
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=(.+)/);
      if (!bm) return reject(new Error('No boundary'));
      const boundary = '--' + bm[1].trim();
      const parts = body.toString('binary').split(boundary);
      for (const part of parts) {
        if (part.includes('filename=') && (part.includes('application/pdf') || part.includes('.pdf'))) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const fileContent = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'));
          resolve(Buffer.from(fileContent, 'binary'));
          return;
        }
      }
      reject(new Error('No PDF in request'));
    });
    req.on('error', reject);
  });
}

// Extract text from PDF using pdftotext (available in Vercel Linux runtime)
async function extractPDFText(pdfBuffer) {
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
    try {
      await execAsync(`pdftotext -layout "${tmpIn}" "${tmpOut}"`);
      return readFileSync(tmpOut, 'utf8');
    } catch {
      // Fallback: return base64 and note OCR needed
      return null;
    }
  } finally {
    if (existsSync(tmpIn)) unlinkSync(tmpIn);
    if (existsSync(tmpOut)) unlinkSync(tmpOut);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify admin token
  try {
    await verifyToken(req);
  } catch {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const pdfBuffer = await parseMultipart(req);
    const text = await extractPDFText(pdfBuffer);

    if (!text) return res.status(422).json({ error: 'No se pudo extraer texto del PDF' });

    // Save to Vercel KV with month/year label
    const now = new Date();
    const label = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    
    await kv.set('infoauto:current', {
      text: text.substring(0, 50000), // store up to 50k chars
      label,
      uploadedAt: now.toISOString(),
      chars: text.length
    });

    return res.status(200).json({ 
      ok: true, 
      label,
      chars: text.length,
      preview: text.substring(0, 200)
    });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message || 'Error al procesar el PDF' });
  }
}
