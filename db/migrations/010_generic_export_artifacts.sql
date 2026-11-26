ALTER TABLE export_artifacts RENAME COLUMN pdf_data TO file_data;
ALTER TABLE export_artifacts RENAME CONSTRAINT export_pdf_data_size TO export_file_data_size;
