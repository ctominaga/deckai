ALTER TABLE export_artifacts ADD COLUMN pdf_data bytea;
ALTER TABLE export_artifacts ADD CONSTRAINT export_pdf_data_size
  CHECK (pdf_data IS NULL OR (octet_length(pdf_data) = size_bytes AND size_bytes <= 10485760));
