/**
 * D3 (v0.9.13): the plain words for the Applications tab. A scope the list
 * does not know is shown as the app sent it.
 */

const SCOPE_WORDS: Record<string, string> = {
  openid: "who you are",
  email: "your email address",
  profile: "your name",
  phone: "your phone number",
  address: "your address",
  offline_access: "stay signed in",
};

export function scopeWords(scopes: string[]): string[] {
  return scopes.map((s) => SCOPE_WORDS[s] ?? s);
}

function unit(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** A lifetime in seconds, in the largest whole unit: 3600 -> "1 hour". */
export function lifetimeWords(seconds: number): string {
  if (seconds % 3600 === 0) return unit(seconds / 3600, "hour");
  if (seconds % 60 === 0) return unit(seconds / 60, "minute");
  return unit(seconds, "second");
}

export function removeConfirmText(app: string, lifetimeSeconds: number): string {
  return `${app} will have to ask you again next time. It may keep working for up to ${lifetimeWords(lifetimeSeconds)}.`;
}
