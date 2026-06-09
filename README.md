# idem-stats — web app (desktop)

App desktop de **idem-stats**. Deux rôles :
1. Consulter stats / PODIUM, créer/suivre des matchs 1v1.
2. Héberger des mini-jeux 1v1 jouables localement dont le résultat est enregistré dans l'API.

## Stack
React 18 + Vite + TypeScript, React Router, TanStack Query (polling/caching). CSS du design conservé tel quel (`src/styles/design.css`). Token JWT en mémoire + persistance `localStorage`.

## Boot rapide (Docker + Traefik externe)

Pré-requis : un Traefik tourne déjà sur le réseau Docker externe `traefik`.

```bash
cp .env.example .env

# dev (HTTP, Vite avec HMR)
docker compose --profile nossl up

# prod (HTTPS via myhttpchallenge, build + preview)
docker compose --profile ssl up -d
```

L'app est servie par Traefik sur `http(s)://${DOMAIN_WEBSITE}` (port 3000 interne).

## Boot rapide (hors Docker)

```bash
cp .env.example .env
npm install
npm run dev
```
