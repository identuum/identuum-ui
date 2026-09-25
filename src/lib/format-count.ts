// UI-DATES (owner decision U-020): a count formatted in the runtime's default
// locale can render differently on the server and in the browser ("1,234" vs
// "1.234") — the same hydration mismatch the dates had. One fixed locale here;
// src/__tests__/local-time-guard.test.ts refuses toLocaleString elsewhere.

const COUNT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT.format(n);
}
