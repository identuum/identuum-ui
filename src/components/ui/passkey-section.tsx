"use client";

/**
 * PasskeySection — self-service WebAuthn/passkey credential management.
 *
 * Reusable across all authenticated user roles (site_admin, org_admin, org_user).
 * The backend enforces that all operations are scoped to the calling user's session;
 * no user ID is submitted from the browser.
 *
 * SECURITY:
 *   - challenge/session_id are WebAuthn ceremony identifiers, not user auth tokens.
 *   - No credential private key material ever reaches this component — only public
 *     summary data (credential id, nickname, created_at, last_used_at, aaguid) is stored.
 *   - Challenge session_id is passed as a query param because the finish endpoint
 *     body carries the attestation blob; it is a short-lived opaque identifier.
 *   - attestationObject and clientDataJSON blobs are sent to the server and then
 *     discarded from component state — they are NOT logged or stored in the browser.
 *   - Nickname is a display-only label; the server sanitizes it before storage.
 */

import { IDP_PATHS } from "@/lib/idp-paths";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CredentialSummary {
  id: string;
  nickname: string;
  created_at: string;
  last_used_at: string | null;
  aaguid: string;
  clone_warning: boolean;
}

type Phase = "idle" | "loading" | "registering" | "success" | "error";

// ── Base64URL utilities ────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function PasskeySection() {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // "Add passkey" form state — only shown while isAdding=true.
  const [isAdding, setIsAdding] = useState(false);
  const [nickname, setNickname] = useState("");

  const isSupported =
    typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

  async function refresh() {
    try {
      const res = await fetch(IDP_PATHS.webauthnCredentials, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
        const data: any = await res.json();
        setCredentials(Array.isArray(data) ? data : []);
      }
    } catch {
      // Non-fatal — show empty list.
    } finally {
      setPhase("idle");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is intentionally stable
  useEffect(() => {
    refresh();
  }, []);

  async function handleAddPasskey() {
    if (!isSupported) return;

    setPhase("registering");
    setError(null);

    try {
      const beginRes = await fetch(IDP_PATHS.webauthnRegisterBegin, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      if (!beginRes.ok) {
        if (beginRes.status === 403) {
          throw new Error("Passkey registration is not available for your account.");
        }
        throw new Error("Could not start passkey registration. Please try again.");
      }

      // biome-ignore lint/suspicious/noExplicitAny: raw WebAuthn options from server
      const beginData: any = await beginRes.json();
      const opts = beginData.publicKey;
      const sessionId: string = beginData.session_id;

      const creationOptions: PublicKeyCredentialCreationOptions = {
        ...opts,
        challenge: base64urlToArrayBuffer(opts.challenge),
        user: {
          ...opts.user,
          id: base64urlToArrayBuffer(opts.user.id),
        },
        excludeCredentials: (opts.excludeCredentials ?? []).map(
          // biome-ignore lint/suspicious/noExplicitAny: credential descriptor from server
          (c: any) => ({ ...c, id: base64urlToArrayBuffer(c.id) })
        ),
      };

      const credential = (await navigator.credentials.create({
        publicKey: creationOptions,
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error("Passkey creation was cancelled or failed.");

      const attResp = credential.response as AuthenticatorAttestationResponse;

      const payload = {
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: arrayBufferToBase64url(attResp.clientDataJSON),
          attestationObject: arrayBufferToBase64url(attResp.attestationObject),
          transports: attResp.getTransports?.() ?? [],
        },
      };

      // Nickname is appended as a query param so the body stays as the raw
      // WebAuthn attestation blob expected by the go-webauthn library.
      const nicknameParam = nickname.trim()
        ? `&nickname=${encodeURIComponent(nickname.trim())}`
        : "";

      const finishRes = await fetch(
        `${IDP_PATHS.webauthnRegisterFinish}?session_id=${encodeURIComponent(sessionId)}${nicknameParam}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        }
      );

      if (!finishRes.ok) {
        // biome-ignore lint/suspicious/noExplicitAny: raw error response
        const errData: any = await finishRes.json().catch(() => ({}));
        throw new Error(
          typeof errData.message === "string" && errData.message.length > 0
            ? errData.message
            : "Passkey verification failed. Please try again."
        );
      }

      setNickname("");
      setIsAdding(false);
      setPhase("success");
      await refresh();
      setTimeout(() => setPhase("idle"), 3000);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Passkey creation was cancelled or timed out.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
      setPhase("error");
      setIsAdding(false);
    }
  }

  async function handleDeletePasskey(credId: string) {
    setDeletingId(credId);
    try {
      const res = await fetch(`${IDP_PATHS.webauthnCredentials}/${encodeURIComponent(credId)}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok || res.status === 204) {
        setCredentials((prev) => prev.filter((c) => c.id !== credId));
      }
    } catch {
      // Non-fatal.
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRenamePasskey(credId: string, newNickname: string): Promise<boolean> {
    try {
      const res = await fetch(`${IDP_PATHS.webauthnCredentials}/${encodeURIComponent(credId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: newNickname }),
        cache: "no-store",
      });
      if (res.ok) {
        setCredentials((prev) =>
          prev.map((c) =>
            c.id === credId ? { ...c, nickname: newNickname || "Device passkey" } : c
          )
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const isRegistering = phase === "registering";

  return (
    <div className="space-y-4">
      {/* Header row — description + Add passkey trigger */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-stone-400 leading-relaxed">
          Sign in with your device fingerprint, face, or a security key — no password required.
        </p>
        {isSupported && !isAdding && (
          <Button
            size="sm"
            disabled={phase === "loading"}
            onClick={() => {
              setIsAdding(true);
              setError(null);
            }}
            className="shrink-0"
          >
            Add passkey
          </Button>
        )}
      </div>

      {/* Add-passkey inline form — only visible when isAdding */}
      {isSupported && isAdding && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 80))}
            placeholder='Nickname (optional, e.g. "MacBook Touch ID")'
            maxLength={80}
            disabled={isRegistering}
            // biome-ignore lint/a11y/noAutofocus: intentional — user just clicked Add passkey
            autoFocus
            className="flex-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-sky-950 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors disabled:opacity-50"
          />
          <Button size="sm" loading={isRegistering} onClick={handleAddPasskey} className="shrink-0">
            {isRegistering ? "Follow device prompt…" : "Add"}
          </Button>
          {!isRegistering && (
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNickname("");
              }}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Success banner */}
      {phase === "success" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-700">Passkey added successfully.</p>
          <p className="text-xs text-stone-500 mt-0.5">
            You can now use this passkey to sign in on supported browsers.
          </p>
        </div>
      )}

      {/* Error banner */}
      {phase === "error" && error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Credential list */}
      {phase === "loading" ? (
        <p className="text-xs text-stone-400">Loading…</p>
      ) : credentials.length === 0 ? (
        <p className="text-xs text-stone-400">No passkeys enrolled yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {credentials.map((cred) => (
            <CredentialRow
              key={cred.id}
              cred={cred}
              isDeleting={deletingId === cred.id}
              onDelete={() => handleDeletePasskey(cred.id)}
              onRename={(newName) => handleRenamePasskey(cred.id, newName)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CredentialRow({
  cred,
  isDeleting,
  onDelete,
  onRename,
}: {
  cred: CredentialSummary;
  isDeleting: boolean;
  onDelete: () => void;
  onRename: (name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cred.nickname || "Device passkey");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const createdDate = new Date(cred.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const lastUsed = cred.last_used_at
    ? new Date(cred.last_used_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const shortId = cred.id.replace(/-/g, "").slice(0, 8);
  const shortAaguid =
    cred.aaguid && cred.aaguid !== "00000000-0000-0000-0000-000000000000"
      ? cred.aaguid.replace(/-/g, "").slice(0, 8)
      : null;

  function startEdit() {
    setDraft(cred.nickname || "Device passkey");
    setRenameError(false);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditing(false);
    setRenameError(false);
  }

  async function commitRename() {
    if (renaming) return;
    const trimmed = draft.trim() || "Device passkey";
    setRenaming(true);
    setRenameError(false);
    const ok = await onRename(trimmed);
    setRenaming(false);
    if (ok) {
      setEditing(false);
    } else {
      setRenameError(true);
    }
  }

  return (
    <li className="py-3 space-y-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.slice(0, 80));
                setRenameError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelEdit();
              }}
              maxLength={80}
              disabled={renaming}
              className="w-full rounded border border-sky-300 bg-stone-50 px-2 py-0.5 text-sm text-sky-950 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:opacity-50"
            />
          ) : (
            <p className="text-sm text-sky-950 font-medium truncate">
              {cred.nickname || "Device passkey"}
            </p>
          )}
          <p className="text-xs text-stone-400 mt-0.5">
            Added {createdDate}
            {lastUsed && ` · Last used ${lastUsed}`}
          </p>
          <p className="text-[11px] font-mono text-stone-300 mt-0.5">
            {shortId}
            {shortAaguid && <span className="ml-2">· {shortAaguid}</span>}
          </p>
          {cred.clone_warning && (
            <p className="text-xs font-medium text-amber-600 mt-0.5">
              Clone warning — possible key duplication detected.
            </p>
          )}
          {renameError && (
            <p className="text-xs text-red-500 mt-0.5">Rename failed. Please try again.</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 shrink-0 mt-0.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={commitRename}
                disabled={renaming}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium transition-colors disabled:opacity-50"
              >
                {renaming ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={renaming}
                className="text-xs text-stone-400 hover:text-stone-600 font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEdit}
                disabled={isDeleting}
                className="text-xs text-stone-400 hover:text-sky-600 font-medium transition-colors disabled:opacity-50"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                className="text-xs text-stone-400 hover:text-red-600 font-medium transition-colors disabled:opacity-50"
                aria-label="Remove passkey"
              >
                {isDeleting ? "Removing…" : "Remove"}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
