# Overseer

A Vite+ monorepo organized around two workspace directories:

- `apps/` contains runnable entry points.
- `packages/` contains supporting code packages.

Each workspace package owns its scripts and declares its relationships to other workspace packages in `package.json`.

## Tasks

Run the repository checks through Vite Task:

```bash
vp run ready
```

Once workspace packages define `test` and `build` scripts, run them across the monorepo with:

```bash
vp run -r test
vp run -r build
```

Run an app and its transitive workspace dependencies:

```bash
vp run -t <app-package-name>#build
```

Shared Vite Task caching is enabled in `vite.config.ts`.

## API

Run the API locally in workerd at `http://localhost:8787`:

```bash
vp run @overseer/api#dev
```

Deploy or destroy the only remote environment, `production`:

```bash
vp run @overseer/api#deploy
vp run @overseer/api#destroy:production
```
