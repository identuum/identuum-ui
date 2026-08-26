"use client";

import { useRouter } from "next/navigation";
import { LoginFlow } from "@/components/auth/login-flow";
import { roleToPath } from "@/lib/role-routing";
import type { PublicRuntimeConfig, UserRole } from "@/lib/types";

interface LoginPageClientProps {
  config: PublicRuntimeConfig;
}

export function LoginPageClient({ config }: LoginPageClientProps) {
  const router = useRouter();

  const handleSuccess = (role: UserRole) => {
    router.push(roleToPath(role));
  };

  if (config.idp.enabled) {
    return <LoginFlow onSuccess={handleSuccess} />;
  }

  // AG-only: IdP is not configured. Human identity login is not available.
  // The login page is still rendered because UI routing lands here by default,
  // but no IdP API calls are made when idp.enabled === false.
  return (
    <div className="rounded border border-slate-700 bg-slate-800/50 p-4 text-center">
      <p className="text-sm text-slate-300 font-medium">Agent governance mode</p>
      <p className="text-xs text-slate-500 mt-1">
        This deployment is configured for agent governance only. Human identity login is not
        available.
      </p>
      {config.ag.enabled && (
        <a
          href="/ag-admin"
          className="mt-3 inline-block text-xs text-blue-400 hover:text-blue-300 underline"
        >
          Go to AG governance
        </a>
      )}
    </div>
  );
}
