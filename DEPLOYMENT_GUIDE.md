# 🚀 Deployment Guide — Phase 0 + Phase 1 Critical & High-Priority Fixes

**Date:** 2026-07-08  
**Commits:** 6 (Phase 0 + Phase 1 complete)  
**Status:** Ready for staging → production deployment

---

## 📊 What's Being Deployed

| Phase | Issues | Status | Impact |
|---|---|---|---|
| **Phase 0** | 4 critical | ✅ FIXED | Security + data integrity |
| **Phase 1** | 9 high-severity | ✅ FIXED | API contract + encryption + performance |

### Phase 0 Fixes
1. **Timezone bug (SLA/On-call)** — UTC_TIMESTAMP() in views
2. **Attachment counter** — Only count completed uploads
3. **XSS protection** — DOMPurify in TiptapReadOnly
4. **Custom field isolation** — List-scope validation

### Phase 1 Fixes
1. **Error codes** — Domain-specific error responses
2. **Form encryption** — AES-256-GCM + 90-day retention
3. **ARIA labels** — Accessibility compliance
4. **Secure cookies** — HTTPS enforcement
5. **Rate limiting** — Invitation endpoint protection
6. **Bulk operations** — N+1 query optimization

---

## 🔧 Pre-Deployment Tasks

### 1. Environment Setup

Add to `.env` (or staging/production config):

```bash
# Encryption key (256-bit hex) — GENERATE YOUR OWN!
# Command: openssl rand -hex 32
ENCRYPTION_KEY=<your-generated-key-here>

# Optional: Force HTTPS cookies in staging (for HTTPS-only testing)
FORCE_SECURE=true  # (only if using HTTPS in dev/staging)
```

### 2. Database Migration

**Option A: Manual SQL** (recommended for production)
```bash
cd server
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME < src/db/migrations/0005_form_encryption.sql
```

**Option B: Drizzle CLI**
```bash
npm run db:migrate
```

**Verify migration:**
```sql
DESCRIBE form_submissions;  -- Should show encrypted_at, expires_at columns
SHOW INDEXES FROM form_submissions;  -- Should show idx_form_submissions_expires_at
```

### 3. Verify Schema Changes

Run this in your database:
```sql
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'form_submissions' 
AND COLUMN_NAME IN ('encrypted_at', 'expires_at')
ORDER BY ORDINAL_POSITION;
```

Expected output:
```
encrypted_at | timestamp | YES
expires_at   | timestamp | YES
```

---

## 🧪 Staging Deployment (1-2 hours)

### Phase 1: Code Deploy

```bash
# Backend
git pull origin main
npm install
npm run build
npm run test  # Quick verification

# Frontend
cd client && npm run build
cd ..
```

### Phase 2: Database & Config

1. Apply migration (see section 2 above)
2. Add `ENCRYPTION_KEY` to staging `.env`
3. Restart server: `npm run dev` or `systemctl restart task-management-server`

### Phase 3: Verification Tests

**API Tests (curl):**
```bash
# Test error codes (P1-01)
curl -X POST http://staging-api/api/v1/tasks/invalid-id/custom-field-values \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customFieldId":"x","value":"y"}'
# Should return: {"error":{"code":"custom_field.not_found",...}}

# Test rate limiting (P1-06)
for i in {1..10}; do 
  curl -X GET http://staging-api/api/v1/auth/invitation/invalid-token
done
# Requests 6-10 should get 429 auth.rate_limited

# Test form encryption (P1-02)
curl -X POST http://staging-api/public/forms/test-form/submit \
  -d '{"data":{"name":"Test","email":"test@example.com"}}'
# Should return 201 with submission_id
```

**Database Verification:**
```sql
-- Verify form submission encryption (P1-02)
SELECT id, encrypted_at, expires_at, data 
FROM form_submissions 
LIMIT 1;
-- encrypted_at should be NOT NULL
-- expires_at should be ~90 days in future
-- data should be encrypted JSON (not readable plaintext)

-- Test background job (P1-02)
-- Manual dry-run: curl -X GET http://staging-api/api/v1/jobs/form-submission-expiry?dry_run=true
-- Should return: {"ok":true,"processed":0,"wouldDelete":0}
```

**Browser Tests (Playwright):**
```bash
cd client
npm run test:e2e  # Run Playwright E2E suite
# Should verify:
# - ARIA labels present (P1-03)
# - No XSS (P1-03)
# - Secure cookie flags set (P1-04)
```

### Phase 4: Staging Sign-Off Checklist

- [ ] Migration applied successfully
- [ ] ENCRYPTION_KEY configured
- [ ] Server restarts without errors
- [ ] Error codes return domain-specific values (P1-01)
- [ ] Form submission works + data encrypted (P1-02)
- [ ] Rate limit on invitation endpoint (P1-06)
- [ ] Bulk update queries optimized (P1-07)
- [ ] ARIA labels present (P1-03)
- [ ] Browser E2E tests pass
- [ ] No regressions in core flows (login, create task, list tasks)

---

## 🚀 Production Deployment (30 mins)

### Pre-Deployment

```bash
# Backup database
mysqldump -h $PROD_HOST -u $PROD_USER -p $PROD_PASS $PROD_DB > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify production matches staging
git log --oneline | head -20  # Confirm commits present
npm run test -- --testPathPattern=bulk --runInBand  # Quick smoke test
```

### Deployment Steps

**1. Stop server (if using systemctl)**
```bash
systemctl stop task-management-server
```

**2. Pull code**
```bash
git pull origin main
npm install
npm run build
```

**3. Migrate database**
```bash
mysql -h $PROD_HOST -u $PROD_USER -p$PROD_PASS $PROD_DB < src/db/migrations/0005_form_encryption.sql
```

**4. Set environment**
```bash
# Update production .env
export ENCRYPTION_KEY=<your-production-key>
# ... other vars ...
```

**5. Start server**
```bash
systemctl start task-management-server
# or: npm run start
```

**6. Verify**
```bash
# Health check
curl http://localhost:5501/api/v1/health
# Should return: {"status":"ok"}

# Smoke test
curl -X GET http://localhost:5501/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN"
# Should return task list (200)
```

### Post-Deployment Monitoring (30 mins)

**Log monitoring:**
```bash
tail -f /var/log/task-management-server.log
# Watch for errors: auth.token_config_missing, encryption errors, job failures
```

**Metrics to check:**
- Error rate (should be 0 spikes)
- Response times (should not increase)
- Form submissions (verify encryption happening)
- Job runs (form-submission-expiry should run daily)

**Rollback plan (if critical issue):**
```bash
systemctl stop task-management-server
git reset --hard HEAD~1  # Go back 1 commit
npm run build
systemctl start task-management-server
# Restore DB from backup if encryption caused data issues
mysql -h $PROD_HOST -u $PROD_USER -p $PROD_PASS $PROD_DB < backup_*.sql
```

---

## 📅 Background Job Setup

**form-submission-expiry** (daily cleanup of PII)

### Option 1: Cron Job
```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * curl -s -X GET "http://localhost:5501/api/v1/jobs/form-submission-expiry" \
  -H "X-Internal-Token: $INTERNAL_JOB_TOKEN" | logger -t form-expiry
```

### Option 2: Kubernetes CronJob
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: form-submission-expiry
spec:
  schedule: "0 2 * * *"  # Daily 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: job-runner
            image: task-management-server:latest
            command: ["npm", "run", "job", "form-submission-expiry"]
            env:
            - name: INTERNAL_JOB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: app-secrets
                  key: internal-job-token
          restartPolicy: OnFailure
```

### Option 3: Manual (for testing)
```bash
# Dry run (count, don't delete)
curl -X GET "http://localhost:5501/api/v1/jobs/form-submission-expiry?dry_run=true" \
  -H "X-Internal-Token: $INTERNAL_JOB_TOKEN"
# Response: {"ok":true,"dry_run":true,"processed":0,"wouldDelete":0}

# Actual run (deletes expired)
curl -X GET "http://localhost:5501/api/v1/jobs/form-submission-expiry" \
  -H "X-Internal-Token: $INTERNAL_JOB_TOKEN"
# Response: {"ok":true,"dry_run":false,"processed":0,"deleted":0}
```

---

## 🔐 Security Checklist

- [ ] ENCRYPTION_KEY is 256-bit hex (32 bytes)
- [ ] ENCRYPTION_KEY is NOT committed to git (in .env/secrets only)
- [ ] ENCRYPTION_KEY is unique per environment (prod ≠ staging ≠ dev)
- [ ] Cookies have `secure` flag in production (NODE_ENV=prod)
- [ ] HTTPS enforced in production (verify with curl -I)
- [ ] Rate limiter active on /auth/invitation/:token (5/min/IP)
- [ ] XSS protection active (DOMPurify in production build)
- [ ] Database backup taken before migration
- [ ] All error responses use domain-specific codes (no generic errors)

---

## 📞 Rollback Instructions

If issues occur during staging/production:

```bash
# Option 1: Code rollback only (if migration OK)
git revert <commit-hash>  # Most recent commit
npm run build
systemctl restart task-management-server

# Option 2: Full rollback (if migration failed)
git reset --hard HEAD~6  # Go back 6 commits (our work)
mysql -h $HOST -u $USER -p $PASS $DB < backup_*.sql
systemctl restart task-management-server

# Option 3: Remove new columns (if encryption causes issues)
ALTER TABLE form_submissions DROP COLUMN encrypted_at, DROP COLUMN expires_at;
ALTER TABLE form_submissions DROP INDEX idx_form_submissions_expires_at;
```

---

## 📊 Success Criteria

Deployment is successful when:

✅ Server starts without errors  
✅ All health checks pass (GET /api/v1/health → 200)  
✅ Form submissions can be created (POST /public/forms/:slug/submit → 201)  
✅ Form submission data is encrypted in database  
✅ API error codes match spec (domain-specific, not generic)  
✅ Rate limiter blocks invitation token brute force  
✅ Bulk operations run efficiently (verify SQL logs)  
✅ No security alerts in logs  
✅ Background job runs successfully (dry_run first)  
✅ ARIA labels present in frontend (accessibility audit)  

---

## 📞 Support

Issues during deployment? Check:

1. **Migration failed?**
   - Verify MySQL user has ALTER permissions
   - Check disk space: `df -h`
   - Verify column doesn't already exist: `DESCRIBE form_submissions`

2. **ENCRYPTION_KEY missing?**
   - Check .env file exists and contains ENCRYPTION_KEY
   - Verify format: 64 hex characters (256 bits)
   - Restart server after adding: `systemctl restart`

3. **Form submissions fail?**
   - Check server logs: `tail -f logs/app.log`
   - Verify encryptJSON isn't throwing: test locally first
   - Check ENCRYPTION_KEY is valid hex

4. **Background job not running?**
   - Verify cron/k8s schedule is set
   - Check INTERNAL_JOB_TOKEN is configured
   - Test manually: `curl /api/v1/jobs/form-submission-expiry?dry_run=true`

---

## ✅ Deployment Complete

Once staging sign-off complete and all checks pass:

```bash
# Tag production release
git tag -a v1.1.0-phase-0-1 -m "Phase 0+1: Critical + High-Priority Fixes"
git push origin v1.1.0-phase-0-1

# Update deployment log
echo "$(date): Deployed Phase 0+1 fixes to production" >> DEPLOYMENT_LOG.md
```

**Next:** Monitor production for 24 hours. Then Phase 2 (medium-priority issues).
