import type { ProjectSync } from "./project-sync";

/** Attach real viewport dwell/exit behavior to the stable Foldkit Issue rows. */
export function attachViewportPrefetch(
  container: HTMLElement,
  sync: ProjectSync,
): Readonly<{ dispose: () => void }> {
  const root = container.querySelector<HTMLElement>(".issue-list");
  if (root === null) {
    throw new Error("The Foldkit Issue list was not rendered");
  }
  const observed = new Map<Element, number>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const issueNumber = observed.get(entry.target);
      if (issueNumber === undefined) {
        continue;
      }
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        sync.viewportEnter(issueNumber);
      } else {
        sync.viewportExit(issueNumber);
      }
    }
  }, {
    root,
    threshold: [0, 0.6],
  });
  for (const row of container.querySelectorAll<HTMLElement>("[data-issue-number]")) {
    const issueNumber = Number(row.dataset.issueNumber);
    if (Number.isInteger(issueNumber)) {
      observed.set(row, issueNumber);
      observer.observe(row);
    }
  }
  return {
    dispose: () => {
      observer.disconnect();
      for (const issueNumber of observed.values()) {
        sync.viewportExit(issueNumber);
      }
    },
  };
}
