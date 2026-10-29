CREATE SEQUENCE "public"."vsl_rotation_seq" INCREMENT BY 1 MINVALUE 0 MAXVALUE 9223372036854775807 START WITH 0 CACHE 1;--> statement-breakpoint
CREATE TABLE "Logs_de_VSL" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Logs_de_VSL_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ip" "inet",
	"accessed_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"video_name" text NOT NULL,
	"played_seconds" numeric(8, 3) NOT NULL,
	"duration_seconds" numeric(8, 3),
	"turn" integer,
	"exit_method" text NOT NULL,
	"device" text NOT NULL,
	"user_agent" text,
	CONSTRAINT "logs_de_vsl_exit_check" CHECK ("Logs_de_VSL"."exit_method" in ('click','escape','pagehide')),
	CONSTRAINT "logs_de_vsl_device_check" CHECK ("Logs_de_VSL"."device" in ('mobile','desktop')),
	CONSTRAINT "logs_de_vsl_played_check" CHECK ("Logs_de_VSL"."played_seconds" >= 0)
);
--> statement-breakpoint
CREATE INDEX "logs_de_vsl_accessed_at_idx" ON "Logs_de_VSL" USING btree ("accessed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "logs_de_vsl_video_idx" ON "Logs_de_VSL" USING btree ("video_name","accessed_at" DESC NULLS LAST);