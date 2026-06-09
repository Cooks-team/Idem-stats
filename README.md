# idem-stats — web app (desktop)

App desktop de **idem-stats**. Deux rôles :
1. Consulter stats / PODIUM, créer/suivre des matchs 1v1.
2. Héberger des mini-jeux 1v1 jouables localement dont le résultat est enregistré dans l'API.

## Stack
React 18 + Vite + TypeScript, React Router, TanStack Query (polling/caching). CSS du design conservé tel quel (`src/styles/design.css`). Token JWT en mémoire + persistance `localStorage`.

## Configuration

```bash
cp .env.example .env
# VITE_API_BASE_URL pointe par défaut sur http://localhost:3000
npm install
npm run dev
```
