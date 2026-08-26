import { NextResponse } from "next/server";

// Liveness check for the Docker HEALTHCHECK / load balancer / orchestrator.
// Deliberately doesn't touch the database or Supabase — a transient blip in
// either shouldn't make the container health check fail and get killed.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
