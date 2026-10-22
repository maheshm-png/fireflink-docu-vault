-- Who opened a share link, when they were signed in to the vault (a
-- colleague). Null for customers outside the vault. Additive.
ALTER TABLE "ShareLinkActivity" ADD COLUMN "userId" TEXT;
ALTER TABLE "ShareLinkActivity" ADD CONSTRAINT "ShareLinkActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
