"use client";

import { useActionState } from "react";
import type { RegistrationInfo } from "@/lib/idp-registration-client";
import { type RegisterState, registerAction } from "./actions";
import { registrationAcceptedMessage } from "./register-helpers";

const input =
  "w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-sky-950 focus:outline-none focus:ring-2 focus:ring-sky-500";

export function RegisterFormClient({ slug, info }: { slug: string; info: RegistrationInfo }) {
  const [state, action, pending] = useActionState(registerAction, {
    phase: "form",
  } as RegisterState);
  if (state.phase === "accepted") {
    return (
      <div className="space-y-4" data-testid="register-accepted">
        <h1 className="text-lg font-bold text-sky-950 tracking-tight">Request received</h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          {registrationAcceptedMessage(info)}
        </p>
        <a
          href="/login"
          className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
        >
          Go to sign in →
        </a>
      </div>
    );
  }
  const policy = info.password_policy;
  return (
    <form action={action} className="space-y-4" data-testid="register-form">
      <h1 className="text-lg font-bold text-sky-950 tracking-tight">Create your account</h1>
      <input type="hidden" name="slug" value={slug} />
      <div className="space-y-1">
        <label htmlFor="register-email" className="block text-xs font-semibold text-stone-700">
          Email
        </label>
        <input
          id="register-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={input}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="register-name" className="block text-xs font-semibold text-stone-700">
          Name
        </label>
        <input
          id="register-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          className={input}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="register-password" className="block text-xs font-semibold text-stone-700">
          Password
        </label>
        <input
          id="register-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={policy?.min_length}
          aria-describedby="register-password-hint"
          className={input}
        />
        {policy && (
          <p id="register-password-hint" className="text-xs text-stone-500">
            At least {policy.min_length} characters
            {policy.complexity ? ", with upper- and lower-case letters, a digit and a symbol" : ""}.
          </p>
        )}
        {state.error && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Create account"}
      </button>
    </form>
  );
}
