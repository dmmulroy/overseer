# Overseer client-pipeline prototype

> **THROWAWAY PROTOTYPE — not production code.**

This specimen asks whether Overseer’s simple-REST client can stay small while wiring one shared Effect `HttpApi` declaration through a generated client, an application-owned conditional-read cache, Effect Atom query/command atoms, React, and TanStack Router. It exposes request, ETag, freshness, route, optimistic-overlay, draft, and failure state so the architecture can be judged directly.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173/projects/project_01/issues>.

Use the **Failure lab** to trigger external changes, stale reads, delayed responses, failed reads/writes, and resets. Canonical reads are memory-only. For cheap browser feedback, title drafts persist in `localStorage`; this is explicitly a prototype stand-in for the production IndexedDB draft adapter required by larger Issue-body and Comment drafts.
