import { SignJWT } from 'jose';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) return res.status(500).json({ error: 'Admin no configurado' });
  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  // Sign JWT valid for 8 hours
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || adminPassword + '_jwt');
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(secret);

  return res.status(200).json({ token });
}
