import { NextResponse } from "next/server";
import { clearSessionResponse } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ success: true });
  return clearSessionResponse(response);
}
