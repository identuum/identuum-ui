/**
 * CE-UI-2b: the page a mail ceremony (forgot password, reset password, email
 * verification, activation) renders where the IdP sends no mail
 * (capabilities.mail_ceremonies === false). It calls nothing.
 */
export function MailCeremonyUnavailable({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-100">
            <h1 className="text-lg font-bold tracking-tight text-sky-950">{title}</h1>
          </div>
          <div className="px-6 py-5 space-y-3">
            <p className="text-sm text-stone-600 leading-relaxed">
              This is not available on this installation: it sends no email.
            </p>
            <p className="text-sm text-stone-600 leading-relaxed">
              Ask your administrator to reset your password.
            </p>
            <a
              href="/login"
              className="inline-block text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
            >
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
