/**
 * OSS v0.9.13 (Q-B2 a): a password an administrator sets must be changed at
 * the next sign-in; the user answer says so in requires_password_change.
 * identuum-idp-ce does not send the field, so nothing is shown there.
 */
export function PasswordChangeRow({ required }: { required: boolean }) {
  if (!required) return null;
  return (
    <div className="px-6 py-3 flex items-start justify-between gap-4">
      <dt className="text-xs font-medium text-stone-500 shrink-0 w-32">Password</dt>
      <dd className="text-right">
        <span className="text-xs text-amber-600 font-medium">
          Must choose a new password at next sign-in.
        </span>
      </dd>
    </div>
  );
}
