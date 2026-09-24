import "dotenv/config";
/**
 * One-off backfill: makes existing users choose their own password on their
 * next sign-in, by setting the same must_change_password flag (Supabase
 * app_metadata) that app/api/admin/users sets for admin-chosen passwords,
 * which middleware.ts then enforces. Nothing in the database records whether
 * an existing password was chosen by the user or handed over by an admin, so
 * this flags every active user instead; anyone who already set their own just
 * repeats the quick change once.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   npm run password:force -- --except=you@fireflink.com
 *   npm run password:force -- --except=you@fireflink.com --apply
 *
 * --except=a@x.com,b@y.com  skip these emails (always include your own, or
 *                           you'll be asked to change your password too).
 * Sessions already signed in keep working until their next token refresh or
 * sign-in, at which point they are held on /accept-invite.
 *
 * Runs against whichever Supabase project the .env in this directory points
 * at, so run it separately on each environment.
 */

import { createClient } from "@supabase/supabase-js";
import { prisma } from "../lib/prisma";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const apply = process.argv.includes("--apply");
  const exceptArg = process.argv.find((a) => a.startsWith("--except="));
  const except = new Set(
    (exceptArg?.slice("--except=".length) ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  if (except.size === 0) {
    console.error("Pass --except=<your email> so you aren't forced to change your own password too.");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });
  const unknown = [...except].filter((e) => !users.some((u) => u.email.toLowerCase() === e));
  if (unknown.length > 0) {
    console.error(`Not an active user here: ${unknown.join(", ")}. Check the spelling before continuing.`);
    process.exit(1);
  }

  const targets = users.filter((u) => !except.has(u.email.toLowerCase()));
  console.log(`${users.length} active users, ${except.size} skipped, ${targets.length} to flag${apply ? "" : " (dry run)"}:`);

  let failed = 0;
  for (const u of targets) {
    if (!apply) {
      console.log(`  would flag  ${u.email}`);
      continue;
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(u.id, {
      app_metadata: { must_change_password: true },
    });
    if (error) {
      failed++;
      console.log(`  FAILED      ${u.email}: ${error.message}`);
    } else {
      console.log(`  flagged     ${u.email}`);
    }
  }

  if (!apply) console.log("\nNothing changed. Re-run with --apply to flag these users.");
  else console.log(`\nDone. ${targets.length - failed} flagged, ${failed} failed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
