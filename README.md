# MAMA Website

Landing page for [MAMA](https://github.com/CrankyTitanO7/mama) — build, train, and run AI models locally.

## Deploying to GitHub Pages

### Option A — GitHub Actions (auto-deploy)

Add this workflow at `.github/workflows/pages.yml` in this repository:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [pywebview]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then in the repo settings: **Settings → Pages → Source: GitHub Actions**.

### Option B — Push to a `gh-pages` branch

```bash
git branch -M pywebview
git push -u origin pywebview
git push origin pywebview:gh-pages
```

Then in the repo settings: **Settings → Pages → Deploy from a branch → `gh-pages` / root**.
