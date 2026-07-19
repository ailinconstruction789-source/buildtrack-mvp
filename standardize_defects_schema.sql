-- ==============================================================================
-- Standardize Defect Schema Columns
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS(SELECT *
    FROM information_schema.columns
    WHERE table_name='defects' and column_name='task_template_id')
  THEN
      ALTER TABLE "public"."defects" RENAME COLUMN "task_template_id" TO "task_id";
  END IF;
END $$;
