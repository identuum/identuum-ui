/**
 * /logout — the sign-out page (CE-UI-1, decision 3: the UI owns /logout on
 * both editions).
 *
 * Loading the page never signs out: a GET can be triggered by any link or
 * prefetch. Only the POST of its form does, through the same sign-out the
 * account menu posts (/api/auth/logout; the static export maps it to the
 * boundary's logout, export/src/main.tsx).
 */

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign out — Identuum" };

export default function LogoutPage() {
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <section
        data-testid="logout"
        className="w-full max-w-md rounded-[1.5rem] border border-stone-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-stone-900">Sign out</h1>
        <p className="mt-2 text-sm text-stone-600">
          Sign out of Identuum on this device. Your session will end.
        </p>
        <form method="POST" action="/api/auth/logout" className="mt-6">
          <button
            type="submit"
            data-testid="logout-confirm"
            className="w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
