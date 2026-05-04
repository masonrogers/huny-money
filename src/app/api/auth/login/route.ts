import { NextRequest, NextResponse } from "next/server";
import { createSessionResponse } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      // Same response shape on success and failure to avoid timing leak.
      await new Promise((r) => setTimeout(r, 200));
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    await createSessionResponse(response);
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
