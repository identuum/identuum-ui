"use client";

/**
 * Assigned-roles card on /org-admin/users/[id].
 *
 * Read: GET /api/v1/users/:id/roles surfaces the user's currently assigned
 *   organization roles. Each row shows name, description, scope-count, and
 *   a Remove button.
 *
 * Write: POST /api/v1/users/:id/roles (assign) and
 *   DELETE /api/v1/users/:id/roles/:role_id (remove). Both routes are
 *   idempotent at the repository layer (assign ON CONFLICT DO NOTHING,
 *   remove no-op on missing binding) — the UI does not have to dedupe.
 *
 * Authority boundary: role create/edit/delete is NOT exposed here. Operators
 * manage the role catalog from /org-admin/settings.
 */

import type { OrgRoleItem } from "@/lib/idp-admin-client";
import { useActionState } from "react";
import {
  type AssignUserRoleState,
  type RemoveUserRoleState,
  assignUserRoleAction,
  removeUserRoleAction,
} from "../actions";
import { USER_ROLES_CARD_COPY } from "./user-detail-actions";

interface UserRolesCardProps {
  userId: string;
  /** Roles currently assigned to the user. May be empty. */
  assignedRoles: OrgRoleItem[];
  /** All roles in the org. Used as the dropdown source. */
  availableRoles: OrgRoleItem[];
  /** True when the assigned-roles fetch failed. */
  assignedLoadError: boolean;
  /** True when the available-roles fetch failed (e.g. no org id). */
  availableLoadError: boolean;
}

const initialAssignState: AssignUserRoleState = { phase: "idle" };
const initialRemoveState: RemoveUserRoleState = { phase: "idle" };

const selectClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 " +
  "font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 " +
  "focus:border-sky-500 transition-colors";

export function UserRolesCard({
  userId,
  assignedRoles,
  availableRoles,
  assignedLoadError,
  availableLoadError,
}: UserRolesCardProps) {
  const assignedIds = new Set(assignedRoles.map((r) => r.id));
  const unassignedRoles = availableRoles.filter((r) => !assignedIds.has(r.id));

  const [assignState, assignAction, assignPending] = useActionState(
    assignUserRoleAction,
    initialAssignState
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeUserRoleAction,
    initialRemoveState
  );

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">{USER_ROLES_CARD_COPY.title}</p>
        <p className="text-xs text-stone-400 mt-0.5">{USER_ROLES_CARD_COPY.subtitle}</p>
      </div>

      {assignedLoadError ? (
        <div className="px-6 py-5">
          <p className="text-xs text-red-600">{USER_ROLES_CARD_COPY.assignedRolesLoadError}</p>
        </div>
      ) : assignedRoles.length === 0 ? (
        <div className="px-6 py-5">
          <p className="text-xs text-stone-400 italic">{USER_ROLES_CARD_COPY.emptyState}</p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {assignedRoles.map((role) => (
            <li key={role.id} className="px-6 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-sky-950">{role.name}</p>
                <p className="text-xs text-stone-500 leading-relaxed">
                  {role.description || USER_ROLES_CARD_COPY.placeholderDescription}
                </p>
                <p className="text-[10px] text-stone-400 mt-0.5">
                  {role.scopes.length} {role.scopes.length === 1 ? "scope" : "scopes"}
                </p>
              </div>
              <form action={removeAction} className="shrink-0 flex flex-col items-end gap-1">
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="roleId" value={role.id} />
                <button
                  type="submit"
                  disabled={removePending}
                  className="text-xs font-medium text-stone-400 hover:text-red-600 transition-colors disabled:opacity-40"
                >
                  {removePending && removeState.roleId === role.id
                    ? "…"
                    : USER_ROLES_CARD_COPY.removeButtonLabel}
                </button>
                {removeState.phase === "error" &&
                  removeState.roleId === role.id &&
                  removeState.error && (
                    <p className="text-[10px] text-red-500 leading-tight max-w-[160px] text-right">
                      {removeState.error}
                    </p>
                  )}
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="px-6 py-4 border-t border-stone-100 bg-stone-50/60 space-y-2">
        <p className="text-xs font-semibold text-stone-600">{USER_ROLES_CARD_COPY.assignHeading}</p>
        {availableLoadError ? (
          <p className="text-xs text-red-600">{USER_ROLES_CARD_COPY.availableRolesLoadError}</p>
        ) : unassignedRoles.length === 0 ? (
          <p className="text-xs text-stone-400 italic">{USER_ROLES_CARD_COPY.noAvailableRoles}</p>
        ) : (
          <form action={assignAction} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={userId} />
            <select
              name="roleId"
              required
              defaultValue=""
              className={selectClass}
              aria-label={USER_ROLES_CARD_COPY.assignHeading}
            >
              <option value="" disabled>
                {USER_ROLES_CARD_COPY.selectPlaceholder}
              </option>
              {unassignedRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={assignPending}
              className="shrink-0 inline-flex items-center justify-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
            >
              {assignPending ? "Assigning…" : USER_ROLES_CARD_COPY.assignButtonLabel}
            </button>
          </form>
        )}
        {assignState.phase === "error" && assignState.error && (
          <p className="text-xs text-red-600">{assignState.error}</p>
        )}
      </div>
    </div>
  );
}
