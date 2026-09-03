import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes, letting later ones win conflicts.
 *
 * Time and distance formatting used to live here too; it now sits in
 * lib/format.ts and lib/geo.ts next to the domain code that owns those units,
 * rather than in a general-purpose bucket where two versions could drift.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
