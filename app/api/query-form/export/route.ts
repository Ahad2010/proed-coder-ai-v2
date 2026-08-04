import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  draft: z.string().min(1).max(20000),
  format: z.enum(["docx"]).default("docx"),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body" },
      { status: 400 }
    );
  }

  const { draft } = parsed.data;

  // Dynamically import docx
  const mod: any = await import("docx").catch(() => null);

  if (!mod) {
    return NextResponse.json(
      { error: "docx package not installed. Run: npm install docx" },
      { status: 500 }
    );
  }

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    AlignmentType,
  } = mod;

  const now = new Date();

  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rawLines = draft.split(/\r?\n/);

  const bodyParagraphs = rawLines.map(
    (line: string) =>
      new Paragraph({
        children: [
          new TextRun({
            text: line,
            font: "Calibri",
            size: 22,
          }),
        ],
        spacing: {
          after: 100,
        },
      })
  );

  const doc = new Document({
    creator: "ProEd Coder AI",
    title: "Physician Query",
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "ProEd Consulting & Staffing",
                bold: true,
                font: "Calibri",
                size: 32,
                color: "1E40AF",
              }),
            ],
            alignment: AlignmentType.LEFT,
            spacing: {
              after: 60,
            },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: "Physician Query — Documentation Clarification Request",
                font: "Calibri",
                size: 22,
                color: "374151",
              }),
            ],
            spacing: {
              after: 40,
            },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: `Generated: ${dateStr}`,
                font: "Calibri",
                size: 18,
                color: "6B7280",
              }),
            ],
            spacing: {
              after: 240,
            },
          }),

          ...bodyParagraphs,

          new Paragraph({
            children: [
              new TextRun({
                text: "",
                font: "Calibri",
                size: 18,
              }),
            ],
            spacing: {
              before: 240,
            },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: "This query was drafted using ProEd Coder AI, following AHIMA/ACDIS 2019 compliant query guidelines. Retain this document as part of the audit trail per your organization's retention policy.",
                font: "Calibri",
                size: 16,
                italics: true,
                color: "6B7280",
              }),
            ],
            spacing: {
              before: 120,
            },
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="physician-query-${Date.now()}.docx"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}