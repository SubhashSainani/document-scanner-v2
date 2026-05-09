# Deployment Guide

This app is a fully static frontend — no server, no database, no environment variables needed. Any static hosting service works.

---

## A. Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Run development server

```bash
npm run dev
```

The app opens at `http://localhost:5173`.

> **Camera note:** browsers require HTTPS (or localhost) to access the camera. The dev server at `localhost` works fine; for mobile testing on your phone, use the local network IP shown in the terminal (also served over the dev server, camera works there too).

### 3. Build for production

```bash
npm run build
```

Output goes to `dist/`. These are plain static files — open `dist/index.html` locally or upload the folder to any host.

### 4. Preview the production build

```bash
npm run preview
```

Opens the built app at `http://localhost:4173`.

---

## B. GitHub Setup

### 1. Initialize git repository

```bash
git init
git add .
git commit -m "Initial commit: document scanner app"
```

### 2. Create a GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Name your repository (e.g. `document-scanner`)
3. Leave it public or private — your choice
4. **Do not** initialize with a README (you already have one)
5. Click **Create repository**

### 3. Push your code to GitHub

Replace `YOUR_USERNAME` and `YOUR_REPO` with your own values:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## C. Deployment Options

### Option 1 — Vercel ⭐ Recommended

The easiest option. Zero configuration needed.

#### Via Vercel Dashboard (no CLI)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**
3. Import your GitHub repository
4. Vercel auto-detects Vite — leave all settings as default
5. Click **Deploy**

Your app is live in ~60 seconds at `https://your-repo.vercel.app`.

#### Via Vercel CLI

```bash
npm install -g vercel
vercel
```

Follow the prompts. On first deploy it will ask you to link a project.

**Subsequent deploys:**

```bash
vercel --prod
```

---

### Option 2 — Netlify

#### Via Netlify Dashboard (no CLI)

1. Go to [netlify.com](https://netlify.com) and sign in with GitHub
2. Click **Add new site → Import an existing project**
3. Connect your GitHub repository
4. Set build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
5. Click **Deploy site**

#### Via Netlify CLI

```bash
npm install -g netlify-cli
npm run build
netlify deploy --dir=dist --prod
```

---

### Option 3 — GitHub Pages

GitHub Pages requires a small configuration change because it serves your app from a subdirectory path (e.g. `/your-repo-name/`).

#### Step 1 — Update vite.config.ts

Change the `base` option to match your repository name:

```ts
// vite.config.ts
export default defineConfig({
  base: "/your-repo-name/",   // <-- add this line
  ...
});
```

#### Step 2 — Build

```bash
npm run build
```

#### Step 3 — Deploy with gh-pages

```bash
npm install --save-dev gh-pages
npx gh-pages -d dist
```

#### Step 4 — Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings → Pages**
3. Under **Source**, select **Deploy from a branch**
4. Choose branch `gh-pages`, folder `/ (root)`
5. Save

Your app is live at `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

> **Note:** The camera only works on HTTPS. GitHub Pages, Vercel, and Netlify all serve over HTTPS automatically.

---

## Comparison

| Feature | Vercel | Netlify | GitHub Pages |
|---------|--------|---------|--------------|
| Setup time | ~2 min | ~3 min | ~5 min |
| HTTPS | Auto | Auto | Auto |
| Custom domain | Free | Free | Free |
| Auto-deploy on push | Yes | Yes | Manual or CI |
| Config needed | None | None | `base` path change |
| **Recommended** | **Yes** | Yes | Not ideal |

---

## Custom Domain

All three platforms support custom domains for free:

- **Vercel:** Settings → Domains → Add
- **Netlify:** Site settings → Domain management → Add custom domain
- **GitHub Pages:** Settings → Pages → Custom domain

---

## Environment Variables

This app has **no required environment variables**. It runs entirely in the browser.

---

## After Deployment

1. Open your live URL on a mobile device
2. Grant camera permissions when prompted
3. Point the camera at a document — the green border shows when a document is detected
4. Tap the capture button to scan
5. Optionally adjust corners, then export as PNG or PDF
