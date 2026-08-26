import { NextResponse } from "next/server";
import { loadRuntimeConfig } from "@/lib/runtime-config";

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
