-- Row Level Security (RLS) policies for Supabase Postgres
-- Apply after `prisma migrate deploy`, via Supabase SQL editor.
-- These are a second, DB-level enforcement layer — the app must never
-- rely on the frontend alone to hide unauthorized data.
--
-- Safe to re-run in full at any time: every `create policy` is preceded by
-- a matching `drop policy if exists`, and `enable row level security` is
-- already a no-op when RLS is already on.

alter table "Document" enable row level security;
alter table "DocumentVersion" enable row level security;
alter table "ReviewRequest" enable row level security;
alter table "AuditLog" enable row level security;
alter table "User" enable row level security;

-- Helper: current user's role, pulled from the User table via the JWT's
-- sub claim (Supabase Auth sets auth.uid()). search_path is pinned so an
-- attacker-controlled search_path on the calling session can't shadow the
-- unqualified "User" reference below with a table from another schema.
create or replace function current_role_name() returns text as $$
  select role::text from "User" where id = auth.uid()::text
$$ language sql stable set search_path = public;

-- Documents: everyone sees published docs; only uploader/owner/manager/
-- superadmin see pending/rejected ones.
drop policy if exists "view_published_docs" on "Document";
create policy "view_published_docs" on "Document"
  for select using (
    status = 'published'
    or "uploadedById" = auth.uid()::text
    or "ownerId" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
  );

drop policy if exists "insert_docs_uploaders" on "Document";
create policy "insert_docs_uploaders" on "Document"
  for insert with check (
    current_role_name() in ('contributor','manager','superadmin')
  );

drop policy if exists "update_docs_owner_or_admin" on "Document";
create policy "update_docs_owner_or_admin" on "Document"
  for update using (
    "uploadedById" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
  );

drop policy if exists "delete_docs_admin_only" on "Document";
create policy "delete_docs_admin_only" on "Document"
  for delete using (
    current_role_name() in ('manager','superadmin')
  );

-- Review requests: only manager/superadmin can approve; requester can view own.
drop policy if exists "view_own_or_admin_reviews" on "ReviewRequest";
create policy "view_own_or_admin_reviews" on "ReviewRequest"
  for select using (
    "requestedById" = auth.uid()::text
    or "reviewerId" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
  );

-- Resolving (approving/rejecting) a review is manager-only — deliberately
-- excludes superadmin, matching approveReview in lib/rbac.ts. Renamed from
-- resolve_reviews_admin_only; drop the old name first so re-running this
-- file after that change is clean.
drop policy if exists "resolve_reviews_admin_only" on "ReviewRequest";

drop policy if exists "resolve_reviews_manager_only" on "ReviewRequest";
create policy "resolve_reviews_manager_only" on "ReviewRequest"
  for update using (
    current_role_name() = 'manager'
  );

-- Audit log: append-only, readable by manager/superadmin only.
drop policy if exists "audit_read_admin_only" on "AuditLog";
create policy "audit_read_admin_only" on "AuditLog"
  for select using (
    current_role_name() in ('manager','superadmin')
  );

drop policy if exists "audit_insert_any_authenticated" on "AuditLog";
create policy "audit_insert_any_authenticated" on "AuditLog"
  for insert with check (auth.uid() is not null);

-- Users: only superadmin can manage; users can read their own row.
drop policy if exists "users_read_self_or_admin" on "User";
create policy "users_read_self_or_admin" on "User"
  for select using (
    id = auth.uid()::text or current_role_name() = 'superadmin'
  );

drop policy if exists "users_write_admin_only" on "User";
create policy "users_write_admin_only" on "User"
  for update using (current_role_name() = 'superadmin');

-- Designations: everyone can read (shown alongside a user's name/role);
-- only superadmin manages the option list itself (app/admin/designations).
alter table "Designation" enable row level security;

drop policy if exists "designations_read_all" on "Designation";
create policy "designations_read_all" on "Designation"
  for select using (auth.uid() is not null);

drop policy if exists "designations_write_admin_only" on "Designation";
create policy "designations_write_admin_only" on "Designation"
  for insert with check (current_role_name() = 'superadmin');

drop policy if exists "designations_delete_admin_only" on "Designation";
create policy "designations_delete_admin_only" on "Designation"
  for delete using (current_role_name() = 'superadmin');

-- Categories: everyone can read (needed to pick a category on upload);
-- only manager/superadmin can create or edit one (including its form).
alter table "Category" enable row level security;

drop policy if exists "categories_read_all" on "Category";
create policy "categories_read_all" on "Category"
  for select using (true);

drop policy if exists "categories_write_admin_only" on "Category";
create policy "categories_write_admin_only" on "Category"
  for insert with check (current_role_name() in ('manager','superadmin'));

drop policy if exists "categories_update_admin_only" on "Category";
create policy "categories_update_admin_only" on "Category"
  for update using (current_role_name() in ('manager','superadmin'));

-- Announcements: every authenticated user reads active ones (the dashboard
-- ticker); only manager/superadmin can post, edit, or deactivate one.
alter table "Announcement" enable row level security;

drop policy if exists "announcements_read_all" on "Announcement";
create policy "announcements_read_all" on "Announcement"
  for select using (auth.uid() is not null);

drop policy if exists "announcements_write_admin_only" on "Announcement";
create policy "announcements_write_admin_only" on "Announcement"
  for insert with check (current_role_name() in ('manager','superadmin'));

drop policy if exists "announcements_update_admin_only" on "Announcement";
create policy "announcements_update_admin_only" on "Announcement"
  for update using (current_role_name() in ('manager','superadmin'));

drop policy if exists "announcements_delete_admin_only" on "Announcement";
create policy "announcements_delete_admin_only" on "Announcement"
  for delete using (current_role_name() in ('manager','superadmin'));

-- Teams: everyone can read (shown alongside a user's name/role, grouping on
-- app/admin/users); only superadmin manages the option list itself
-- (app/admin/teams). Same shape as Designation above.
alter table "Team" enable row level security;

drop policy if exists "teams_read_all" on "Team";
create policy "teams_read_all" on "Team"
  for select using (auth.uid() is not null);

drop policy if exists "teams_write_admin_only" on "Team";
create policy "teams_write_admin_only" on "Team"
  for insert with check (current_role_name() = 'superadmin');

drop policy if exists "teams_delete_admin_only" on "Team";
create policy "teams_delete_admin_only" on "Team"
  for delete using (current_role_name() = 'superadmin');

-- Password reset OTPs: never readable or writable through PostgREST for
-- any role, including authenticated. The app's own service-role Postgres
-- connection (DATABASE_URL/DIRECT_URL, which RLS doesn't apply to) is the
-- only thing that ever issues or verifies these codes. Enabling RLS with no
-- matching policy denies all PostgREST access outright, which is the
-- correct default for a table holding email + code hashes.
alter table "PasswordResetOtp" enable row level security;

-- Workspace apps: tiles on the pre-login launcher (app/page.tsx) — readable
-- by anyone, including signed-out visitors, since that page has no auth
-- gate. Only superadmin manages the tile list (app/admin/workspace-apps).
alter table "WorkspaceApp" enable row level security;

drop policy if exists "workspace_apps_read_all" on "WorkspaceApp";
create policy "workspace_apps_read_all" on "WorkspaceApp"
  for select using (true);

drop policy if exists "workspace_apps_write_admin_only" on "WorkspaceApp";
create policy "workspace_apps_write_admin_only" on "WorkspaceApp"
  for insert with check (current_role_name() = 'superadmin');

drop policy if exists "workspace_apps_update_admin_only" on "WorkspaceApp";
create policy "workspace_apps_update_admin_only" on "WorkspaceApp"
  for update using (current_role_name() = 'superadmin');

drop policy if exists "workspace_apps_delete_admin_only" on "WorkspaceApp";
create policy "workspace_apps_delete_admin_only" on "WorkspaceApp"
  for delete using (current_role_name() = 'superadmin');

-- Staleness flags: visible to whoever can already see the underlying
-- document; resolving one (scripts/run-staleness-check.ts aside) is a
-- manager/superadmin lifecycle action.
alter table "StalenessFlag" enable row level security;

drop policy if exists "staleness_read_via_document" on "StalenessFlag";
create policy "staleness_read_via_document" on "StalenessFlag"
  for select using (
    exists (
      select 1 from "Document" d
      where d.id = "StalenessFlag"."documentId"
        and (
          d.status = 'published'
          or d."uploadedById" = auth.uid()::text
          or d."ownerId" = auth.uid()::text
          or current_role_name() in ('manager','superadmin')
        )
    )
  );

drop policy if exists "staleness_write_admin_only" on "StalenessFlag";
create policy "staleness_write_admin_only" on "StalenessFlag"
  for update using (current_role_name() in ('manager','superadmin'));

-- Document events (view/download log): readable by manager/superadmin and
-- the document's own uploader/owner (the per-document activity page); a
-- user may only ever log an event under their own userId, never someone
-- else's.
alter table "DocumentEvent" enable row level security;

drop policy if exists "document_events_read" on "DocumentEvent";
create policy "document_events_read" on "DocumentEvent"
  for select using (
    current_role_name() in ('manager','superadmin')
    or exists (
      select 1 from "Document" d
      where d.id = "DocumentEvent"."documentId"
        and (d."uploadedById" = auth.uid()::text or d."ownerId" = auth.uid()::text)
    )
  );

drop policy if exists "document_events_insert_self" on "DocumentEvent";
create policy "document_events_insert_self" on "DocumentEvent"
  for insert with check ("userId" = auth.uid()::text);

-- App settings: singleton row of org-wide retention config
-- (app/admin/settings) — manager/superadmin only, both ways.
alter table "AppSettings" enable row level security;

drop policy if exists "app_settings_read_admin_only" on "AppSettings";
create policy "app_settings_read_admin_only" on "AppSettings"
  for select using (current_role_name() in ('manager','superadmin'));

drop policy if exists "app_settings_write_admin_only" on "AppSettings";
create policy "app_settings_write_admin_only" on "AppSettings"
  for update using (current_role_name() in ('manager','superadmin'));

-- Notifications: strictly personal — a user only ever reads or marks read
-- their own bell/slide-out entries (components/NotificationBell.tsx). No
-- insert policy: these are only ever created by the app's own service-role
-- connection when a document is published/revoked/etc., never by a user
-- directly through PostgREST.
alter table "Notification" enable row level security;

drop policy if exists "notifications_read_own" on "Notification";
create policy "notifications_read_own" on "Notification"
  for select using ("userId" = auth.uid()::text);

drop policy if exists "notifications_update_own" on "Notification";
create policy "notifications_update_own" on "Notification"
  for update using ("userId" = auth.uid()::text);

-- Share links: the "anyone with the link" token itself must never be
-- listable through PostgREST — the public share viewer (app/share/[token])
-- resolves a token server-side through the app's service-role connection,
-- so browsers never need direct table access. Only the document's
-- uploader/owner or a manager/superadmin may see or manage a doc's link
-- (components/ShareSettings.tsx), same permission shareEnabled toggling
-- already requires.
alter table "ShareLink" enable row level security;

drop policy if exists "share_links_manage" on "ShareLink";
create policy "share_links_manage" on "ShareLink"
  for all using (
    current_role_name() in ('manager','superadmin')
    or exists (
      select 1 from "Document" d
      where d.id = "ShareLink"."documentId"
        and (d."uploadedById" = auth.uid()::text or d."ownerId" = auth.uid()::text)
    )
  );

-- Inline review comments: visible to the assigned reviewer, the review's
-- requester, and manager/superadmin. Only the reviewer who wrote a comment
-- may add or edit it.
alter table "InlineComment" enable row level security;

drop policy if exists "inline_comments_read" on "InlineComment";
create policy "inline_comments_read" on "InlineComment"
  for select using (
    "reviewerId" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
    or exists (
      select 1 from "ReviewRequest" rr
      where rr.id = "InlineComment"."reviewRequestId" and rr."requestedById" = auth.uid()::text
    )
  );

drop policy if exists "inline_comments_insert_self" on "InlineComment";
create policy "inline_comments_insert_self" on "InlineComment"
  for insert with check ("reviewerId" = auth.uid()::text);

drop policy if exists "inline_comments_update_self" on "InlineComment";
create policy "inline_comments_update_self" on "InlineComment"
  for update using ("reviewerId" = auth.uid()::text);

-- Document feedback: open to any authenticated user, matching the app's own
-- "ANY authenticated user" collection model on published, feedback-enabled
-- documents (components/DocumentFeedback.tsx). Only the author edits their
-- own comment text; triaging (status/responseNote) or deleting is the
-- author, the document's own uploader, or manager/superadmin — the same
-- canTriage rule the feedback route enforces.
alter table "DocumentFeedback" enable row level security;

drop policy if exists "document_feedback_read_all" on "DocumentFeedback";
create policy "document_feedback_read_all" on "DocumentFeedback"
  for select using (auth.uid() is not null);

drop policy if exists "document_feedback_insert_self" on "DocumentFeedback";
create policy "document_feedback_insert_self" on "DocumentFeedback"
  for insert with check ("userId" = auth.uid()::text);

drop policy if exists "document_feedback_update" on "DocumentFeedback";
create policy "document_feedback_update" on "DocumentFeedback"
  for update using (
    "userId" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
    or exists (
      select 1 from "Document" d
      where d.id = "DocumentFeedback"."documentId" and d."uploadedById" = auth.uid()::text
    )
  );

drop policy if exists "document_feedback_delete" on "DocumentFeedback";
create policy "document_feedback_delete" on "DocumentFeedback"
  for delete using (
    "userId" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
    or exists (
      select 1 from "Document" d
      where d.id = "DocumentFeedback"."documentId" and d."uploadedById" = auth.uid()::text
    )
  );

-- Feedback replies: same read audience as the feedback thread they belong
-- to; only whoever could have triaged the parent item (manager/superadmin
-- or the document's own uploader) may post one, matching the replies
-- route's own enforcement. A reply's own author may edit its text.
alter table "FeedbackReply" enable row level security;

drop policy if exists "feedback_replies_read_all" on "FeedbackReply";
create policy "feedback_replies_read_all" on "FeedbackReply"
  for select using (auth.uid() is not null);

drop policy if exists "feedback_replies_insert_triage_only" on "FeedbackReply";
create policy "feedback_replies_insert_triage_only" on "FeedbackReply"
  for insert with check (
    "authorId" = auth.uid()::text
    and (
      current_role_name() in ('manager','superadmin')
      or exists (
        select 1 from "DocumentFeedback" f
        join "Document" d on d.id = f."documentId"
        where f.id = "FeedbackReply"."feedbackId" and d."uploadedById" = auth.uid()::text
      )
    )
  );

drop policy if exists "feedback_replies_update_self" on "FeedbackReply";
create policy "feedback_replies_update_self" on "FeedbackReply"
  for update using ("authorId" = auth.uid()::text);

-- Saved filters: personal only — nobody but the owning user may ever read,
-- create, edit, or delete one (lib/docFilters.ts).
alter table "SavedFilter" enable row level security;

drop policy if exists "saved_filters_own" on "SavedFilter";
create policy "saved_filters_own" on "SavedFilter"
  for all using ("userId" = auth.uid()::text)
  with check ("userId" = auth.uid()::text);

-- Prisma's own migration-history table — not part of schema.prisma, but
-- Prisma creates it in the public schema, so it's just as exposed through
-- PostgREST as any app table. No policies: it's never meant to be queried
-- by anyone but `prisma migrate deploy` itself over the direct/service-role
-- connection, so enabling RLS with nothing else denies all PostgREST access.
alter table "_prisma_migrations" enable row level security;
