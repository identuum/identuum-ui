import { loadRuntimeConfig, toPublicConfig } from "@/lib/runtime-config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = loadRuntimeConfig();
  if (!cfg) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }
  return NextResponse.json(toPublicConfig(cfg), { status: 200 });
}
