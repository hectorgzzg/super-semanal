# Súper semanal

Upload a photo of your weekly nutrition plan. The app reads it with Gemini, adds up the ingredients (skipping crossed-out meals), asks what you already have, and gives you a shopping list grouped by department that you can copy or share.

## Run locally

ES modules need an HTTP server (opening the file directly won't work):

```sh
python3 -m http.server 8000
```

- App: http://localhost:8000
- Tests: http://localhost:8000/test.html

## Deploy to GitHub Pages

Push to GitHub → **Settings → Pages** → Source: `main` branch, `/ (root)`.

## Gemini API key

Create a free key at https://aistudio.google.com/apikey and paste it in **Ajustes**. It is stored only in your browser (`localStorage`) and never committed to the repo. The photo is sent to Google; on the free tier Google may use it to improve its products.

No key? Use **Usar plan de ejemplo** or **Capturar manualmente**.
