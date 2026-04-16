# Tasador GPC v5

## Variables de entorno en Vercel (Settings → Environment Variables)

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic |
| `ADMIN_PASSWORD` | Contraseña del panel admin |
| `JWT_SECRET` | String aleatorio, ej: `gpc_tasador_secret_2026` |
| `GITHUB_OWNER` | Tu usuario de GitHub, ej: `tmsntb` |
| `GITHUB_REPO` | Nombre del repo, ej: `tasador-gpc` |
| `GITHUB_TOKEN` | Token de acceso de GitHub (ver abajo) |

## Cómo crear el GITHUB_TOKEN

1. GitHub → tu perfil → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token (classic)
3. Nombre: `tasador-gpc-deploy`
4. Permisos: solo tildar **repo** (acceso completo al repositorio)
5. Generate token — copialo y pegalo en Vercel como `GITHUB_TOKEN`

## Cómo funciona

- Admin sube el PDF en `/admin.html`
- El servidor extrae el texto y lo guarda en `data/infoauto.json` en el repo de GitHub
- Las búsquedas leen ese archivo automáticamente
- No necesita base de datos externa

## Panel admin

URL: `https://tasador-gpc.vercel.app/admin.html`
