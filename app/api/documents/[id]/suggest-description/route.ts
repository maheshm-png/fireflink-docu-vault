import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

// POST /api/documents/:id/suggest-description — generates a short
// description from the document's already-extracted text (see
// lib/extract.ts), using the same self-hosted Ollama model as
// scripts/run-staleness-check.ts. Suggests only — the manager/uploader
// still has to accept it (it just pre-fills the textarea in
// EditDocumentForm.tsx, which they can edit or discard).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "editOwnUpload")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { currentVersion: true },
  });

  // Same ownership rule as PATCH /api/documents/:id (this suggestion feeds
  // straight into that edit form) — without it, any contributor could pull
  // an AI summary of a document's extracted text they can't otherwise view.
  const canEdit =
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    user.role === "manager" ||
    user.role === "superadmin";
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const text = document.currentVersion?.extractedText;
  if (!text || !text.trim()) {
    return NextResponse.json(
      { error: "No extracted content available to summarize for this document yet." },
      { status: 400 }
    );
  }

  const prompt = `Write a concise, one-paragraph description (2-3 sentences, plain text, no markdown) of this sales/demo document for an internal document hub, based on its content. Be factual and specific about what it covers — not generic filler.

Title: ${document.title}
Content excerpt: ${text.slice(0, 3000)}

Description:`;

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    const data = await res.json();
    const suggestion: string = (data.response ?? "").trim();
    if (!suggestion) throw new Error("Empty response from model");
    return NextResponse.json({ suggestion });
  } catch (err) {
    console.error("Description suggestion failed:", err);
    return NextResponse.json(
      { error: "Could not generate a suggestion right now — the AI service may be unavailable." },
      { status: 503 }
    );
  }
}
