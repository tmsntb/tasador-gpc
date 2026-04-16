export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 min
  if (req.method !== 'GET') return res.status(405).end();

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/data/infoauto.json`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!ghRes.ok) return res.status(200).json({ available: false });

    const file = await ghRes.json();
    const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

    return res.status(200).json({
      available: true,
      label: content.label,
      updatedAt: content.updatedAt,
      chars: content.chars
    });
  } catch {
    return res.status(200).json({ available: false });
  }
}
