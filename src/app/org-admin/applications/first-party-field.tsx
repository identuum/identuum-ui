/**
 * The first-party checkbox of the application forms (D-018): a first-party
 * application gets sign-in codes without the consent page. The IdP refuses
 * it for a public client and audits every change.
 */
export const FIRST_PARTY_LABEL = "First-party (skip consent)";
export const FIRST_PARTY_WARNING =
  "Users will not be asked to consent to this application — mark only applications your organization runs.";

export function FirstPartyField({
  defaultChecked,
  disabled,
}: {
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
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
  );
}
