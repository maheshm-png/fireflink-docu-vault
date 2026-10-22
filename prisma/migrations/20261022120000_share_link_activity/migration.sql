-- Share link opens and downloads, one row per visitor (lib/shareTracking.ts).
-- Additive: a new table, nothing existing changes.
CREATE TABLE "ShareLinkActivity" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ShareLinkActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareLinkActivity_shareLinkId_visitorId_type_key" ON "ShareLinkActivity"("shareLinkId", "visitorId", "type");
CREATE INDEX "ShareLinkActivity_shareLinkId_idx" ON "ShareLinkActivity"("shareLinkId");

ALTER TABLE "ShareLinkActivity" ADD CONSTRAINT "ShareLinkActivity_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Managed only over the app's own connection, never through PostgREST.
ALTER TABLE "ShareLinkActivity" ENABLE ROW LEVEL SECURITY;
