# Testing FireFlink Deck Vault Locally

You don't need the Oracle VM for testing — the same `infra/docker-compose.yml`
runs fine on your own laptop. Only move MinIO/Meilisearch/Ollama to the
Oracle VM when you're ready to actually deploy for real use.

Nothing here has been compiled yet (the environment that generated this code
had no internet access to run `npm install`), so your first real step —
`npm run build` — is also the first genuine correctness check. Expect to
fix a few things; that's normal for a first build, not a sign something
is fundamentally wrong.

## 1. Prerequisites
- Node.js 18+
- Docker Desktop (for MinIO + Meilisearch + Ollama, running locally)
- A free Supabase account (supabase.com) — takes ~3 minutes to spin up a project

## 2. Start local infra

```bash
cd infra
MINIO_ROOT_USER=admin MINIO_ROOT_PASSWORD=admin12345 MEILI_MASTER_KEY=localtestkey \
  docker compose up -d
```

Check they're up:
- MinIO console: http://localhost:9001 (login with the user/password above)
- Meilisearch: http://localhost:7700
- Ollama: http://localhost:11434

Create the storage bucket (MinIO console → Buckets → Create Bucket → name it
`fireflink-docs`, matching `MINIO_BUCKET` in your `.env`).

Pull a model for the staleness agent (optional for early testing, skip if
you just want to test upload/review/search first):
```bash
docker exec -it <ollama-container-name> ollama pull llama3.1:8b
```

## 3. Create your Supabase project
1. supabase.com → New Project.
2. Once it's up: Settings → API → copy the Project URL, `anon` key, and
   `service_role` key.
3. Settings → Database → copy the connection string for `DATABASE_URL`.

## 4. Configure the app

```bash
cp .env.example .env
```
Fill in: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (from Supabase), and
`MINIO_ENDPOINT=http://localhost:9000`, `MINIO_ACCESS_KEY=admin`,
`MINIO_SECRET_KEY=admin12345`, `MEILISEARCH_HOST=http://localhost:7700`,
`MEILISEARCH_API_KEY=localtestkey`, `OLLAMA_HOST=http://localhost:11434`.

Leave `GCHAT_WEBHOOK_URL`/`GCHAT_MANAGER_WEBHOOK_URL` blank for now — every
notification call already no-ops without them, so you can test the whole
app without a real Google Chat space wired up.
`ALLOWED_EMAIL_DOMAINS` — set it to a domain you can actually receive test
invites at (e.g. your own email's domain), or the Supabase invite flow
won't be usable in testing.

## 5. Install, migrate, index

```bash
npm install
npx prisma migrate dev --name init
npm run search:setup
```
Then open the Supabase SQL editor and paste/run the contents of
`prisma/rls_policies.sql`.

## 6. Bootstrap your superadmin account
The app can only create users once a superadmin exists, so the first one
has to be created directly in Supabase:
1. Supabase dashboard → Authentication → Users → Add user (your email +
   a password you'll actually use to log in).
2. Supabase dashboard → Table Editor → `User` table → insert a row:
   `id` = the same UUID as the auth user you just created, plus your
   email, name, and `role = superadmin`.

## 7. Run it

```bash
npm run dev
```
Open http://localhost:3000/login and sign in with the superadmin account
from step 6.

## 8. What to actually click through

Go roughly in this order — each step sets up what the next one needs:

1. **Manage Users** (nav) → invite a second test account (must match your
   `ALLOWED_EMAIL_DOMAINS`) with role `sc`. Accept the invite email from
   Supabase to set a password for that account.
2. **Categories** → New Category. Give it a name, then add 2-3 custom
   fields (e.g. a required dropdown "Region: APAC, EMEA, NA" and a
   required text field "Client Name").
3. Log in as the SC test account → **Upload Document** → pick your new
   category → confirm its custom fields appear and block submission until
   filled in → pick your superadmin as reviewer → upload any small file
   (a PDF or PPTX is the best test since those get text-extracted).
4. Log back in as superadmin → open the document from **Pending Review**
   (or the dashboard) → confirm you see the custom field answers under
   "Document Details" → try clicking **Approve & Publish** with neither
   Yes/No picked (should be disabled) → pick "Yes, announce it" → approve.
5. Confirm: the doc now shows as Published, appears in **All Documents**
   search/filters, and (if you set a real `GCHAT_WEBHOOK_URL`) the team
   space got a notification, plus every other user's in-app bell.
6. Click **Download Current Version** — confirm it actually downloads the
   file (not a JSON blob) with the correct original filename and opens
   without any corruption/quality loss.
7. Upload a new version of the same doc with a changelog note → approve it
   too → go to the document page → **Compare Versions** → confirm you see
   a real diff of the extracted text between the two versions.
8. **Analytics** (nav) → confirm your view/download just now shows up.
9. **Audit Log** (nav) → confirm upload/approve/download all logged.
10. Log in as an "Other" (view-only) role user → confirm they can view and
    download published docs but have no Upload/Manage Users/Categories
    options anywhere in the nav.
11. Try `npm run staleness:run` after backdating a category's review cycle
    or a doc's `lastReviewedAt` in the DB — confirm a staleness flag shows
    up on the doc.
12. Try `npm run digest:send` — confirms it doesn't error even with no
    `GCHAT_WEBHOOK_URL` set (should just skip silently).

If all of that works, you have a genuinely working local instance. Moving
to production from there is just swapping the local Docker services for
the Oracle VM ones and deploying the Next.js app to Render, per the main
README.

## 9. Team access control and Review Bypassed

### Rolling it out on an existing database (dev first, then prod)
1. Deploy the new image as usual. `docker-entrypoint.sh` runs `prisma migrate deploy` on start, which
   applies `20261009120000_add_team_access_control` automatically. It only adds columns/tables;
   every existing document becomes visibility `org` (unchanged behaviour) and every user's old single
   team is copied into `UserTeam`.
2. Search needs no step: the app adds the new filterable attributes on its first search, and entries
   indexed before this (all `org`) stay visible. `npm run reindex:search` is optional.
3. Optional second layer: re-run `prisma/rls_policies.sql` in the Supabase SQL editor.
4. In Admin > Teams, tick **Leadership** on the leadership team. In Admin > Users, put each person in
   their team(s).

Rollback without losing data: `UPDATE "Document" SET visibility = 'org';` makes every document
visible to everyone again. Nothing else needs undoing; `User."teamId"` was left untouched.

### Test matrix
Set up: teams **Alpha**, **Beta**, **Leadership** (flagged). Users: contributor A1 and manager AM in
Alpha, user B1 and manager BM in Beta, manager LM in Leadership, user N1 in no team, a superadmin.
As A1, upload document **R** restricted to Alpha with reviewer AM, and have AM approve it with
"announce" Yes.

| Check | A1 | AM | LM | Superadmin | B1 | BM | N1 |
|---|---|---|---|---|---|---|---|
| R in Published list, category tab count, Home tile count | yes | yes | yes | yes | no | no | no |
| R found by keyword search | yes | yes | yes | yes | no | no | no |
| AI assistant cites R | yes | yes | yes | yes | no | no | no |
| `/dashboard/documents/<R id>` opens | yes | yes | yes | yes | 404 | 404 | 404 |
| `/api/documents/<R id>/preview` and `/download` | yes | yes | yes | yes | 404 | 404 | 404 |
| "New in ..." bell notification for R | uploader | yes | yes | yes | no | no | no |
| R in Analytics top lists / Revoked / Stale / Deleted pages | n/a | yes | yes | yes | n/a | no | n/a |
| Audit log shows R's title | n/a | yes | yes | yes | n/a | "Restricted document" | n/a |

Also check:
- Upload as B1 with title "R" (same title): no duplicate warning naming R.
- No Google Chat message mentions R (publish, revoke, review assigned).
- On R's Manage tab as A1: Allow Sharing shows **Request approval**; clicking it notifies AM and LM.
  As AM, Allow Sharing turns on. As BM, the share API returns 404.
- Reviewer pickers (upload, reassign, second opinion) for R only list AM and LM.
- As A1, Manage tab cannot switch R back to "Everyone"; as AM it can.
- Admin > Teams: deleting Alpha is refused while R is restricted to it.
- Remove A1 from Alpha in Admin > Users: within ~10 seconds A1 still sees R (uploader), but a
  second Alpha user removed from the team loses it.

Reviewer confirmation of visibility (mandatory):
- Upload as A1 restricted to Alpha, reviewer AM. On the Review tab, Approve & Publish stays disabled
  until "Who can see this document?" is answered; it starts unanswered and shows the current setting.
- AM picks "Everyone in the organization" and approves: the document publishes visible to all, B1 can
  open it, and the audit log shows a change_access entry by AM.
- Upload as A1 visible to everyone; AM picks "Restricted to teams" > Alpha and approves: B1 gets 404.
- Posting an approval to `/api/documents/<id>/review` without `visibility` returns 400.
- With two parallel reviewers, only the last (publishing) approver's choice is applied.
- The approver can tick any team, including ones they aren't in (e.g. AM restricts to Beta): it
  publishes restricted to Beta, BM and B1 can open it, and the approver's "allow sharing" answer is
  kept.
- After publishing, the Manage tab's "Who Can See This" still lets AM change teams or the restriction.

Review Bypassed:
- As AM, upload with **No review needed**: the document is published immediately, shows the
  **Review Bypassed** badge in lists and on the detail page, the review trail shows AM's approval with
  "Review bypassed", and it appears in search.
- As AM, upload a new version with **No review needed**: published immediately, still labelled.
- Upload a new version without it: the form asks for a reviewer (the last round's only reviewer was
  AM); once that reviewer approves, the Review Bypassed badge disappears.
- As A1 (contributor), the No review needed option is not shown, and posting `bypassReview=true` to
  `/api/documents` directly returns 403.

### Team Space and My Work

- **Team Space** (nav, under Documents): as A1, only documents restricted to team A are listed, with an
  "All my teams" tab plus one tab per team. Filters, keyword search and saved filters work per tab.
  A user in no team sees the "You aren't in a team yet" message. As L1 or the superadmin, every team's
  tab is shown.
- **My Work** (nav, hidden for the plain user role):
  - As AM, **Waiting on me** lists only documents with a pending review assigned to AM. Approve one:
    it leaves that tab and appears under **Reviewed by me** with "You approved this on ..." on the
    status badge hover.
  - **My uploads** lists everything AM uploaded or uploaded a new version of, in every status.
  - As A1 (contributor), only **My uploads** is shown.
  - **Find a document**: search a title word. Results include any document you can see and link to
    its page. As B1, searching a team A restricted title returns nothing; as L1 it is found.

### Preview-only documents (download control)

Migration `20261009150000_add_document_downloadable` adds `Document.downloadable` (default true, so every
existing document keeps downloading).

- Approve a document: the "Before publishing" box has 5 one-tap questions plus **Use suggested answers**.
  Approve stays disabled until all 5 are answered.
- Choose **Selected teams**: "Can people download it?" locks to **Preview only**.
- Publish an org-wide document as **Preview only**:
  - The "Preview only" badge shows in lists and on the document.
  - There's no Download button anywhere (list, grid, detail, Versions tab, reviewer panel).
  - Quick preview opens the watermarked page viewer with right-click blocked.
  - `GET /api/documents/<id>/download` returns 403, for superadmins too.
- Share link on a preview-only document: the modal offers only "View only". An old "View & download"
  link shows no Download button, and `/api/share/<token>/download` returns 403.
- Manage tab → **Downloads**: a manager switches between Allow download and Preview only. For a
  restricted document the switch is locked.

### Merged pages

- **Home = Published:** "Home" in the nav and the logo open the published documents page (welcome
  header, category tabs, filters). `/dashboard/home` redirects there. There's no separate "Published"
  item under Documents any more.
- **Review Dashboard → My Work:** the "Dashboard" nav link is gone. `/dashboard/pending?status=rejected`
  redirects to My Work → "Everything I'm in" → Rejected. My Work has status chips (All, Pending
  review, Published, Rejected, Archived, Revoked) on every tab. A superadmin gets "All documents"
  (org-wide) as the first tab. Documents → Archived and the Analytics tiles open My Work too.
- The Published filters no longer offer "Flagged outdated" (it never matched anything). Use
  Analytics → Flagged Outdated.

## 10. Team roles, Global approvers and Request for Everyone

Each person now has an org role (User.role, for documents visible to everyone) and a role in each of
their teams (UserTeam.role: Member, Contributor, Manager) for that team's restricted documents. The
rules live in `lib/access.ts`.

### Rolling it out (dev first, then prod)
1. Migrations `20261010100000_add_team_roles` and `20261012100000_add_global_approvers` are additive.
   The first gives every existing membership the team role matching the person's org role (org
   manager -> team Manager, contributor -> Contributor, everyone else -> Member), so uploading and
   approving inside teams works on day one as it did before. The second adds `User.isGlobalApprover`
   (false for everyone) and the empty `GlobalPublishRequest` table.
2. Optional: re-run `prisma/rls_policies.sql` (adds RLS on `GlobalPublishRequest`).
3. Settings > **Global Approvers** (superadmin): pick at least one person, or teams can't raise a
   Request for Everyone.
4. Manage Users > Teams column: adjust anyone's team role where it should differ from the default.

Rollback without losing data: `UPDATE "User" SET "isGlobalApprover" = false;` stops new requests; team
roles can be left in place (older code never reads them).

### What changed from section 9
- Reviewers of a restricted document are its **team managers** (any org role). Leadership managers who
  aren't Managers of the document's team no longer appear in reviewer pickers and can't approve,
  reject, edit, revoke, archive, delete, share or change teams on it. They still see it and can
  comment (Feedback), even when feedback is off; the team's managers get a bell + email.
- A restricted document can't be opened to Everyone at approval or from the Manage tab (superadmins
  excepted). Team managers use **Request for Everyone** instead.
- A team manager can extend a team document to any other team from the Manage tab.
- Uploading restricted documents needs a Contributor or Manager team role in each chosen team. A
  person whose org role is User but who is a team Contributor/Manager can upload, restricted to their
  teams only; My Work and the Upload button appear for them.
- "No review needed" on a team document needs the Manager team role in every chosen team.
- A review assigned before this change to someone who no longer qualifies stays visible to them with
  only **Reassign** and **Request Additional Review**, so nothing gets stuck.

### Test matrix
Set up teams **Alpha** and **Beta**, and **Leadership** (flagged). Users: X (org User, Alpha
Contributor), AM (org Contributor, Alpha Manager), OM (org Manager, Alpha Member), LM (org Manager,
Leadership Member), GA (any role, Global approver), BM (Beta Manager).

- As X: Upload opens with "Everyone" disabled and Alpha ticked. Upload restricted to Alpha; the
  reviewer list shows AM only (not OM, not LM). Posting `visibility=org` to `/api/documents` returns 403.
- As AM: Waiting on me shows it; approve. The "Who can see it?" Everyone option is disabled.
- As OM: the document opens (Alpha member) but there's no approve/edit/revoke/archive/delete; reviewer
  pickers for Everyone documents still list OM.
- As LM: the document opens; Feedback tab lets LM comment even if feedback is off; AM gets a
  "Leadership commented" bell and email. LM has no Manage actions.
- As AM, Manage tab: tick Beta under Who Can See This and save; BM can now open it.
- As AM, Manage tab > **Request for Everyone**: enter a reason and send. GA gets a bell + email; My
  Work shows **Requests for Everyone** with the document. A second request is refused (409) while one
  waits. AM can Withdraw it.
- As GA (not in Alpha): the document opens and previews while the request waits. **Send Back** without
  a comment is refused; with one, AM gets a bell + email and the Manage tab shows "Last request sent
  back ... : <comment>". Raise again and **Approve for Everyone**: the document becomes visible to all,
  shows in search for B users, AM is notified, and the audit log shows `everyone_request_approved`
  and `change_access`.
- GA can't decide a request they raised themselves (403).
- Manage Users: tick a new team for an org Contributor; the role picker pre-fills Contributor. Change
  it to Manager and save; the Teams cell shows "Alpha (Manager)", and the audit log shows
  `team_role_change`.

## 11. Simplified access (2026-10-12)

Section 10's Leadership teams are replaced as described here, and Global approvers become one
Global approver.

Rollout: after `20261012100000_add_global_approvers`, run
`prisma/migrations/20261012120000_simplify_access/migration.sql` (adds `User.seesAllTeams`, copies it
from today's Leadership team members, turns sharing off on team documents and removes their links,
keeps at most one Global approver, updates the RLS helper). Nothing is dropped. Code backup taken
before the change: `../code-backups/pre-simplify-2026-10-12.tgz`.

Sales/BD setup to check the main requirement: a Sales member gets org role **User** and team role
**Contributor** in Sales; the Sales lead gets team role **Manager** in Sales.
- As the Sales member: Upload is offered, "Everyone in the organization" is greyed out, the Reviewer
  list shows only Sales team managers. A direct API upload with `visibility=org` returns 403.
- As the Sales lead: the upload is in Waiting on me; Reject with comments sends it back, a new version
  opens a new round, Approve publishes it to Sales only.
- As anyone outside Sales (including an org Manager not in Sales): the document is a 404, absent from
  search, the AI assistant and notifications. Superadmins and people with Sees all teams do see it.
- Sales members can download it when the approver allowed downloads. There is no Share button on it.
- On a document for everyone, the Sales member can create a customer share link while sharing is on.

What changed, and what to click:
- **Sees all teams** is a tick per person in People > Users (team editor). Tick it for a User in no
  team: Home > My teams lists every team's documents; Feedback lets them comment; no Manage actions.
- **Global approver**: Settings (superadmin) picks one active org manager. A team manager's Request
  for Everyone goes only to them: My Work > Waiting on me ("Request for Everyone: ..."), plus Approve /
  Send back on the document page. Other managers don't see the team document. With nobody picked,
  raising a request is refused with "No Global approver is set up". If the approver loses the
  Manager role, Settings warns and they can no longer decide.
- **No review needed** (opt-in checkbox) is offered to org Managers for Everyone uploads and to team
  Managers for their team's uploads, never to Contributors. Ticked, it publishes with a Review
  Bypassed label; unticked, a reviewer is required as usual. Same on New Version.
- **Archive replaces Revoke.** Archive hides a document and, if it was published, everyone who could
  see it gets a "Document withdrawn" bell. Restore (same button) puts it **Back in review** with the
  last round's reviewers; it stays hidden until approved. `/dashboard/revoked` redirects to Home.
  My Work's **In review** filter also lists Back in review documents.
- **Home has Everyone | My teams.** `/dashboard/team-space?team=X` redirects to `/dashboard?space=teams&team=X`.
- **People** in Controls opens Users, with Teams and Designations as tabs.
- **Sharing:** team documents have no Share button, no Allow Sharing switch, and the approval question
  is locked to Not allowed. `PATCH /api/documents/:id/share` with `shareEnabled: true` on one returns 400.
- **Downloads:** team documents follow the approver's Allow download / Preview only answer, like any
  other. Team documents approved before this change were stored preview only; a team manager can turn
  downloads on in the Manage tab.
- **Help > Roles & Features** shows "Your access" (role, role in each team, Sees all teams) and two
  tables: Documents for everyone, Team documents.

## 12. Team folders, team search, uploading into another team (2026-10-12)

Rollout: run `prisma/migrations/20261012130000_team_folders/migration.sql` after section 11's migration
(adds `TeamFolder` and `DocumentTeamAccess.folderId`; purely additive, documents start unfiled).

- **Folders**: as a team Manager, Home > My teams > pick the team: **New folder**, then open it and
  rename or delete it from the same bar. A team Member or Contributor sees the folders but no buttons
  (the API returns 403). Deleting a folder keeps its documents under "Not in a folder".
- **Filing**: when uploading for exactly one team that has folders, a Folder picker appears. A team
  Manager can move any team document on its Manage tab (Folder row). Someone outside the team gets no
  folder picker, and a forged `folderId` is refused.
- **Team search**: the search box above My teams finds documents by title, tags, category, uploader and
  text inside the file, within the chosen team/folder, and says how many matched.
- **Uploading into another team**: an org Contributor not in Sales can tick Sales on the upload form; a
  note says they will see only this upload there. The reviewer list shows only Sales managers; no "No
  review needed" box. An org Manager in the same spot gets the box. Afterwards they find it in My Work >
  My uploads, can edit it and upload a new version after a rejection, but Home > My teams shows no Sales
  chip and other Sales documents are still a 404.
- **Self-explaining pages**: every document page shows "You can ... You can't ..." for the viewer, with
  a link to Help; Home > My teams says what your role in the picked team lets you do; the profile menu
  explains your role and links to Help (menu item renamed "What can I do?").

## 13. Categories and who manages a document (2026-10-12)

Rollout: run `prisma/migrations/20261012140000_extra_categories/migration.sql` (adds `DocumentCategory`;
additive). Applied to dev on 2026-10-12.

- **Move / Also show in**: on a document's Manage tab > Document Details > Edit (uploader, or a manager
  who reviewed it), change Category: the detail fields switch to the new category's and its required
  fields must be filled. Tick extra categories under "Also show in": the document page shows them as
  badges, Home lists it under each of those category tabs and counts it there. No new review happens.
- **Only involved managers manage a document**: as Manager A, approve a document. As Manager B (never a
  reviewer on it) open it: the line reads "You can't change it: only <uploader> and the managers who
  reviewed it can"; no Edit, Archive, Delete, sharing/download/feedback switches or Who Can See This.
  The APIs answer 403 (e.g. POST /archive). Add B as a reviewer on a new round (Add reviewers/Reassign),
  and B gets the controls. A superadmin can still archive/restore and change settings.
- **Back in review stays hidden**: restore an archived document, then as an uninvolved user call
  `/api/documents/<id>/preview`: 404/403, no preview.
- **Upload only where allowed**: Home > Everyone shows "Upload for everyone" only for org Contributors,
  Managers and superadmins (it opens the form set to Everyone, keeping the category tab). Home > My teams
  shows no Upload on "All my teams" (just "Pick a team to upload a document to it."); inside a team it
  shows "Upload to <team>" or "Upload to <folder>" only if you may upload there, and opens the form with
  that team and folder ticked. A team Member sees no Upload button in that team. My Work keeps a plain
  Upload button.
- **Invite with team roles**: People > Users > invite form has "1. Org role" (User / Contributor /
  Manager, each with a one-line meaning) and "2. Team roles" (tick teams, pick Member / Contributor /
  Manager per team; ticking pre-fills from the org role). The new person shows "Presales (Contributor)"
  under Team roles straight away. A bad role or team id in the API body returns 400 before any account
  is created. Re-adding a removed person replaces their old teams with the ones picked.
- **Two levels everywhere**: People table columns read "Org role" and "Team roles"; the profile menu
  shows two matching boxes (Org role, Team roles with the role in each team); Help > What can I do?
  opens with the same two boxes.
