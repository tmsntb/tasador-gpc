# Tasador GPC v4 — Con login admin y PDF Infoauto mensual

## Variables de entorno en Vercel (Settings → Environment Variables)

Agregá estas 3 variables:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic |
| `ADMIN_PASSWORD` | La contraseña del panel admin |
| `JWT_SECRET` | Cualquier string largo aleatorio, ej: `gpc_tasador_secret_2026` |

## Vercel KV (base de datos para el PDF de Infoauto)

1. En el dashboard de Vercel → tu proyecto → **Storage**
2. Click en **Create Database** → seleccioná **KV**
3. Nombrala `tasador-kv` → Create
4. Vercel conecta automáticamente el KV al proyecto (agrega las variables de entorno KV_URL, etc. solo)

## Cómo usar el panel admin

1. Entrá a `https://tasador-gpc.vercel.app/admin.html`
2. Ingresá la contraseña de admin
3. Subí el PDF de Infoauto del mes
4. Todos los usuarios ya usan los precios actualizados automáticamente

## Archivos del proyecto

```
api/
  admin-login.js    ← valida contraseña, devuelve token JWT
  admin-upload.js   ← recibe PDF, extrae texto, guarda en KV
  infoauto-data.js  ← devuelve metadatos del PDF actual
  search.js         ← búsqueda principal (Haiku + web search)
public/
  index.html        ← tasador público
  admin.html        ← panel admin protegido
  [fuentes y logo]
```
