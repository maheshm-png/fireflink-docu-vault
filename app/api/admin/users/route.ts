import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { isAllowedEmailDomain, getAllowedEmailDomains } from "@/lib/emailPolicy";
import { prisma } from "@/lib/prisma";

// Service-role client — only ever used server-side, never shipped to the browser.
// Required to create auth users programmatically (invite flow).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageUsers");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(users);
}

// POST /api/admin/users — superadmin invites a new user by email + role.
// Sends a Supabase magic-link invite; user sets their own password.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageUsers");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { email, name, role } = await req.json();
  if (!email || !name || !role) {
    return NextResponse.json({ error: "email, name, and role are required" }, { status: 400 });
  }

  if (!isAllowedEmailDomain(email)) {
    return NextResponse.json(
      {
        error: `Only ${getAllowedEmailDomains().map((d) => "@" + d).join(" or ")} email addresses can be added.`,
      },
      { status: 400 }
    );
  }

  // Prevent duplicate invites for an email already in the system.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
  }

  const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const newUser = await prisma.user.create({
    data: {
      id: invited.user.id,
      email,
      name,
      role,
      passwordHash: "", // Supabase Auth owns the credential; not stored here
    },
  });

  await logAudit({ userId: user.id, action: "role_change", documentId: undefined });

  return NextResponse.json({ user: newUser }, { status: 201 });
}
