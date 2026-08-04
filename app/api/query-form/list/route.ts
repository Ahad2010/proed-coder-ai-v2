import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "50", 10),
      200
    );

    const items = await db.queryForm.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        scenario: true,
        draft: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Query form list error:", error);

    return NextResponse.json(
      {
        items: [],
        error: "Database unavailable",
      },
      { status: 500 }
    );
  }
}