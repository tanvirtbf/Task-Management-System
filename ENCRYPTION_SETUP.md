# 🔐 ENCRYPTION_KEY Setup Guide

**Generated:** 2026-07-08  
**Purpose:** AES-256-GCM encryption for form submission PII  
**Retention:** 90 days auto-delete via background job

---

## 🔑 Your Generated Keys (KEEP SECURE!)

| Environment | ENCRYPTION_KEY | Status | Action |
|---|---|---|---|
| **Staging** | `0835496954420d93dc126b00821b67a24798dabf8cb7b39b9ed267bbef54e69c` | Ready | Use this |
| **Production** | `926ecd91f5bcf9f65b53cd641aeed7bed66e34af3a197c79176a76be279fc7a9` | Ready | Use this |
| **Development** | `b82f70ad2b6f62e066214c088e4c2cf5397d0d41033cad9da1fdb0eefc44d825` | Ready | Use this |

> ⚠️ **CRITICAL SECURITY RULES:**
> 1. Never commit these keys to git/GitHub
> 2. Never share these keys in Slack/email
> 3. Each environment MUST have different key
> 4. Store in `.env` file (gitignored) or secrets manager
> 5. Backup keys in secure password manager (1Password, Vault, etc.)

---

## 📋 Setup Checklist

- [ ] **Development** (.env.local or .env.development)
- [ ] **Staging** (.env.staging or secrets manager)
- [ ] **Production** (secrets manager ONLY, never .env file)
- [ ] Database migration applied (0005_form_encryption.sql)
- [ ] Background job configured (daily at 2 AM)
- [ ] Test encryption/decryption locally
- [ ] Verify backup keys in password manager

---

## 🖥️ DEVELOPMENT Setup (Local Machine)

### Option A: Using `.env.local` (Recommended for dev)

```bash
# 1. Create dev .env file (if not exists)
cat > server/.env.local << 'EOF'
# ... existing vars ...
ENCRYPTION_KEY=b82f70ad2b6f62e066214c088e4c2cf5397d0d41033cad9da1fdb0eefc44d825
EOF

# 2. Verify it's gitignored
grep ".env.local" server/.gitignore
# Should show: .env.local

# 3. Test encryption locally
npm run dev
# Watch logs: "ENCRYPTION_KEY loaded" or similar
```

### Option B: Using Environment Variable (for CI/local scripts)

```bash
# Set for this session only
export ENCRYPTION_KEY=b82f70ad2b6f62e066214c088e4c2cf5397d0d41033cad9da1fdb0eefc44d825

# Start server
npm run dev

# Verify in logs: no errors about missing ENCRYPTION_KEY
```

### Verify It Works

```bash
# 1. Create a test form submission
curl -X POST http://localhost:5173/api/v1/public/forms/test-form/submit \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"Test User","email":"test@example.com"}}'

# 2. Check database (data should be encrypted)
mysql> SELECT id, encrypted_at, SUBSTR(data, 1, 50) as data_preview 
       FROM form_submissions LIMIT 1;

# Expected:
# id           | encrypted_at        | data_preview
# fsub_xxx     | 2026-07-08 10:30:00 | {"ciphertext":"a7f8d...
```

---

## 🌐 STAGING Setup (Cloud/Server)

### Option A: Using Secrets Manager (AWS Secrets Manager, HashiCorp Vault, etc.)

**AWS Secrets Manager Example:**

```bash
# 1. Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name task-management/staging/encryption-key \
  --secret-string '{"ENCRYPTION_KEY":"0835496954420d93dc126b00821b67a24798dabf8cb7b39b9ed267bbef54e69c"}'

# 2. Update server startup script to fetch secret
cat > scripts/fetch-secrets.sh << 'EOF'
#!/bin/bash
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id task-management/staging/encryption-key \
  --query SecretString --output text)
export ENCRYPTION_KEY=$(echo $SECRET | jq -r .ENCRYPTION_KEY)
exec npm run start
EOF

# 3. Update systemd service
sudo systemctl edit task-management-server
# Add:
# [Service]
# ExecStart=/path/to/scripts/fetch-secrets.sh
```

**HashiCorp Vault Example:**

```bash
# 1. Store in Vault
vault kv put secret/staging/task-management \
  ENCRYPTION_KEY=0835496954420d93dc126b00821b67a24798dabf8cb7b39b9ed267bbef54e69c

# 2. Fetch at runtime
export ENCRYPTION_KEY=$(vault kv get -field=ENCRYPTION_KEY secret/staging/task-management)
npm run start
```

### Option B: Using Environment File (staging only, with restricted permissions)

```bash
# 1. Create secrets file with restricted permissions
sudo touch /etc/task-management/secrets.env
sudo chmod 600 /etc/task-management/secrets.env
sudo chown task-management:task-management /etc/task-management/secrets.env

# 2. Add content
sudo tee /etc/task-management/secrets.env > /dev/null << 'EOF'
ENCRYPTION_KEY=0835496954420d93dc126b00821b67a24798dabf8cb7b39b9ed267bbef54e69c
EOF

# 3. Update server startup
cat > /etc/systemd/system/task-management-server.service << 'EOF'
[Unit]
Description=Task Management Server
After=network.target

[Service]
Type=simple
User=task-management
EnvironmentFile=/etc/task-management/secrets.env
ExecStart=/usr/bin/npm run start
WorkingDirectory=/opt/task-management/server
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl restart task-management-server
```

### Verify Staging Setup

```bash
# 1. SSH to staging server
ssh user@staging-server

# 2. Verify key is loaded
curl http://localhost:5501/api/v1/health
# Should return 200 (not auth error about missing key)

# 3. Test form submission encryption
curl -X POST http://localhost:5501/api/v1/public/forms/test/submit \
  -d '{"data":{"email":"test@staging.example.com"}}'
# Should return 201

# 4. Check database
mysql -u staging_user -p staging_db -e \
  "SELECT id, encrypted_at FROM form_submissions LIMIT 1;"
# Should show encrypted_at = current timestamp
```

---

## 🔒 PRODUCTION Setup (Secrets Manager ONLY!)

### ⚠️ PRODUCTION RULES:
- **NEVER** use `.env` file in production
- **ALWAYS** use dedicated secrets manager
- **AUDIT** who has access to ENCRYPTION_KEY
- **ROTATE** keys annually (plan ahead for re-encryption)
- **BACKUP** keys in secure vault (encrypted)

### AWS Secrets Manager (Recommended for AWS)

```bash
# 1. Create secret (one-time, don't repeat!)
aws secretsmanager create-secret \
  --name prod/task-management/encryption-key \
  --secret-string '{"ENCRYPTION_KEY":"926ecd91f5bcf9f65b53cd641aeed7bed66e34af3a197c79176a76be279fc7a9"}' \
  --region us-east-1 \
  --tags Key=environment,Value=production

# 2. Restrict IAM access
cat > policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT:role/task-management-server"
      },
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:prod/task-management/*"
    }
  ]
}
EOF

aws secretsmanager put-resource-policy \
  --secret-id prod/task-management/encryption-key \
  --resource-policy file://policy.json

# 3. Server fetches on startup (via IAM role)
# Application code:
import boto3
sm = boto3.client('secretsmanager')
secret = sm.get_secret_value(SecretId='prod/task-management/encryption-key')
encryption_key = json.loads(secret['SecretString'])['ENCRYPTION_KEY']
```

### Kubernetes Secrets (For k8s deployments)

```bash
# 1. Create secret
kubectl create secret generic task-management-secrets \
  --from-literal=ENCRYPTION_KEY=926ecd91f5bcf9f65b53cd641aeed7bed66e34af3a197c79176a76be279fc7a9 \
  -n production

# 2. Reference in deployment
cat > deployment.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-management-server
spec:
  template:
    spec:
      containers:
      - name: server
        image: task-management:latest
        env:
        - name: ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: task-management-secrets
              key: ENCRYPTION_KEY
        - name: NODE_ENV
          value: "production"
EOF

kubectl apply -f deployment.yaml
```

### HashiCorp Vault (Enterprise-grade)

```bash
# 1. Store secret
vault kv put secret/prod/task-management \
  ENCRYPTION_KEY=926ecd91f5bcf9f65b53cd641aeed7bed66e34af3a197c79176a76be279fc7a9

# 2. Configure AppRole authentication (for server to fetch)
vault write auth/approle/role/task-management-server \
  token_ttl=1h \
  token_max_ttl=4h \
  policies="task-management"

# 3. Server authenticates and fetches
ROLE_ID=$(vault read auth/approle/role/task-management-server/role-id -field=role_id)
SECRET_ID=$(vault write -f auth/approle/role/task-management-server/secret-id -field=secret_id)

LOGIN=$(vault write -field=client_token auth/approle/login \
  role_id=$ROLE_ID secret_id=$SECRET_ID)

ENCRYPTION_KEY=$(vault kv get -field=ENCRYPTION_KEY secret/prod/task-management \
  -header-request-id=$LOGIN)
```

---

## 📦 Database Migration Script

After ENCRYPTION_KEY is configured, apply migration:

```bash
#!/bin/bash
# deploy-migration.sh

set -e

echo "🔐 Deploying Form Encryption Migration..."

# Verify ENCRYPTION_KEY is set
if [ -z "$ENCRYPTION_KEY" ]; then
  echo "❌ ERROR: ENCRYPTION_KEY not set!"
  exit 1
fi

if [ ${#ENCRYPTION_KEY} -ne 64 ]; then
  echo "❌ ERROR: ENCRYPTION_KEY must be 64 hex chars (256 bits), got ${#ENCRYPTION_KEY}"
  exit 1
fi

echo "✅ ENCRYPTION_KEY verified (256-bit hex)"

# Connect to database
echo "🔄 Applying migration 0005_form_encryption.sql..."

mysql \
  -h "${DB_HOST:-localhost}" \
  -u "${DB_USERNAME:-root}" \
  -p"${DB_PASSWORD}" \
  "${DB_NAME}" \
  < server/src/db/migrations/0005_form_encryption.sql

echo "✅ Migration applied successfully"

# Verify migration
echo "🔍 Verifying migration..."

COLUMNS=$(mysql \
  -h "${DB_HOST:-localhost}" \
  -u "${DB_USERNAME:-root}" \
  -p"${DB_PASSWORD}" \
  -N \
  -e "SELECT GROUP_CONCAT(COLUMN_NAME) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='form_submissions' AND COLUMN_NAME IN ('encrypted_at','expires_at')" \
  "${DB_NAME}")

if [[ "$COLUMNS" == *"encrypted_at"* ]] && [[ "$COLUMNS" == *"expires_at"* ]]; then
  echo "✅ Columns verified: encrypted_at, expires_at present"
else
  echo "❌ ERROR: Columns not found after migration!"
  exit 1
fi

echo "🎉 Migration complete! Ready to deploy."
```

Run it:
```bash
chmod +x deploy-migration.sh
./deploy-migration.sh
```

---

## 🧪 Local Testing (Before Deployment)

Test encryption/decryption locally to verify setup:

```bash
# 1. Start server with encryption key set
export ENCRYPTION_KEY=b82f70ad2b6f62e066214c088e4c2cf5397d0d41033cad9da1fdb0eefc44d825
npm run dev

# 2. Create a test form submission
curl -X POST http://localhost:5501/api/v1/public/forms/test-form-slug/submit \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "name": "Test User",
      "email": "test@example.com",
      "message": "This is sensitive PII that should be encrypted"
    }
  }'

# Expected response:
# {"submission_id":"fsub_xxx","task_id":"tsk_yyy","message":"Thank you"}

# 3. Check database (data should be encrypted)
mysql -u root -p -e "
SELECT 
  id,
  encrypted_at,
  expires_at,
  SUBSTR(CAST(data AS CHAR), 1, 80) as encrypted_preview
FROM form_submissions
WHERE id LIKE 'fsub_%'
LIMIT 1;
"

# Expected output:
# id        | encrypted_at        | expires_at          | encrypted_preview
# fsub_abc  | 2026-07-08 10:30:00 | 2026-10-06 10:30:00 | {"ciphertext":"a7f8d9...

# 4. Test background job (dry run - no deletion)
curl -X GET "http://localhost:5501/api/v1/jobs/form-submission-expiry?dry_run=true" \
  -H "X-Internal-Token: test-token"

# Expected response:
# {"ok":true,"dry_run":true,"processed":0,"wouldDelete":0}
```

---

## 🔄 Key Rotation (Future - Yearly)

If you need to rotate keys (e.g., after 1 year):

```bash
# 1. Generate new key
NEW_KEY=$(openssl rand -hex 32)
echo "New key: $NEW_KEY"

# 2. Update in secrets manager (keep old key temporarily)
aws secretsmanager update-secret \
  --secret-id prod/task-management/encryption-key \
  --secret-string "{\"ENCRYPTION_KEY\":\"$NEW_KEY\",\"OLD_ENCRYPTION_KEY\":\"old_key_here\"}"

# 3. Deploy server (reads new key by default)
# Server automatically uses ENCRYPTION_KEY for new submissions

# 4. After 90 days, all old submissions auto-deleted
# (No manual re-encryption needed!)

# 5. Remove old key from secrets manager
aws secretsmanager update-secret \
  --secret-id prod/task-management/encryption-key \
  --secret-string "{\"ENCRYPTION_KEY\":\"$NEW_KEY\"}"
```

---

## ✅ Final Verification Checklist

Before deploying to staging/production:

- [ ] ENCRYPTION_KEY is 64 hex characters (256 bits)
- [ ] ENCRYPTION_KEY stored in `.env` OR secrets manager (NOT committed to git)
- [ ] `.env` file is in `.gitignore` (verify: `git status`)
- [ ] Database migration script downloaded: `0005_form_encryption.sql`
- [ ] Tested locally: created form submission, verified encryption in DB
- [ ] Background job schedule ready (cron/k8s/manual)
- [ ] ENCRYPTION_KEY backed up in password manager (encrypted)
- [ ] Each environment has DIFFERENT key
- [ ] Production uses secrets manager ONLY (no .env file)

---

## 📞 Troubleshooting

**Problem: "ENCRYPTION_KEY not found" error**
```
Solution: Verify .env file exists and contains ENCRYPTION_KEY=...
          Or export ENCRYPTION_KEY=<value> before npm run dev
```

**Problem: "Invalid encryption key length"**
```
Solution: Key must be exactly 64 hex characters (256 bits)
          Run: openssl rand -hex 32
          Verify: echo $ENCRYPTION_KEY | wc -c  # Should be 65 (64 + newline)
```

**Problem: "Decryption failed: Authentication tag failed"**
```
Solution: Wrong ENCRYPTION_KEY used (key mismatch)
          This happens if key changed but old submissions still use old key
          Solution: Submissions auto-delete after 90 days
                   Or manually delete old submissions:
                   DELETE FROM form_submissions WHERE expires_at < NOW();
```

**Problem: "Background job not running"**
```
Solution: Verify cron job is set:
          crontab -l | grep form-submission
          Or check k8s CronJob:
          kubectl get cronjobs -n production
```

---

## 🎯 You're Ready!

Once setup complete, proceed to: **DEPLOYMENT_GUIDE.md**

Questions? Check:
1. Local test works (form submission encrypted)
2. ENCRYPTION_KEY is stored securely (not in git)
3. Migration script ready (0005_form_encryption.sql)
4. Background job schedule configured
