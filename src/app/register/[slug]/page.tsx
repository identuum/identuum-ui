/**
 * /register/<org_slug> — public self-registration (D-021).
 *
 * The IdP's GET /api/v1/auth/register/:org_slug reads {open:false} for a
 * closed, unknown or idp_only organization alike, so this page has one
 * closed state for all three: "Sign-up is not available".
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRegistrationInfo } from "@/lib/idp-registration-client";
import { RegisterFormClient } from "./form-client";
import { REGISTER_CLOSED } from "./register-helpers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign up — Identuum" };

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const info = slug ? await getRegistrationInfo(slug) : null;
  return (
    <RegisterLayout>
      {info?.ok && info.value.open ? (
        <RegisterFormClient slug={slug} info={info.value} />
      ) : (
        <div className="space-y-4" data-testid="register-closed">
          <h1 className="text-lg font-bold text-sky-950 tracking-tight">{REGISTER_CLOSED}</h1>
          <p className="text-sm text-stone-500 leading-relaxed">
            Ask your administrator for an invitation.
          </p>
          <a
            href="/login"
            className="text-sm font-semibold text-sky-600 hover:text-sky-700 underline"
          >
            Go to sign in →
          </a>
        </div>
      )}
    </RegisterLayout>
  );
}

function RegisterLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-200/40 blur-[120px] mix-blend-multiply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-amber-100/50 blur-[120px] mix-blend-multiply"
      />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>
        <div className="rounded-[2rem] border border-stone-200 bg-white shadow-xl">
          <div className="px-8 pt-8 pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
