-- Add source_type for multi-source (document | whatsapp)
ALTER TABLE chunks ADD COLUMN source_type text NOT NULL DEFAULT 'document';
CREATE INDEX chunks_source_type_idx ON chunks (source_type);

-- Page numbers for citations
ALTER TABLE chunks ADD COLUMN page_start integer NOT NULL DEFAULT 1;
ALTER TABLE chunks ADD COLUMN page_end integer NOT NULL DEFAULT 1;
CREATE INDEX chunks_page_idx ON chunks (page_start, page_end);