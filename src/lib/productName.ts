/**
 * The product the frontend is running as. Shared UI (provider settings, the
 * quit check) names it in messages; the standalone Archives 47 entry calls
 * `setProductName` before rendering. Orion Studio never calls it.
 */
let full = "Orion Studio";
let short = "Orion";

export function setProductName(fullName: string, shortName = fullName): void {
  full = fullName;
  short = shortName;
}

export function productName(): string {
  return full;
}

export function productShortName(): string {
  return short;
}
