-- DropIndex
DROP INDEX "DocumentEvent_documentId_idx";

-- DropIndex
DROP INDEX "DocumentEvent_type_idx";

-- CreateIndex
CREATE INDEX "AuditLog_documentId_idx" ON "AuditLog"("documentId");

-- CreateIndex
CREATE INDEX "DocumentEvent_documentId_type_idx" ON "DocumentEvent"("documentId", "type");
