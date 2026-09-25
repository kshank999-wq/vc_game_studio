# VC Game Studio

Home of VC Game Studio's browser games. Everything is plain HTML, CSS and
JavaScript, so there is no build step.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Layout

```
index.html              Studio landing page and game catalog
css/studio.css          Shared styles
games/<name>/           One folder per game (index.html + game.js)
.github/workflows/      GitHub Pages deployment
```

## Adding a game

1. Create `games/<your-game>/index.html` and its scripts.
2. Add a card for it in the `games` list in `index.html`.

## Deployment

Pushes to `main` deploy the site to GitHub Pages via
`.github/workflows/pages.yml`. Turn it on once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Games

| Game | Description |
| --- | --- |
| [Star Dodge](games/star-dodge/) | Steer your ship through a meteor field. Arrow keys / A-D, or touch. |
