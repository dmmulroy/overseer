/** Lab Core Web Vitals captured from Chromium performance entries. */
export type LabWebVitals = Readonly<{
  lcpMs: number;
  cls: number;
  inpMs: number;
}>;

function numberProperty(value: object, key: string): number | undefined {
  if (!(key in value)) {
    return undefined;
  }
  const property: unknown = Reflect.get(value, key);
  return typeof property === "number" ? property : undefined;
}

function booleanProperty(value: object, key: string): boolean | undefined {
  if (!(key in value)) {
    return undefined;
  }
  const property: unknown = Reflect.get(value, key);
  return typeof property === "boolean" ? property : undefined;
}

/** Start observers before Foldkit renders so initial LCP and layout shifts are included. */
export function observeLabWebVitals(): Readonly<{
  read: () => LabWebVitals;
  dispose: () => void;
}> {
  let lcpMs = 0;
  let cls = 0;
  let inpMs = 0;
  const observers: Array<PerformanceObserver> = [];
  const observe = (
    type: string,
    onEntry: (entry: PerformanceEntry) => void,
    options: PerformanceObserverInit,
  ): void => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
      return;
    }
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        onEntry(entry);
      }
    });
    observer.observe(options);
    observers.push(observer);
  };
  observe("largest-contentful-paint", (entry) => {
    lcpMs = Math.max(lcpMs, entry.startTime);
  }, { type: "largest-contentful-paint", buffered: true });
  observe("layout-shift", (entry) => {
    if (booleanProperty(entry, "hadRecentInput") !== true) {
      cls += numberProperty(entry, "value") ?? 0;
    }
  }, { type: "layout-shift", buffered: true });
  const eventObserverOptions: PerformanceObserverInit = {
    type: "event",
    buffered: true,
  };
  Reflect.set(eventObserverOptions, "durationThreshold", 16);
  observe("event", (entry) => {
    if ((numberProperty(entry, "interactionId") ?? 0) > 0) {
      inpMs = Math.max(inpMs, entry.duration);
    }
  }, eventObserverOptions);
  return {
    read: () => ({ lcpMs, cls, inpMs }),
    dispose: () => {
      for (const observer of observers) {
        observer.disconnect();
      }
    },
  };
}
