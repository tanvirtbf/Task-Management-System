# 🔧 REMEDIATION PLAN — Phase-Wise Execution
## BeautyBooth Task Management System — 55 Issues, 73 Hours

> **Strategy:** Fix step-by-step (not all at once). Each phase is independently verifiable, tested, and deployable.

---

## 📋 Overview

| Phase | Focus | Issues | Effort | Timeline | Risk |
|---|---|---|---|---|---|
| **P0** | Critical security + data integrity | 4 critical | 5.5h | Day 1 | 🔴 High (but must fix) |
| **P1** | High-severity (ship-blocking) | 9 high | 17.5h | Days 2-3 | 🟠 Medium |
| **P2** | Medium (deploy-ready, optimize next) | 15 medium | 20h | Days 4-6 | 🟡 Medium |
| **P3** | Low-priority (backlog) | 27 low | 30h | Backlog | 🟢 Low |

**Total Effort:** ~73 hours (~2 weeks for 1 engineer, ~3-4 days for 2 engineers)

---

# 🔴 PHASE 0: CRITICAL FIXES (5.5 hours, Day 1)

**Goal:** Fix 4 critical issues that affect data integrity + security. Deploy Phase 0 before anything else.

## Issue P0-01: Timezone Bug (SLA/On-call)
**File:** `database/schema.sql` + `server/src/db/migrations/_post.sql`  
**Severity:** 🔴 CRITICAL  
**Impact:** SLA breaches show 6 hours off; on-call rotations misaligned  
**Effort:** 30 minutes

### Steps:
1. Read `database/schema.sql` (lines 1337-1352) and `_post.sql` view definitions
2. Replace `NOW()` → `UTC_TIMESTAMP()` and `CURDATE()` → `UTC_DATE()` in:
   - `v_breached_sla` view
   - `v_current_on_call` view (if used)
3. Check all SLA/on-call queries in services to confirm they use `UTC_TIMESTAMP()`
4. **Verify:** Run query on prod DB: `SELECT NOW(), UTC_TIMESTAMP();` should show 6h difference
5. **Test:** Run SLA service tests → should still be green
6. **Deployment:** Schema change requires DB migration (no data loss)

### Rollback:
- Revert schema changes
- Existing data not affected (view queries only)

**Blocking:** None (independent)

---

## Issue P0-02: Attachment Counter Corruption
**Files:** `server/src/db/migrations/_post.sql` (lines 52-70)  
**Severity:** 🔴 CRITICAL  
**Impact:** Tasks show wrong attachment counts; counter diverges from truth  
**Effort:** 1 hour

### Steps:
1. Read canonical `database/schema.sql` (lines 1221-1250) — correct trigger definition
2. Read current `_post.sql` (lines 52-70) — missing upload_status='complete' check
3. Fix _post.sql triggers to match canonical schema:
   - **INSERT trigger:** Only count when `upload_status='complete'`
   - **UPDATE trigger:** Check status transition from `complete` to other states
   - **DELETE trigger:** Only decrement if `upload_status='complete'`
4. **Data audit:** Query to find corrupted counts:
   ```sql
   SELECT t.id, t.attachments_count, COUNT(a.id) as true_count
   FROM tasks t
   LEFT JOIN attachments a ON a.task_id=t.id AND a.upload_status='complete' AND a.deleted_at IS NULL
   GROUP BY t.id
   HAVING t.attachments_count != COUNT(a.id)
   LIMIT 10;
   ```
5. If corrupted rows found: Run migration to recalculate:
   ```sql
   UPDATE tasks t 
   SET attachments_count = (
     SELECT COUNT(*) FROM attachments a 
     WHERE a.task_id=t.id AND a.upload_status='complete' AND a.deleted_at IS NULL
   );
   ```
6. **Test:** Run attachment tests → should be green
7. **Deployment:** Trigger + migration (2 files changed)

### Rollback:
- Revert trigger definition
- Recalculation query (re-audit for corruption)

**Blocking:** None (independent)

---

## Issue P0-03: XSS in TiptapReadOnly (dangerouslySetInnerHTML)
**File:** `client/src/components/editor/TiptapEditor.tsx` (line 252)  
**Severity:** 🔴 CRITICAL  
**Impact:** Authenticated XSS — malicious HTML could execute scripts  
**Effort:** 2 hours

### Steps:
1. Read TiptapEditor.tsx (lines 240-260) — find TiptapReadOnly component
2. Identify the `dangerouslySetInnerHTML` usage:
   ```tsx
   <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
   ```
3. Install DOMPurify:
   ```bash
   npm install dompurify
   npm install --save-dev @types/dompurify  # TypeScript
   ```
4. Replace with sanitization:
   ```tsx
   import DOMPurify from 'dompurify';
   
   const sanitized = DOMPurify.sanitize(htmlContent, { 
     ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'a', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'],
     ALLOWED_ATTR: ['href', 'title', 'target']
   });
   
   <div dangerouslySetInnerHTML={{ __html: sanitized }} />
   ```
5. **Test:** Create a task with XSS payload in description:
   ```
   <img src=x onerror="alert('XSS')">
   ```
   Should render as text, NOT execute
6. **Unit test:** Add test case:
   ```typescript
   it('sanitizes HTML in read-only view', () => {
     const malicious = '<img src=x onerror="console.log(1)">';
     render(<TiptapReadOnly value={malicious} />);
     expect(screen.queryByAltText('x')).not.toBeInTheDocument();
   });
   ```
7. **Deployment:** Frontend only (no backend change)

### Rollback:
- Revert TiptapEditor.tsx
- Remove DOMPurify from package.json

**Blocking:** None (independent)

---

## Issue P0-04: Workspace Isolation Bypass (Custom Field Upsert)
**File:** `server/src/services/CustomFieldsService.ts`  
**Severity:** 🔴 CRITICAL  
**Impact:** Cross-workspace data corruption; custom field values leak between workspaces  
**Effort:** 2 hours

### Steps:
1. Read CustomFieldsService.ts — find `upsertValue()` method
2. Current code accepts `taskId` + `customFieldId` without validating both belong to same workspace
3. Fix:
   ```typescript
   async upsertValue(taskId: string, customFieldId: string, value: any, workspaceId: string) {
     // Validate task exists in workspace
     const task = await this.tasksRepo.findByIdInWorkspace(taskId, workspaceId);
     if (!task) throw AppError.notFound('task.not_found', '...');
     
     // Validate custom field exists in workspace
     const field = await this.customFieldsRepo.findByIdInWorkspace(customFieldId, workspaceId);
     if (!field) throw AppError.notFound('custom_field.not_found', '...');
     
     // Validate field belongs to task's list (extra guard)
     const fieldList = await this.listsRepo.findByIdInWorkspace(field.listId, workspaceId);
     if (!fieldList) throw AppError.unprocessable('custom_field.invalid_list', '...');
     
     // NOW safe to upsert
     return this.customFieldsRepo.upsertValue(taskId, customFieldId, value);
   }
   ```
4. **Test:** Write test case:
   ```typescript
   it('rejects custom field values for cross-workspace task', async () => {
     const task = tasks[workspaceA.id][0];
     const field = customFields[workspaceB.id][0];
     
     await expect(service.upsertValue(task.id, field.id, 'value', workspaceA.id))
       .rejects.toThrow('custom_field.not_found');
   });
   ```
5. **Integration test:** Via API - POST /tasks/:id/custom-field-values with cross-ws field should 404
6. **Deployment:** Backend only (validation layer)

### Rollback:
- Revert CustomFieldsService.ts

**Blocking:** None (independent)

---

## ✅ Phase 0 Sign-off Checklist

- [ ] Timezone bug: UTC_TIMESTAMP in views, test SLA service
- [ ] Attachment counter: Triggers fixed, data audit run, no corrupted rows
- [ ] XSS: DOMPurify integrated, malicious HTML tested + unit test added
- [ ] Custom field isolation: Cross-workspace validation added, integration test green
- [ ] **DB migration created** (timezone + attachment counter fixes)
- [ ] **Frontend rebuild** (XSS fix)
- [ ] **All tests passing:** `npm run test`
- [ ] **Staging deploy:** Verify each fix on staging DB
- [ ] **Production deployment:**
  1. Run DB migration (attachment counter data audit + trigger fix)
  2. Deploy backend (custom field validation)
  3. Deploy frontend (XSS fix)
  4. Verify no errors in logs

**Estimated Total Time:** 5.5 hours  
**Recommendation:** Run Phase 0 + Phase 0 sign-off in 1 day, then deploy before Phase 1

---

# 🟠 PHASE 1: HIGH-SEVERITY FIXES (17.5 hours, Days 2-3)

**Goal:** Fix 9 ship-blocking issues. After Phase 0, these are dependencies for a stable release.

**Dependencies:** Phase 0 must be done first (no cross-dependencies within Phase 1)

---

## Issue P1-01: Error Code Mismatch (API Contract)
**File:** `server/src/middlewares/errorHandler.ts`  
**Effort:** 3 hours  
**Blockers:** None

### Root Cause:
- HttpError exceptions return generic codes ("not_found", "conflict")
- Should return domain-specific codes ("task.not_found", "list.not_found")
- AppError already uses correct codes; HttpError is the gap

### Fix Strategy:
1. Option A: Ensure ALL domain errors use AppError (safest)
2. Option B: Update errorHandler to infer domain-specific codes from context

**Recommendation:** Option A (uses existing pattern)

### Steps:
1. Grep for `throw new HttpError(404, ...)` in all services
2. Replace with `throw AppError.notFound('entity.not_found', ...)`
3. Ensure all 404/409/422 use AppError, not HttpError
4. Update test assertions to match new error codes
5. Add integration test: GET /api/v1/tasks/invalid → 404 with code "task.not_found"

**Test:** Run all integration tests, error codes should match spec §32

---

## Issue P1-02: Form Data Unencrypted (PII Exposure)
**Files:** Database schema + FormService.ts  
**Effort:** 4 hours  
**Blockers:** None (but high priority)

### Root Cause:
- Raw user PII (emails, phone, responses) stored in form_submissions.data JSON as plaintext
- No encryption, no retention policy
- Regulatory risk (GDPR, CCPA)

### Fix Strategy:
1. Add `encryption_key` to `.env` (256-bit key, generated once)
2. Add `encrypted_at`, `expires_at` columns to form_submissions table
3. Encrypt data on insert, decrypt on read
4. Add retention policy (auto-delete after 90 days)

### Steps:
1. Migration: Add columns to form_submissions
2. Add encryption utility (use `crypto` module or libsodium)
3. Update FormService.createSubmission() to encrypt data
4. Update FormService.getSubmission() to decrypt data
5. Add scheduled job to delete expired submissions (daily)
6. Test: Verify encrypted data in DB, decrypt on read returns plaintext

---

## Issue P1-03: ARIA Violations (3 places)
**Files:** InlineNameEdit.tsx, TaskRow.tsx, AttachmentsSection.tsx  
**Effort:** 2 hours  
**Blockers:** None

### Fix:
Add `aria-label` to all role="button" elements:
```tsx
<div role="button" aria-label="Edit task name" onClick={...} />
```

### Test:
- Run axe-core audit: `npm install @axe-core/react`
- No accessibility violations reported

---

## Issue P1-04: Insecure Cookies (HTTP in Dev)
**File:** AuthController.ts  
**Effort:** 1 hour

### Fix:
```typescript
const isProduction = process.env.NODE_ENV === 'production';
res.cookie('refreshToken', token, {
  secure: isProduction || process.env.FORCE_SECURE === 'true',  // HTTPS only
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

---

## Issue P1-05: API Key Logging Risk
**File:** openaiClient.ts  
**Effort:** 1.5 hours

### Fix:
```typescript
export const createOpenAIClient = (apiKey: string | undefined): OpenAI | null => {
  if (!apiKey) return null;
  try {
    return new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  } catch (err) {
    // Sanitize error: never log the key
    const message = err instanceof Error ? err.message : String(err);
    logger.error('openai.client.init_failed', { message, hint: 'check OPENAI_API_KEY' });
    throw new Error('Failed to initialize OpenAI client');
  }
};
```

---

## Issue P1-06: No Rate Limit on Invitation Enumeration
**File:** AuthController.ts  
**Effort:** 0.5 hours

### Fix:
Apply `assistantLimiter` (20/min) or new `invitationLimiter` (5/min) to GET /auth/invitation/:token

---

## Issue P1-07: N+1 Bulk Update (Tasks)
**File:** TasksService.ts  
**Effort:** 3 hours

### Root Cause:
```typescript
for (const taskId of taskIds) {
  const task = await this.tasks.findByIdInWorkspace(taskId, ws);  // 1 + N queries
  // hydrate...
}
```

### Fix:
```typescript
const tasks = await this.tasks.findManyByIdsInWorkspace(taskIds, ws);  // 1 query
const [assignees, watchers, tags, cf] = await Promise.all([
  this.tasks.assigneesByTask(taskIds),  // 1 batched query
  this.tasks.watchersByTask(taskIds),
  this.tasks.tagsByTask(taskIds),
  this.tasks.customFieldValuesByTask(taskIds),
]);
```

---

## Issue P1-08 & P1-09: useEffect Dependency Issues
**Files:** AssistantWidget.tsx, CreateTaskModal.tsx  
**Effort:** 2.5 hours

### Fix:
Wrap store functions in useCallback or remove from dependency array with eslint-disable comment + explanation

---

## ✅ Phase 1 Sign-off

- [ ] All error codes return domain-specific values
- [ ] Form data encrypted at rest, 90-day retention
- [ ] No ARIA violations (axe-core audit clean)
- [ ] Cookies secure in production
- [ ] OpenAI key never logged
- [ ] Rate limit on invitation endpoint
- [ ] Bulk update batched (1+4 queries, not 1+N)
- [ ] useEffect dependencies fixed
- [ ] All integration tests green
- [ ] Staging test on data encryption

**Estimated Total Time:** 17.5 hours  
**Deployment:** Phase 0 + Phase 1 together (day 3 end)

---

# 🟡 PHASE 2: MEDIUM-PRIORITY (20 hours, Days 4-6)

Bundle size, virtualization, SSE memory leak, N+1 in comments, email retry, etc.

**Condition:** Deploy ONLY after Phase 0 + Phase 1 are stable on production for 24 hours

**Recommendation:** Parallelizable:
- 1 engineer: Bundle optimization (8h) + browser E2E test
- 1 engineer: SSE + email retry (4h) + CommentsService N+1 (2h)
- 1 engineer: ListView virtualization (4h) + cache headers (1h)

---

# 🟢 PHASE 3: LOW-PRIORITY (30 hours, Backlog)

Code quality, minor validations, observability, etc.

**Condition:** After Phase 2 stable + all phases tested on production

---

## 🚀 Deployment Strategy

```
Week 1:
  Day 1:   Phase 0 (5.5h)     → Stage → Production ✅
  Day 2-3: Phase 1 (17.5h)    → Stage → Production ✅
  Day 3:   Phase 1 verify (24h in prod)
  Day 4-6: Phase 2 (20h)      → Stage → Production ✅

Week 2:
  Phase 3 (backlog, schedule in sprints)
```

---

## 📊 Effort Summary

| Phase | Issues | Hours | Timeline | Risk |
|---|---|---|---|---|
| P0 | 4 | 5.5 | Day 1 | 🔴 High |
| P1 | 9 | 17.5 | Days 2-3 | 🟠 Medium |
| P2 | 15 | 20 | Days 4-6 | 🟡 Low |
| P3 | 27 | 30 | Backlog | 🟢 Low |
| **TOTAL** | **55** | **73** | **~2 weeks** | — |

---

## ⚠️ Risk Mitigation

**Per Phase:**
1. Run full test suite after each fix
2. Deploy to staging first (24h verification)
3. Rollback plan documented for each issue
4. Monitor production logs for errors

**Critical:** Phase 0 must be 100% green before Phase 1 starts

**Recommended:** 2 engineers (parallel Phases 1 + 2 planning)

---

## ✅ Go/No-Go Criteria

| Phase | Go Criteria |
|---|---|
| **P0** | All 4 issues fixed + tests green + staging stable 24h |
| **P1** | Phase 0 stable on prod + all 9 issues fixed + tests green |
| **P2** | Phase 1 stable on prod + bundle <600kB gzipped |
| **P3** | Phase 2 stable + backlog prioritized by team |

