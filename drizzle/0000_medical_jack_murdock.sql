CREATE TYPE "public"."assessment_status" AS ENUM('IN_PROGRESS', 'SUBMITTED', 'SCORED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."auditor_role" AS ENUM('auditor', 'auditor_admin', 'sysadmin');--> statement-breakpoint
CREATE TYPE "public"."employee_band" AS ENUM('1_9', '10_49', '50_99', '100_499', '500_999', '1000_plus');--> statement-breakpoint
CREATE TYPE "public"."industry" AS ENUM('manufacturing', 'retail_ecommerce', 'fnb', 'logistics', 'financial_services', 'healthcare', 'education', 'professional_services', 'construction_property', 'agriculture', 'media_creative', 'technology', 'government_public', 'other');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('SENT', 'OPENED', 'IN_PROGRESS', 'SUBMITTED', 'SCORED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."revenue_band" AS ENUM('under_2_5b', '2_5b_15b', '15b_50b', '50b_250b', '250b_plus', 'undisclosed');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_code" text NOT NULL,
	"value" jsonb NOT NULL,
	"evidence_url" text,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "assessment_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"questionnaire_version" text NOT NULL,
	"rubric_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"server_revision" integer DEFAULT 0 NOT NULL,
	"score_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"company_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"meta" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "auditor_role" DEFAULT 'auditor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_auditor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"industry" "industry" NOT NULL,
	"employee_band" "employee_band" NOT NULL,
	"revenue_band" "revenue_band",
	"country" text DEFAULT 'ID' NOT NULL,
	"province" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"status" "invitation_status" DEFAULT 'SENT' NOT NULL,
	"recipient_name" text,
	"recipient_email" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_auditor_id_auditors_id_fk" FOREIGN KEY ("owner_auditor_id") REFERENCES "public"."auditors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_assessment_question_key" ON "answers" USING btree ("assessment_id","question_code");--> statement-breakpoint
CREATE INDEX "assessments_company_idx" ON "assessments" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_company_idx" ON "audit_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auditors_email_key" ON "auditors" USING btree ("email");--> statement-breakpoint
CREATE INDEX "companies_owner_idx" ON "companies" USING btree ("owner_auditor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_company_idx" ON "invitations" USING btree ("company_id","status");