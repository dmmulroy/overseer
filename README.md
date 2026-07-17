# Overseer timeline and contribution prototype

Throwaway Foldkit and `@foldkit/ui` prototype for [issue #33](https://github.com/dmmulroy/overseer/issues/33).

This round keeps the selected **Utility** theme fixed and compares three materially different ways to combine the issue body, comments, structured events, actor attribution, Markdown composition, and attachments:

- **A — Thread + digests:** the body is the opening post, comments form the readable timeline, and low-signal structured events collapse into an expandable digest.
- **B — Brief + work log:** a pinned brief sits beside an outcome-based journal that groups comments, artifacts, and summarized mechanics into phases.
- **C — Focused channels:** conversation, complete structured history, and attachments occupy separate channels so operational records never interrupt the default discussion.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4183/prototype/timeline-contribution?variant=A>.

Use the floating switcher or left/right arrow keys to compare variants. Interaction targets include:

- expanding the structured-event digest in A;
- switching the Markdown composer between Write and Preview in A or B;
- collapsing the pinned brief in B;
- switching among Conversation, Changes, and Files in C.

## Proof

`evidence/` contains browser-captured desktop/mobile comparisons, screenshots of each interaction state, and a walkthrough video. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
