# Bluehost SPA Deploy (Frontend Only)

This app can be hosted on Bluehost as a static React bundle, but the backend must remain on Firebase:

- Firebase Auth
- Firestore
- Storage
- Cloud Functions (including Stripe webhook + checkout callables)

## 1) Build with production env

1. Copy `.env.production.example` to `.env.production.local`.
2. Fill in real production Firebase values.
3. Validate:

```bash
npm run validate:env:prod
```

4. Build:

```bash
npm run build:prod:bluehost
```

## 2) Upload to Bluehost

Upload the contents of `build/` to your Bluehost web root (for example `public_html/`).

## 3) Enable SPA route fallback (required)

Create/merge a `.htaccess` file in the web root so direct refreshes on nested routes do not 404.

Example `.htaccess`:

```apacheconf
RewriteEngine On

# Let existing files and directories pass through
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# React SPA fallback
RewriteRule ^ index.html [L]
```

This is required for routes like:

- `/login`
- `/register`
- `/demo/surl`
- `/checkout`
- `/checkout/success`
- `/trainee/...`
- `/admin/...`

## 4) Production smoke checks after upload

- Load `/`
- Refresh `/login`
- Refresh `/demo/surl`
- Refresh a nested route after signing in (for example `/trainee/dashboard`)
- Confirm browser console has no Firebase configuration errors

## Notes

- If you host under a subdirectory instead of the domain root, the CRA build path assumption (`/`) must be adjusted before build.
- HTTPS should be enabled before launch (required for modern browser security expectations and recommended for Firebase flows).
