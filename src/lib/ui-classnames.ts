import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names while resolving Tailwind utility conflicts. */
export function cn(...inputs: ReadonlyArray<ClassValue>): string {
  return twMerge(clsx(inputs));
}
