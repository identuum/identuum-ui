"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type DisableMfaState,
  disableMfaAction,
  type RegenerateRecoveryCodesState,
  regenerateRecoveryCodesAction,
} from "./mfa-actions";

export function RecoveryCodesRegenerateForm() {
  const [state, action, isPending] = useActionState<RegenerateRecoveryCodesState, FormData>(
    regenerateRecoveryCodesAction,
    { phase: "idle" }
  );
  const [confirm, setConfirm] = useState("");
  const disabled = isPending || confirm.trim() !== "REGENERATE";

  return (
    <form action={action} className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-sky-950">Regenerate recovery codes</p>
        <p className="text-xs text-stone-500 mt-1 leading-relaxed">
          Replaces your existing recovery codes. Existing unused codes stop working.
        </p>
      </div>
      <label className="block text-[11px] font-medium text-stone-500">
        Type REGENERATE to confirm
        <input
          name="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending || state.phase === "success"}
          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-mono text-stone-800 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </label>
      {state.phase === "error" && <p className="text-xs text-red-600">{state.error}</p>}
      {state.phase === "success" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 space-y-2">
          <p className="text-xs font-semibold text-emerald-700">New recovery codes generated</p>
          <p className="text-xs text-emerald-700 leading-relaxed">
            Save these now. They will not be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1 text-xs font-mono text-stone-800 select-all">
            {state.recoveryCodes.map((code) => (
              <li key={code} className="rounded bg-white border border-stone-200 px-2 py-1">
                {code}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={isPending}
        disabled={disabled || state.phase === "success"}
      >
        Regenerate codes
      </Button>
    </form>
  );
}

export function DisableMfaForm() {
  const [state, action, isPending] = useActionState<DisableMfaState, FormData>(disableMfaAction, {
    phase: "idle",
  });
  const [confirm, setConfirm] = useState("");
  const disabled = isPending || confirm.trim() !== "DISABLE";

  useEffect(() => {
    if (state.phase === "success") {
      window.location.assign("/login?reason=session_expired");
    }
  }, [state]);

  return (
    <form action={action} className="rounded-xl border border-red-100 bg-red-50 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-red-700">Disable MFA</p>
        <p className="text-xs text-red-700 mt-1 leading-relaxed">
          Requires a current authenticator code or recovery code. Successful disable signs out
          active sessions.
        </p>
      </div>
      <label className="block text-[11px] font-medium text-red-700">
        Type DISABLE to confirm
        <input
          name="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending}
          className="mt-1 w-full rounded-lg border border-red-100 bg-white px-2 py-1.5 text-xs font-mono text-stone-800 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:opacity-50"
        />
      </label>
      {/* THE-STALE-PROOF: the second factor is the only proof the IdP
          accepts here (identuum-idp-ce f89ca88 discards the password), so
          the form asks for nothing else — a password field would walk the
          user into a guaranteed 401 that spends their step-up budget. */}
      <label className="block text-[11px] font-medium text-red-700">
        Authenticator or recovery code
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={isPending}
          className="mt-1 w-full rounded-lg border border-red-100 bg-white px-2 py-1.5 text-xs font-mono text-stone-800 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:opacity-50"
        />
      </label>
      {state.phase === "error" && <p className="text-xs text-red-700">{state.error}</p>}
      <Button type="submit" variant="danger" size="sm" loading={isPending} disabled={disabled}>
        Disable MFA
      </Button>
    </form>
  );
}
