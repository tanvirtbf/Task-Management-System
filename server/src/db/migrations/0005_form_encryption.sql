-- Add encryption support to form_submissions table
-- Stores encrypted_at and expires_at for PII retention policy

ALTER TABLE form_submissions
ADD COLUMN encrypted_at TIMESTAMP NULL DEFAULT NULL,
ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL;

-- Create index for deletion job (finds expired submissions)
CREATE INDEX idx_form_submissions_expires_at ON form_submissions(expires_at);
