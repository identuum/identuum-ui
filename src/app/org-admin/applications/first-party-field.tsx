/**
 * The first-party checkbox of the application forms (D-018, D-026): a
 * first-party application signs the user in without the consent page — for
 * name and email only; a request for more still shows it. The IdP refuses it
 * for a public application or one created through dynamic registration, asks
 * for the admin's authenticator code to turn it on, and audits every change.
 */
export const FIRST_PARTY_LABEL = "First-party (skip consent)";
export const FIRST_PARTY_WARNING =
  "Users will not be asked to consent to this application's sign-in (name and email); anything more still asks. Mark only applications your organization runs.";
/** The badge the console shows on an application that skips consent (D-026). */
export const SKIPS_CONSENT_BADGE = "Skips consent";
export const FIRST_PARTY_CODE_LABEL = "Your authenticator code";
export const FIRST_PARTY_CODE_HINT = "Needed when you turn this on.";

export function FirstPartyField({
  defaultChecked,
  disabled,
}: {
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <input
          id="app-skip-consent"
          name="skip_consent"
          type="checkbox"
          defaultChecked={defaultChecked}
          disabled={disabled}
          className="mt-0.5 rounded border-stone-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50"
        />
        <label htmlFor="app-skip-consent" className="text-sm text-sky-950 leading-tight">
          {FIRST_PARTY_LABEL}
          <span className="block text-xs text-amber-700 mt-0.5">{FIRST_PARTY_WARNING}</span>
        </label>
      </div>
      <div className="ml-6">
        <label htmlFor="app-skip-consent-code" className="block text-xs font-semibold text-sky-950">
          {FIRST_PARTY_CODE_LABEL}
        </label>
        <input
          id="app-skip-consent-code"
          name="mfa_code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          disabled={disabled}
          className="mt-1 w-40 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-mono text-sky-950 focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:opacity-50"
        />
        <span className="block text-xs text-stone-500 mt-0.5">{FIRST_PARTY_CODE_HINT}</span>
      </div>
    </div>
  );
}
