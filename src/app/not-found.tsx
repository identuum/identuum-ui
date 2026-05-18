import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <p className="text-4xl font-bold text-slate-300">404</p>
        <h1 className="mt-3 text-lg font-medium text-slate-700">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The page you are looking for does not exist.</p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
