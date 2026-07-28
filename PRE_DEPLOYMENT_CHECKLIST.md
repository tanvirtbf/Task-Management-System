# ✅ PRE-DEPLOYMENT CHECKLIST — Phase 0 + Phase 1

**Status:** Ready for deployment  
**Date:** 2026-07-08  
**Target:** Staging → Production  

---

## 📋 Documentation Ready

- [x] `ENCRYPTION_KEYS.txt` — Quick reference (this file)
- [x] `ENCRYPTION_SETUP.md` — Detailed setup per environment
- [x] `DEPLOYMENT_GUIDE.md` — Full deployment procedure
- [x] Database migration: `server/src/db/migrations/0005_form_encryption.sql`
- [x] Background job: `server/src/jobs/formSubmissionExpiry.ts`

---

## 🔐 ENCRYPTION_KEY Setup

### Development (Local)

```bash
# 1. Add to server/.env.local
echo "ENCRYPTION_KEY=REPLACE_WITH_YOUR_OWN_64_HEX_KEY" >> server/.env.local

# 2. Verify it's gitignored
grep ".env.local" server/.gitignore  # Should exist

# 3. Test locally
npm run dev
# Watch for: no "ENCRYPTION_KEY" errors in logs
```

**Verify:**
```bash
curl http://localhost:5501/api/v1/health
# Should return: {"status":"ok"}
```

### Staging (Cloud)

**Using AWS Secrets Manager:**

```bash
# 1. Create secret
aws secretsmanager create-secret \
  --name task-management/staging/encryption-key \
  --secret-string '{"ENCRYPTION_KEY":"REPLACE_WITH_YOUR_OWN_64_HEX_KEY"}' \
  --region us-east-1

# 2. Verify
aws secretsmanager get-secret-value \
  --secret-id task-management/staging/encryption-key
```

**Using environment file:**

```bash
# 1. Create secrets file (restricted permissions)
sudo tee /etc/task-management/staging-secrets.env > /dev/null << 'EOF'
ENCRYPTION_KEY=REPLACE_WITH_YOUR_OWN_64_HEX_KEY
EOF

# 2. Restrict permissions
sudo chmod 600 /etc/task-management/staging-secrets.env
sudo chown task-management:task-management /etc/task-management/staging-secrets.env

# 3. Update systemd service
sudo systemctl edit task-management-server
# Add under [Service]:
# EnvironmentFile=/etc/task-management/staging-secrets.env
```

### Production (Live)

**Using AWS Secrets Manager (Recommended):**

```bash
# 1. Create secret
aws secretsmanager create-secret \
  --name prod/task-management/encryption-key \
  --secret-string '{"ENCRYPTION_KEY":"REPLACE_WITH_YOUR_OWN_64_HEX_KEY"}' \
  --region us-east-1

# 2. Restrict IAM access (see ENCRYPTION_SETUP.md)
# 3. Verify only task-management-server IAM role can access
```

**Using Kubernetes Secrets:**

```bash
# 1. Create secret
kubectl create secret generic task-management-secrets \
  --from-literal=ENCRYPTION_KEY=REPLACE_WITH_YOUR_OWN_64_HEX_KEY \
  -n production

# 2. Reference in deployment.yaml
# env:
# - name: ENCRYPTION_KEY
#   valueFrom:
#     secretKeyRef:
#       name: task-management-secrets
#       key: ENCRYPTION_KEY
```

---

## 🗄️ Database Migration

### Before Migration

```bash
# 1. Backup database
mysqldump -h $DB_HOST -u $DB_USER -p $DB_PASS $DB_NAME > backup_$(date +%Y%m%d).sql

# 2. Verify backup
ls -lh backup_*.sql

# 3. Verify you can restore
mysql -h $DB_HOST -u $DB_USER -p $DB_PASS < backup_*.sql  # Quick test, then restore

# 4. Check current schema (before migration)
mysql -h $DB_HOST -u $DB_USER -p $DB_PASS $DB_NAME -e "DESCRIBE form_submissions;" | grep -E "encrypted_at|expires_at"
# Should return empty (columns don't exist yet)
```

### Apply Migration

```bash
# Run migration
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME < server/src/db/migrations/0005_form_encryption.sql
```

### After Migration

```bash
# Verify columns exist
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME -e "
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME='form_submissions' 
  AND COLUMN_NAME IN ('encrypted_at', 'expires_at')
ORDER BY ORDINAL_POSITION;"

# Expected output:
# COLUMN_NAME   | COLUMN_TYPE | IS_NULLABLE
# encrypted_at  | timestamp   | YES
# expires_at    | timestamp   | YES

# Verify index exists
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME -e "
SHOW INDEXES FROM form_submissions WHERE Column_name='expires_at';"

# Expected output:
# Table             | Non_unique | Key_name                          | Column_name
# form_submissions  | 1          | idx_form_submissions_expires_at   | expires_at
```

---

## 🚀 Deployment Workflow

### Phase 1: Code Deploy

```bash
# Pull latest code
git pull origin main

# Verify latest commits
git log --oneline | head -10

# Install dependencies
npm install

# Build
npm run build

# Quick smoke test
npx jest --config jest.tasks.config.cjs tests/tasks/bulk.test.ts --testNamePattern="bulk-sets" --runInBand
```

### Phase 2: Database Migrate

```bash
# Apply migration (see section above)
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME < server/src/db/migrations/0005_form_encryption.sql

# Verify migration succeeded
# Run verify commands from "After Migration" section
```

### Phase 3: Configure Secrets

```bash
# Development: Add to .env.local
echo "ENCRYPTION_KEY=REPLACE_WITH_YOUR_OWN_64_HEX_KEY" >> server/.env.local

# Staging: Add to secrets manager or env file
# (See setup sections above)

# Production: Add to secrets manager
# (See setup sections above, AWS/Vault/k8s)
```

### Phase 4: Start/Restart Server

```bash
# Local development
npm run dev

# Staging (systemd)
sudo systemctl restart task-management-server

# Production (systemd)
sudo systemctl restart task-management-server

# Verify startup
curl http://localhost:5501/api/v1/health
# Should return: {"status":"ok"} (not error about missing ENCRYPTION_KEY)
```

### Phase 5: Test Encryption

```bash
# Create test form submission
curl -X POST http://localhost:5501/api/v1/public/forms/test-form-slug/submit \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "name": "Test User",
      "email": "test@example.com"
    }
  }'

# Expected response:
# {"submission_id":"fsub_xxx","task_id":"tsk_yyy","message":"Thank you"}

# Verify encryption in database
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME -e "
SELECT 
  id,
  encrypted_at,
  expires_at,
  SUBSTR(CAST(data AS CHAR), 1, 60) as encrypted_preview
FROM form_submissions
WHERE id LIKE 'fsub_%'
ORDER BY submitted_at DESC
LIMIT 1;"

# Expected:
# - encrypted_at = NOT NULL (current timestamp)
# - expires_at = ~90 days from now
# - data = starts with {"ciphertext":"... (encrypted JSON)
```

### Phase 6: Background Job Setup

```bash
# Option 1: Cron (Linux)
crontab -e
# Add line:
# 0 2 * * * curl -s http://localhost:5501/api/v1/jobs/form-submission-expiry -H "X-Internal-Token: $TOKEN"

# Option 2: Kubernetes
kubectl apply -f - << 'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: form-submission-expiry
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: job
            image: task-management:latest
            command: ["npm", "run", "job", "form-submission-expiry"]
          restartPolicy: OnFailure
EOF

# Verify job schedule
crontab -l | grep form-submission
# or
kubectl get cronjobs -n production

# Test dry-run (count, don't delete)
curl http://localhost:5501/api/v1/jobs/form-submission-expiry?dry_run=true \
  -H "X-Internal-Token: $INTERNAL_JOB_TOKEN"

# Expected: {"ok":true,"dry_run":true,"processed":0,"wouldDelete":0}
```

---

## ✅ Staging Sign-Off

Before promoting to production, verify all:

- [ ] Code deployed successfully (git pull, npm run build)
- [ ] Database migration applied (DESCRIBE, SHOW INDEXES)
- [ ] ENCRYPTION_KEY configured (curl /health returns 200)
- [ ] Form submission test works (201 response)
- [ ] Data is encrypted in DB (data starts with {"ciphertext")
- [ ] encrypted_at is NOT NULL (shows current timestamp)
- [ ] expires_at is ~90 days in future
- [ ] Background job configured (cron or k8s)
- [ ] Background job dry-run works (curl ?dry_run=true)
- [ ] Error codes are domain-specific (P1-01)
- [ ] ARIA labels present (P1-03)
- [ ] Bulk operations work (P1-07)
- [ ] No new errors in logs (20 mins monitoring)

---

## 🚀 Production Deployment

**Checklist before hitting "deploy":**

- [ ] Staging sign-off complete (all 14 items above)
- [ ] Production ENCRYPTION_KEY generated and stored securely
- [ ] Production DB backup taken
- [ ] Production ENCRYPTION_KEY is in secrets manager (NOT .env!)
- [ ] IAM/Vault policies restrict access
- [ ] Rollback plan tested (can restore from backup)
- [ ] Change management ticket created (if required)
- [ ] On-call engineer notified
- [ ] Maintenance window scheduled (if needed)
- [ ] Communication sent to ops/infra teams

**Deployment command:**

```bash
# 1. SSH to production
ssh ops@prod-server

# 2. Verify ENCRYPTION_KEY is loaded
curl http://localhost:5501/api/v1/health
# Should return 200 (not 500 about missing key)

# 3. Apply migration
mysql -h $PROD_DB_HOST -u $PROD_USER -p < 0005_form_encryption.sql

# 4. Verify migration
mysql -h $PROD_DB_HOST -u $PROD_USER -p $PROD_DB -e "DESCRIBE form_submissions;" | grep -E "encrypted_at|expires_at"

# 5. Restart server
sudo systemctl restart task-management-server

# 6. Verify startup
sleep 5
curl http://localhost:5501/api/v1/health
```

---

## 📊 Post-Deployment Monitoring (30 mins)

```bash
# 1. Monitor logs
tail -f /var/log/task-management-server.log

# Watch for:
# ❌ "ENCRYPTION_KEY not found" — key not configured
# ❌ "Authentication tag failed" — wrong key
# ✅ Form submissions creating successfully
# ✅ No unexpected errors

# 2. Check metrics
# - Error rate should be 0 (no spike)
# - Response times normal
# - Database connections stable

# 3. Test form submission (one more time)
curl -X POST http://prod/api/v1/public/forms/test/submit \
  -d '{"data":{"email":"monitoring@test.com"}}'
# Should return 201

# 4. Verify encryption
mysql -h $PROD_DB_HOST -u $PROD_USER -p $PROD_DB -e \
  "SELECT COUNT(*) as encrypted_count FROM form_submissions WHERE encrypted_at IS NOT NULL;"
# Should show: 1+ (your test submission)
```

---

## 🔄 Rollback Plan (If Issues)

```bash
# 1. Check logs for root cause
tail -100 /var/log/task-management-server.log | grep -i error

# 2. If ENCRYPTION_KEY issue:
# - Verify key in secrets manager
# - Restart server: sudo systemctl restart task-management-server

# 3. If migration issue:
# - Restore database from backup
# mysql -h $PROD_HOST -u $USER -p < backup_production.sql

# 4. If code issue:
# - Revert to previous commit
# git reset --hard HEAD~6
# npm run build
# sudo systemctl restart

# 5. Notify team
# Post in #operations: "Production rollback completed, investigating root cause"
```

---

## 📞 Support

**Before contacting support:**

1. Check logs: `tail -f /var/log/task-management-server.log | grep -i error`
2. Verify ENCRYPTION_KEY: `echo $ENCRYPTION_KEY | wc -c` (should be 65)
3. Test migration: `mysql -e "DESCRIBE form_submissions;" | grep encrypted`
4. Test backup restore works (don't deploy without this!)

**If still stuck:**

See detailed troubleshooting in: `ENCRYPTION_SETUP.md`

---

## ✨ Success Criteria

Deployment is successful when ✅ all true:

- Server starts without errors
- Health endpoint returns 200
- Form submissions can be created (201)
- Form submission data is encrypted in database
- encrypted_at timestamp is NOT NULL
- expires_at timestamp is ~90 days in future
- Background job runs (curl /jobs/form-submission-expiry?dry_run=true → 200)
- Error codes are domain-specific (API test)
- ARIA labels present (browser check)
- No new errors in logs (30 min monitoring)
- Team confirms no user-visible issues

---

**Ready? Start with documentation review, then follow phases above.**

**Questions?** Read `ENCRYPTION_SETUP.md` → `DEPLOYMENT_GUIDE.md`
