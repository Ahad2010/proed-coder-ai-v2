import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SaveBody = z.object({
  id: z.string().optional(), // if provided, PATCH; else CREATE
  scenario: z.string().min(1).max(4000),
  draft: z.string().min(1).max(20000),
  citations: z.array(z.unknown()).optional(),
  status: z.enum(["DRAFT", "APPROVED", "SENT", "ARCHIVED"]).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = SaveBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = parsed.data;

  try {
    if (input.id) {
      const updated = await db.queryForm.update({
        where: { id: input.id },
        data: {
          scenario: input.scenario,
          draft: input.draft,
          citations: (input.citations ?? []) as Prisma.InputJsonValue,
          status: input.status ?? "DRAFT",
        },
      });
      return NextResponse.json({ id: updated.id, updated: true });
    }
    const created = await db.queryForm.create({
      data: {
        scenario: input.scenario,
        draft: input.draft,
        citations: (input.citations ?? []) as Prisma.InputJsonValue,
        status: input.status ?? "DRAFT",
      },
    });
    return NextResponse.json({ id: created.id, created: true });
  } catch (e) {
    console.error("Save failed:", e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
