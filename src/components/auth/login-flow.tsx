"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ChevronRight, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orgLookup } from "@/lib/idp-client";
import { IDP_PATHS } from "@/lib/idp-paths";
import type { OrgConfig, PublicIDPInfo, UserRole } from "@/lib/types";
import { MFAEnrollForm } from "./mfa-enroll-form";
import { MFAForm } from "./mfa-form";
import { PasswordForm } from "./password-form";

type Step = "EMAIL" | "SSO_SELECT" | "PASSWORD" | "MFA" | "MFA_ENROLL";

const emailSchema = z.object({
  email: z.string().min(3, "Enter your email or domain"),
});

type EmailData = z.infer<typeof emailSchema>;

interface LoginFlowProps {
  onSuccess: (role: UserRole) => void;
}

// ── Base64URL helpers (WebAuthn requires ArrayBuffer; server sends base64url) ──

function base64urlToArrayBuffer(b64url: string): ArrayBuffer {
  const base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function LoginFlow({ onSuccess }: LoginFlowProps) {
  const [step, setStep] = useState<Step>("EMAIL");
  const [email, setEmail] = useState("");
  const [orgConfig, setOrgConfig] = useState<OrgConfig | null>(null);
  const [mfaSessionId, setMfaSessionId] = useState("");
  const [enrollSessionId, setEnrollSessionId] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Hydration-safe WebAuthn capability probe. A bare `typeof window` check
  // renders the passkey button on the client's FIRST render but not on the
  // server, which is a hydration mismatch (and in dev the resulting issue
  // overlay can cover other controls). useEffect runs only after mount, so the
  // server HTML and the initial client render agree (no button), and the
  // button appears post-hydration on capable browsers.
  const [isWebAuthnSupported, setIsWebAuthnSupported] = useState(false);
  useEffect(() => {
    setIsWebAuthnSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<EmailData>({
    resolver: zodResolver(emailSchema),
  });

  const onEmailSubmit = async (data: EmailData) => {
    setServerError(null);
    setPasskeyError(null);
    setEmail(data.email);

    const domain = data.email.includes("@") ? data.email.split("@")[1] : data.email;

    try {
      const found = await orgLookup(domain);
      setOrgConfig(found);

      if (!found) {
        setStep("PASSWORD");
        return;
      }

      if (found.auth_policy === "idp_only") {
        if (found.identity_providers && found.identity_providers.length === 1) {
          handleSSORedirect(found.identity_providers[0].login_url);
          return;
        }
        if (found.identity_providers && found.identity_providers.length > 1) {
          const emailDomain = data.email.includes("@")
            ? data.email.split("@")[1].toLowerCase()
            : "";
          if (emailDomain) {
            const matched = found.identity_providers.find((idp) =>
              idp.email_domains?.includes(emailDomain)
            );
            if (matched) {
              handleSSORedirect(matched.login_url);
              return;
            }
          }
          setStep("SSO_SELECT");
          return;
        }
      }

      if (found.auth_policy === "mixed" && found.identity_providers?.length) {
        const emailDomain = data.email.includes("@") ? data.email.split("@")[1].toLowerCase() : "";
        if (emailDomain) {
          const matched = found.identity_providers.find((idp) =>
            idp.email_domains?.includes(emailDomain)
          );
          if (matched) {
            handleSSORedirect(matched.login_url);
            return;
          }
        }
        setStep("SSO_SELECT");
        return;
      }

      setStep("PASSWORD");
    } catch {
      // THE-STALE-COOKIE defence in depth: the org lookup is a ROUTING
      // OPTIMIZATION (pick the friendlier SSO redirect early), not an
      // authorization gate — a 404 already falls through to the password
      // step, so a transport failure must too, instead of dead-ending
      // sign-in ("Unable to look up your organization"). This does NOT
      // make an SSO-mandated org bypassable: auth_policy is enforced by
      // the BACKEND at the login endpoint itself — a policy-bound user
      // who reaches the password step gets 401
      // auth_policy_blocks_local_login from the server (see
      // idp-client.ts's login()), exactly as if the lookup had never
      // existed. Failing the lookup only costs the early SSO
      // convenience routing, never the enforcement.
      setOrgConfig(null);
      setStep("PASSWORD");
    }
  };

  const handleSSORedirect = (loginUrl: string) => {
    try {
      const callbackUrl = `${window.location.origin}/auth/callback`;
      const full = new URL(loginUrl, window.location.origin);
      full.searchParams.set("redirect_uri", callbackUrl);
      const returnTo = new URLSearchParams(window.location.search).get("return_to");
      if (returnTo) full.searchParams.set("return_to", returnTo);
      window.location.href = full.toString();
    } catch {
      setServerError("SSO configuration error. Contact your administrator.");
    }
  };

  const handleMfaRequired = (sessionId: string) => {
    setMfaSessionId(sessionId);
    setStep("MFA");
  };

  const handleMfaEnrollmentRequired = (sessionId: string) => {
    setEnrollSessionId(sessionId);
    setStep("MFA_ENROLL");
  };

  // Passkey login ceremony — runs entirely in the EMAIL step without a step change.
  // SECURITY: No challenge, session_id, assertion blob, or credential data is stored
  // in component state beyond the duration of this function call.
  const handlePasskeyLogin = async () => {
    // Validate email field before starting the ceremony.
    const valid = await trigger("email");
    if (!valid) return;

    const currentEmail = getValues("email");
    if (!currentEmail) return;

    setPasskeyError(null);
    setPasskeyLoading(true);

    try {
      // 1. Begin — server returns assertion options; uses anti-enumeration (dummy
      //    assertion for unknown emails) so this never leaks account existence.
      const beginRes = await fetch(IDP_PATHS.webauthnLoginBegin, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentEmail }),
        cache: "no-store",
      });

      if (!beginRes.ok) {
        throw new Error("Could not start passkey sign-in. Please try again.");
      }

      // biome-ignore lint/suspicious/noExplicitAny: raw WebAuthn options from server
      const beginData: any = await beginRes.json();
      const opts = beginData.publicKey;
      const sessionId: string = beginData.session_id;

      // 2. Decode base64url fields to ArrayBuffer for the browser API.
      const requestOptions: PublicKeyCredentialRequestOptions = {
        ...opts,
        challenge: base64urlToArrayBuffer(opts.challenge),
        allowCredentials: (opts.allowCredentials ?? []).map(
          // biome-ignore lint/suspicious/noExplicitAny: credential descriptor from server
          (c: any) => ({ ...c, id: base64urlToArrayBuffer(c.id) })
        ),
      };

      // 3. Invoke the browser passkey prompt.
      // Throws NotAllowedError when user cancels, or AbortError on timeout.
      const assertion = (await navigator.credentials.get({
        publicKey: requestOptions,
      })) as PublicKeyCredential | null;

      if (!assertion) throw new Error("Passkey sign-in was cancelled.");

      const assertResp = assertion.response as AuthenticatorAssertionResponse;

      // 4. Encode the assertion back to base64url for transport.
      // These blobs are forwarded to the server immediately and not stored.
      const payload = {
        id: assertion.id,
        rawId: arrayBufferToBase64url(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: arrayBufferToBase64url(assertResp.clientDataJSON),
          authenticatorData: arrayBufferToBase64url(assertResp.authenticatorData),
          signature: arrayBufferToBase64url(assertResp.signature),
          userHandle: assertResp.userHandle ? arrayBufferToBase64url(assertResp.userHandle) : null,
        },
      };

      // 5. Finish — server verifies, creates session, sets cookies.
      const finishRes = await fetch(
        `${IDP_PATHS.webauthnLoginFinish}?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        }
      );

      // biome-ignore lint/suspicious/noExplicitAny: raw login response before typing
      const finishData: any = await finishRes.json().catch(() => ({}));

      // Handle MFA required (same shape as password login).
      if (finishData.mfa_required === true) {
        const sid = finishData.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          setEmail(currentEmail);
          handleMfaRequired(sid);
          return;
        }
      }

      // Released OSS returns the session envelope (user_id/session_id/role)
      // with NO `success` flag; legacy shapes carried success:true. A 200
      // with a session_id IS success on either shape.
      const finished =
        finishData.success === true ||
        (typeof finishData.session_id === "string" && finishData.session_id.length > 0);
      if (!finishRes.ok || !finished) {
        throw new Error("Passkey sign-in failed. Try again or use your password.");
      }

      onSuccess((finishData.role as UserRole) ?? "org_user");
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPasskeyError("Passkey sign-in was cancelled or timed out.");
      } else if (err instanceof DOMException && err.name === "AbortError") {
        setPasskeyError("Passkey sign-in timed out. Try again.");
      } else if (err instanceof Error) {
        setPasskeyError(err.message);
      } else {
        setPasskeyError("Passkey sign-in failed. Try again or use your password.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  if (step === "EMAIL") {
    return (
      <form onSubmit={handleSubmit(onEmailSubmit)} className="space-y-5">
        <Input
          id="email"
          label="Email or domain"
          type="text"
          placeholder="you@company.com"
          autoComplete="username"
          autoFocus
          error={errors.email?.message}
          {...register("email")}
        />
        {/* THE-SIX-SMALL-ONES, UI 2 (2026-09-16): the form's errors are
            announced (role="alert") — a screen reader is told a login failed,
            and the e2e helpers match the role scoped to this form instead of
            a styling class. The page-wide brute-force banner keeps its own
            alert outside every form. */}
        {serverError && (
          <p role="alert" className="text-sm text-red-600 text-center">
            {serverError}
          </p>
        )}
        {passkeyError && (
          <p role="alert" className="text-sm text-red-600 text-center">
            {passkeyError}
          </p>
        )}
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Continue
          <ChevronRight className="h-4 w-4" />
        </Button>
        {isWebAuthnSupported && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            size="lg"
            loading={passkeyLoading}
            disabled={passkeyLoading || isSubmitting}
            onClick={handlePasskeyLogin}
          >
            {passkeyLoading ? "Follow your device prompt…" : "Sign in with passkey"}
          </Button>
        )}
      </form>
    );
  }

  if (step === "SSO_SELECT") {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setStep("EMAIL")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        {orgConfig && (
          <div className="text-center">
            <p className="text-sm font-medium text-slate-700">{orgConfig.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">Choose how to sign in</p>
          </div>
        )}

        <div className="space-y-2">
          {orgConfig?.identity_providers?.map((idp: PublicIDPInfo) => (
            <Button
              key={idp.id}
              variant="secondary"
              className="w-full"
              size="lg"
              onClick={() => handleSSORedirect(idp.login_url)}
            >
              Sign in with {idp.name}
            </Button>
          ))}
        </div>

        {orgConfig?.auth_policy === "mixed" && (
          <>
            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-slate-400">or</span>
              </div>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setStep("PASSWORD")}>
              Sign in with password
            </Button>
          </>
        )}
      </div>
    );
  }

  if (step === "PASSWORD") {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setStep("EMAIL")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            {email}
          </span>
        </button>
        <PasswordForm
          email={email}
          orgSlug={orgConfig?.slug}
          onMfaRequired={handleMfaRequired}
          onMfaEnrollmentRequired={handleMfaEnrollmentRequired}
          onSuccess={onSuccess}
        />
      </div>
    );
  }

  if (step === "MFA") {
    return (
      <MFAForm sessionId={mfaSessionId} onBack={() => setStep("PASSWORD")} onSuccess={onSuccess} />
    );
  }

  if (step === "MFA_ENROLL") {
    return (
      <MFAEnrollForm
        sessionId={enrollSessionId}
        onBack={() => setStep("EMAIL")}
        onSuccess={onSuccess}
      />
    );
  }

  return null;
}
