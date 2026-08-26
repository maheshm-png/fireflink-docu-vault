-- Row Level Security (RLS) policies for Supabase Postgres
-- Apply after `prisma migrate deploy`, via Supabase SQL editor.
-- These are a second, DB-level enforcement layer — the app must never
-- rely on the frontend alone to hide unauthorized data.

alter table "Document" enable row level security;
alter table "DocumentVersion" enable row level security;
alter table "ReviewRequest" enable row level security;
alter table "AuditLog" enable row level security;
alter table "User" enable row level security;

-- Helper: current user's role, pulled from the User table via the JWT's
-- sub claim (Supabase Auth sets auth.uid()).
create or replace function current_role_name() returns text as $$
  select role::text from "User" where id = auth.uid()::text
$$ language sql stable;

-- Documents: everyone sees published docs; only uploader/owner/manager/
-- superadmin see pending/rejected ones.
create policy "view_published_docs" on "Document"
  for select using (
    status = 'published'
    or "uploadedById" = auth.uid()::text
    or "ownerId" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
  );

create policy "insert_docs_uploaders" on "Document"
  for insert with check (
    current_role_name() in ('contributor','manager','superadmin')
  );

create policy "update_docs_owner_or_admin" on "Document"
  for update using (
    "uploadedById" = auth.uid()::text
    or current_role_name() in ('manager','superadmin')
  );

create policy "delete_docs_admin_only" on "Document"
  for delete using (
    current_role_name() in ('manager','superadmin')
  );

-- Review requests: only manager/superadmin can approve; requester can view own.
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

create policy "resolve_reviews_manager_only" on "ReviewRequest"
  for update using (
    current_role_name() = 'manager'
  );

-- Audit log: append-only, readable by manager/superadmin only.
create policy "audit_read_admin_only" on "AuditLog"
  for select using (
    current_role_name() in ('manager','superadmin')
  );

create policy "audit_insert_any_authenticated" on "AuditLog"
  for insert with check (auth.uid() is not null);

-- Users: only superadmin can manage; users can read their own row.
create policy "users_read_self_or_admin" on "User"
  for select using (
    id = auth.uid()::text or current_role_name() = 'superadmin'
  );

create policy "users_write_admin_only" on "User"
  for update using (current_role_name() = 'superadmin');

-- Designations: everyone can read (shown alongside a user's name/role);
-- only superadmin manages the option list itself (app/admin/designations).
alter table "Designation" enable row level security;

create policy "designations_read_all" on "Designation"
  for select using (auth.uid() is not null);

create policy "designations_write_admin_only" on "Designation"
  for insert with check (current_role_name() = 'superadmin');

create policy "designations_delete_admin_only" on "Designation"
  for delete using (current_role_name() = 'superadmin');

-- Categories: everyone can read (needed to pick a category on upload);
-- only manager/superadmin can create or edit one (including its form).
alter table "Category" enable row level security;

create policy "categories_read_all" on "Category"
  for select using (true);

create policy "categories_write_admin_only" on "Category"
  for insert with check (current_role_name() in ('manager','superadmin'));

create policy "categories_update_admin_only" on "Category"
  for update using (current_role_name() in ('manager','superadmin'));

-- Announcements: every authenticated user reads active ones (the dashboard
-- ticker); only manager/superadmin can post, edit, or deactivate one.
alter table "Announcement" enable row level security;

create policy "announcements_read_all" on "Announcement"
  for select using (auth.uid() is not null);

create policy "announcements_write_admin_only" on "Announcement"
  for insert with check (current_role_name() in ('manager','superadmin'));

create policy "announcements_update_admin_only" on "Announcement"
  for update using (current_role_name() in ('manager','superadmin'));

create policy "announcements_delete_admin_only" on "Announcement"
  for delete using (current_role_name() in ('manager','superadmin'));
