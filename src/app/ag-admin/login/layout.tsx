/**
 * AG operator login layout — unauthenticated, no sidebar.
 *
 * Provides the full-screen background. Page-level layout (centering, columns)
 * is handled by the page component so it can implement responsive split-panel
 * behaviour independently of this wrapper.
 *
 * This layout sits inside /ag-admin/layout.tsx (config guard) but outside the
 * (authed) route group, so no AG Governance sidebar is rendered.
 */
export default function AgAdminLoginLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-stone-50">{children}</div>;
}
