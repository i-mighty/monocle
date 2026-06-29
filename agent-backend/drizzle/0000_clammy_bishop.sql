CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"agent_id" text,
	"actor_id" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"action" text NOT NULL,
	"description" text NOT NULL,
	"metadata" text,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"audit_type" text NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"auditor_id" text,
	"auditor_name" text,
	"auditor_type" text DEFAULT 'system' NOT NULL,
	"summary" text,
	"details_json" text,
	"evidence_url" text,
	"certificate_hash" text,
	"valid_from" timestamp with time zone DEFAULT now(),
	"valid_until" timestamp with time zone,
	"score" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_behavior_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"window_type" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_lamports" bigint DEFAULT 0 NOT NULL,
	"unique_callers" integer DEFAULT 0 NOT NULL,
	"unique_callees" integer DEFAULT 0 NOT NULL,
	"avg_tokens_per_call" integer,
	"max_tokens_in_call" integer,
	"avg_cost_per_call" bigint,
	"settlements_attempted" integer DEFAULT 0 NOT NULL,
	"settlements_failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_agent_id" text NOT NULL,
	"blocked_agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"capability" text NOT NULL,
	"proficiency_level" text DEFAULT 'intermediate' NOT NULL,
	"is_verified" text DEFAULT 'false' NOT NULL,
	"verified_at" timestamp with time zone,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_compatibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_agent_id" text NOT NULL,
	"callee_agent_id" text NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"successful_calls" integer DEFAULT 0 NOT NULL,
	"failed_calls" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" integer,
	"p95_latency_ms" integer,
	"total_spent_lamports" bigint DEFAULT 0,
	"avg_cost_per_call" bigint,
	"compatibility_score" integer,
	"top_tools" text,
	"first_interaction" timestamp with time zone,
	"last_interaction" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_agent_id" text NOT NULL,
	"following_agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_version_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"change_type" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"changes_json" text,
	"changed_by" text,
	"change_reason" text,
	"is_breaking_change" text DEFAULT 'false' NOT NULL,
	"migration_notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text,
	"default_rate_per_1k_tokens" bigint DEFAULT 1000 NOT NULL,
	"balance_lamports" bigint DEFAULT 0 NOT NULL,
	"pending_lamports" bigint DEFAULT 0 NOT NULL,
	"max_cost_per_call" bigint,
	"daily_spend_cap" bigint,
	"is_paused" text DEFAULT 'false' NOT NULL,
	"allowed_callees" text,
	"reputation_score" integer DEFAULT 500 NOT NULL,
	"verified_status" text DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"bio" text,
	"website_url" text,
	"logo_url" text,
	"categories" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"owner_email" text,
	"support_url" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agents_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "anomaly_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"description" text NOT NULL,
	"detected_value" text,
	"expected_range" text,
	"confidence" integer DEFAULT 80 NOT NULL,
	"related_caller_id" text,
	"related_tool_name" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"actions_taken" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"developer_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "balance_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_agent_id" text NOT NULL,
	"callee_agent_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"estimated_tokens" integer NOT NULL,
	"reserved_lamports" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"actual_tokens" integer,
	"actual_cost_lamports" bigint,
	"captured_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiator_agent_id" text NOT NULL,
	"receiver_agent_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_message" text NOT NULL,
	"last_message_at" timestamp with time zone,
	"initiator_unread_count" integer DEFAULT 0 NOT NULL,
	"receiver_unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "execution_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_usage_id" uuid NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"recovery_action" text,
	"refund_issued" text DEFAULT 'false' NOT NULL,
	"refund_amount_lamports" bigint,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callee_agent_id" text NOT NULL,
	"caller_agent_id" text,
	"incident_type" text NOT NULL,
	"severity" text NOT NULL,
	"tool_name" text,
	"affected_call_count" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"root_cause" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"refunds_issued" integer DEFAULT 0 NOT NULL,
	"total_refund_lamports" bigint DEFAULT 0,
	"detected_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_agent_id" text NOT NULL,
	"content" text NOT NULL,
	"needs_human_input" text DEFAULT 'false' NOT NULL,
	"is_read" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "platform_revenue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"fee_lamports" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pricing_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_agent_id" text NOT NULL,
	"callee_agent_id" text NOT NULL,
	"tool_id" uuid,
	"tool_name" text NOT NULL,
	"estimated_tokens" integer NOT NULL,
	"rate_per_1k_tokens" bigint NOT NULL,
	"quoted_cost_lamports" bigint NOT NULL,
	"platform_fee_lamports" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"validity_ms" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_usage_id" uuid,
	"price_snapshot_json" text
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent_id" text NOT NULL,
	"to_agent_id" text NOT NULL,
	"gross_lamports" bigint NOT NULL,
	"platform_fee_lamports" bigint NOT NULL,
	"net_lamports" bigint NOT NULL,
	"tx_signature" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "settlements_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "tool_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_agent_id" text NOT NULL,
	"callee_agent_id" text NOT NULL,
	"tool_id" uuid,
	"tool_name" text NOT NULL,
	"tokens_used" integer NOT NULL,
	"rate_per_1k_tokens" bigint NOT NULL,
	"cost_lamports" bigint NOT NULL,
	"quote_id" uuid,
	"quoted_at" timestamp with time zone,
	"quote_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rate_per_1k_tokens" bigint NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"category" text,
	"input_schema" text,
	"output_schema" text,
	"examples_json" text,
	"avg_tokens_per_call" integer,
	"max_tokens_per_call" integer,
	"docs_url" text,
	"is_deprecated" text DEFAULT 'false' NOT NULL,
	"deprecation_message" text,
	"deprecated_at" timestamp with time zone,
	"total_calls" bigint DEFAULT 0 NOT NULL,
	"total_tokens_processed" bigint DEFAULT 0 NOT NULL,
	"last_called_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"response" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure" timestamp with time zone,
	"last_success" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_signature" text NOT NULL,
	"nonce" text NOT NULL,
	"payer_wallet" text NOT NULL,
	"recipient_wallet" text NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"resource_id" text,
	"execution_id" uuid,
	"verified_at" timestamp with time zone,
	"network" text DEFAULT 'solana-devnet' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "x402_payments_tx_signature_unique" UNIQUE("tx_signature"),
	CONSTRAINT "x402_payments_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audits" ADD CONSTRAINT "agent_audits_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_behavior_stats" ADD CONSTRAINT "agent_behavior_stats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_blocks" ADD CONSTRAINT "agent_blocks_blocker_agent_id_agents_id_fk" FOREIGN KEY ("blocker_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_blocks" ADD CONSTRAINT "agent_blocks_blocked_agent_id_agents_id_fk" FOREIGN KEY ("blocked_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_compatibility" ADD CONSTRAINT "agent_compatibility_caller_agent_id_agents_id_fk" FOREIGN KEY ("caller_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_compatibility" ADD CONSTRAINT "agent_compatibility_callee_agent_id_agents_id_fk" FOREIGN KEY ("callee_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_follows" ADD CONSTRAINT "agent_follows_follower_agent_id_agents_id_fk" FOREIGN KEY ("follower_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_follows" ADD CONSTRAINT "agent_follows_following_agent_id_agents_id_fk" FOREIGN KEY ("following_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version_history" ADD CONSTRAINT "agent_version_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_alerts" ADD CONSTRAINT "anomaly_alerts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_reservations" ADD CONSTRAINT "balance_reservations_caller_agent_id_agents_id_fk" FOREIGN KEY ("caller_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_initiator_agent_id_agents_id_fk" FOREIGN KEY ("initiator_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_receiver_agent_id_agents_id_fk" FOREIGN KEY ("receiver_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_tool_usage_id_tool_usage_id_fk" FOREIGN KEY ("tool_usage_id") REFERENCES "public"."tool_usage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_callee_agent_id_agents_id_fk" FOREIGN KEY ("callee_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_revenue" ADD CONSTRAINT "platform_revenue_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_quotes" ADD CONSTRAINT "pricing_quotes_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_usage" ADD CONSTRAINT "tool_usage_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_usage" ADD CONSTRAINT "tool_usage_quote_id_pricing_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."pricing_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_execution_id_tool_usage_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."tool_usage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_agent_id_idx" ON "activity_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "activity_logs_event_type_idx" ON "activity_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "activity_logs_severity_idx" ON "activity_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_actor_id_idx" ON "activity_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "activity_logs_resource_type_idx" ON "activity_logs" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX "agent_audits_agent_idx" ON "agent_audits" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_audits_type_idx" ON "agent_audits" USING btree ("audit_type");--> statement-breakpoint
CREATE INDEX "agent_audits_result_idx" ON "agent_audits" USING btree ("result");--> statement-breakpoint
CREATE INDEX "agent_audits_valid_until_idx" ON "agent_audits" USING btree ("valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_behavior_stats_unique" ON "agent_behavior_stats" USING btree ("agent_id","window_type","window_start");--> statement-breakpoint
CREATE INDEX "agent_behavior_stats_agent_idx" ON "agent_behavior_stats" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_behavior_stats_window_idx" ON "agent_behavior_stats" USING btree ("window_type","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_blocks_pair_unique" ON "agent_blocks" USING btree ("blocker_agent_id","blocked_agent_id");--> statement-breakpoint
CREATE INDEX "agent_blocks_blocker_idx" ON "agent_blocks" USING btree ("blocker_agent_id");--> statement-breakpoint
CREATE INDEX "agent_blocks_blocked_idx" ON "agent_blocks" USING btree ("blocked_agent_id");--> statement-breakpoint
CREATE INDEX "agent_capabilities_agent_idx" ON "agent_capabilities" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_capabilities_capability_idx" ON "agent_capabilities" USING btree ("capability");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_capabilities_unique" ON "agent_capabilities" USING btree ("agent_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_compatibility_pair_unique" ON "agent_compatibility" USING btree ("caller_agent_id","callee_agent_id");--> statement-breakpoint
CREATE INDEX "agent_compatibility_caller_idx" ON "agent_compatibility" USING btree ("caller_agent_id");--> statement-breakpoint
CREATE INDEX "agent_compatibility_callee_idx" ON "agent_compatibility" USING btree ("callee_agent_id");--> statement-breakpoint
CREATE INDEX "agent_compatibility_score_idx" ON "agent_compatibility" USING btree ("compatibility_score");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_follows_pair_unique" ON "agent_follows" USING btree ("follower_agent_id","following_agent_id");--> statement-breakpoint
CREATE INDEX "agent_follows_follower_idx" ON "agent_follows" USING btree ("follower_agent_id");--> statement-breakpoint
CREATE INDEX "agent_follows_following_idx" ON "agent_follows" USING btree ("following_agent_id");--> statement-breakpoint
CREATE INDEX "agent_version_history_agent_idx" ON "agent_version_history" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_version_history_version_idx" ON "agent_version_history" USING btree ("version");--> statement-breakpoint
CREATE INDEX "agent_version_history_type_idx" ON "agent_version_history" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "agent_version_history_created_idx" ON "agent_version_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "anomaly_alerts_agent_idx" ON "anomaly_alerts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "anomaly_alerts_type_idx" ON "anomaly_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "anomaly_alerts_severity_idx" ON "anomaly_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "anomaly_alerts_status_idx" ON "anomaly_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "anomaly_alerts_created_at_idx" ON "anomaly_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_keys_key_idx" ON "api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "balance_reservations_caller_idx" ON "balance_reservations" USING btree ("caller_agent_id");--> statement-breakpoint
CREATE INDEX "balance_reservations_status_idx" ON "balance_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "balance_reservations_expires_idx" ON "balance_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_agent_pair_unique" ON "conversations" USING btree ("initiator_agent_id","receiver_agent_id");--> statement-breakpoint
CREATE INDEX "conversations_initiator_idx" ON "conversations" USING btree ("initiator_agent_id");--> statement-breakpoint
CREATE INDEX "conversations_receiver_idx" ON "conversations" USING btree ("receiver_agent_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversations_last_message_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "execution_results_tool_usage_idx" ON "execution_results" USING btree ("tool_usage_id");--> statement-breakpoint
CREATE INDEX "execution_results_status_idx" ON "execution_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "execution_results_created_at_idx" ON "execution_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "incidents_callee_idx" ON "incidents" USING btree ("callee_agent_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_type_idx" ON "incidents" USING btree ("incident_type");--> statement-breakpoint
CREATE INDEX "incidents_created_at_idx" ON "incidents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_agent_id");--> statement-breakpoint
CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_revenue_settlement_idx" ON "platform_revenue" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "platform_revenue_created_at_idx" ON "platform_revenue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pricing_quotes_caller_idx" ON "pricing_quotes" USING btree ("caller_agent_id");--> statement-breakpoint
CREATE INDEX "pricing_quotes_callee_idx" ON "pricing_quotes" USING btree ("callee_agent_id");--> statement-breakpoint
CREATE INDEX "pricing_quotes_status_idx" ON "pricing_quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pricing_quotes_expires_idx" ON "pricing_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pricing_quotes_issued_at_idx" ON "pricing_quotes" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "settlements_from_agent_idx" ON "settlements" USING btree ("from_agent_id");--> statement-breakpoint
CREATE INDEX "settlements_to_agent_idx" ON "settlements" USING btree ("to_agent_id");--> statement-breakpoint
CREATE INDEX "settlements_status_idx" ON "settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "settlements_created_at_idx" ON "settlements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tool_usage_caller_idx" ON "tool_usage" USING btree ("caller_agent_id");--> statement-breakpoint
CREATE INDEX "tool_usage_callee_idx" ON "tool_usage" USING btree ("callee_agent_id");--> statement-breakpoint
CREATE INDEX "tool_usage_created_at_idx" ON "tool_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tool_usage_tool_id_idx" ON "tool_usage" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "tool_usage_quote_id_idx" ON "tool_usage" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tools_agent_tool_unique" ON "tools" USING btree ("agent_id","name");--> statement-breakpoint
CREATE INDEX "tools_agent_id_idx" ON "tools" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "tools_category_idx" ON "tools" USING btree ("category");--> statement-breakpoint
CREATE INDEX "tools_is_active_idx" ON "tools" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_type_idx" ON "webhook_deliveries" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhooks_agent_idx" ON "webhooks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "webhooks_active_idx" ON "webhooks" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "x402_payments_signature_idx" ON "x402_payments" USING btree ("tx_signature");--> statement-breakpoint
CREATE INDEX "x402_payments_nonce_idx" ON "x402_payments" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "x402_payments_payer_idx" ON "x402_payments" USING btree ("payer_wallet");--> statement-breakpoint
CREATE INDEX "x402_payments_created_at_idx" ON "x402_payments" USING btree ("created_at");