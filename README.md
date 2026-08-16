# AI Provider Router

Serveur local OpenAI-compatible (v1) destiné à Cline, avec le modèle virtuel `router-auto`.
Les providers Gemini, Groq et OpenRouter implémentent la même interface; sans clé configurée,
le serveur utilise `MockProvider` pour le développement.

Install

```bash
cd ai-provider-router
npm install
cp .env.example .env
# remplir les clés dans .env si besoin
npm run dev
```

Endpoints disponibles:

- `POST /v1/chat/completions` — chat completions OpenAI-compatible avec fallback.
- `GET /v1/models` — contient toujours `router-auto` (et temporairement les modèles concrets).

Les erreurs HTTP sont normalisées en `ProviderError`. `QuotaManager` conserve en mémoire l'état
des providers et applique les cooldowns après rate limit. Les erreurs retryable déclenchent une
nouvelle sélection par priorité, sans réessayer un provider déjà tenté pour la requête.

Ce projet reste expérimental : il n'y a ni persistance de quota, ni streaming, ni contrôle de
compatibilité Cline au-delà de cette API minimale.
# ai-provider-router
