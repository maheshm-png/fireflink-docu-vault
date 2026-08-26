import "dotenv/config";
/**
 * Run once after Meilisearch is up (and again if you ever change the
 * attributes in lib/search.ts). Without this, the "documents" index has
 * no filterable/searchable attributes configured and category/type/
 * staleness filters on the dashboard will silently return nothing.
 *
 * Run: npm run search:setup
 */
import { ensureIndexConfigured } from "../lib/search";
import "dotenv/config";
ensureIndexConfigured()
  .then(() => console.log("Meilisearch index configured."))
  .catch((err) => {
    console.error("Failed to configure Meilisearch index:", err);
    process.exit(1);
  });

