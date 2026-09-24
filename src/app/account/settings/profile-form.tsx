"use client";

/**
 * Profile form for the personal account settings page (THE-PROFILE-CLAIMS).
 * Available to site_admin, org_admin, and org_user — each edits their OWN
 * display name and OIDC Core §5.1 profile fields. Every field is optional;
 * an emptied field is cleared on the IdP and then never released to any
 * OAuth client (no placeholders). Formats are validated server-side; the
 * IdP's field-level message is shown verbatim.
 */

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/lib/types";
import { type ProfileFormState, updateProfileAction } from "./profile-actions";

const initialState: ProfileFormState = { phase: "idle" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

type FieldSpec = {
  key:
    | "name"
    | "given_name"
    | "family_name"
    | "middle_name"
    | "nickname"
    | "preferred_username"
    | "profile"
    | "picture"
    | "website"
    | "gender"
    | "birthdate"
    | "zoneinfo"
    | "locale"
    | "phone_number"
    | "address_formatted"
    | "address_street_address"
    | "address_locality"
    | "address_region"
    | "address_postal_code"
    | "address_country";
  label: string;
  hint?: string;
  type?: "text" | "url" | "date" | "tel";
  placeholder?: string;
};

const FIELDS: FieldSpec[] = [
  { key: "name", label: "Display name" },
  { key: "given_name", label: "Given name" },
  { key: "family_name", label: "Family name" },
  { key: "middle_name", label: "Middle name" },
  { key: "nickname", label: "Nickname" },
  { key: "preferred_username", label: "Preferred username" },
  { key: "profile", label: "Profile page URL", type: "url", placeholder: "https://…" },
  { key: "picture", label: "Picture URL", type: "url", placeholder: "https://…" },
  { key: "website", label: "Website", type: "url", placeholder: "https://…" },
  { key: "gender", label: "Gender" },
  { key: "birthdate", label: "Birthdate", hint: "YYYY-MM-DD, YYYY, or 0000-MM-DD" },
  { key: "zoneinfo", label: "Time zone", hint: "IANA name, e.g. Europe/London" },
  { key: "locale", label: "Locale", hint: "BCP47 tag, e.g. en-GB" },
  // THE-ADDRESS-PHONE-CLAIMS: released under the phone / address scopes.
  { key: "phone_number", label: "Phone number", type: "tel", hint: "E.164, e.g. +442079460000" },
  {
    key: "address_formatted",
    label: "Address (formatted)",
    hint: "The full address as you would print it",
  },
  { key: "address_street_address", label: "Street address" },
  { key: "address_locality", label: "City or locality" },
  { key: "address_region", label: "State, province or region" },
  { key: "address_postal_code", label: "Postal code" },
  { key: "address_country", label: "Country" },
];

export function ProfileForm({ profile }: { profile: UserProfile | null }) {
  const [state, action, isPending] = useActionState(updateProfileAction, initialState);

  return (
    <form action={action} data-testid="profile-form" className="space-y-5 max-w-md">
      {state.phase === "error" && (
        <div
          data-testid="profile-outcome"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {state.error}
        </div>
      )}
      {state.phase === "success" && (
        <div
          data-testid="profile-outcome"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"
        >
          Profile saved. Applications you have consented to receive only the fields you set.
        </div>
      )}

      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <label
            htmlFor={`profile_${f.key}`}
            className="block text-sm font-semibold text-stone-700"
          >
            {f.label}
          </label>
          <input
            id={`profile_${f.key}`}
            name={f.key}
            data-testid={`profile-${f.key}`}
            type={f.type ?? "text"}
            defaultValue={profile?.[f.key] ?? ""}
            placeholder={f.placeholder}
            autoComplete="off"
            className={inputClass}
          />
          {f.hint && <p className="text-xs text-stone-400">{f.hint}</p>}
        </div>
      ))}

      <p className="text-xs text-stone-500 leading-relaxed">
        Every field is optional. Leave a field empty to remove it — an unset field is never shared
        with any application.
      </p>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
