import { loadRuntimeConfig } from "@/lib/runtime-config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = loadRuntimeConfig();
  return NextResponse.json(
    {
      status: "ok",
      configured: cfg !== null,
    },
    { status: 200 }
  );
}
