// Vitest mock for next/headers.
// Real implementation uses React cache + async context; tests replace
// it with a simple stub that returns no cookies by default.
export const cookies = async () => ({ get: () => undefined });
