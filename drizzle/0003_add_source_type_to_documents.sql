-- Add source_type for documents table
ALTER TABLE documents ADD COLUMN source_type text NOT NULL DEFAULT 'document';