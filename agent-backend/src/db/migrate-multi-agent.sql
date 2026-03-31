-- ─────────────────────────────────────────────────────────────────────────────
-- Monocle Multi-Agent Schema Migration
-- Run: docker exec -i agentpay-db psql -U agentpay -d agentpay < migrate-multi-agent.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Orchestration sessions: one per user request that triggers multi-agent flow
CREATE TABLE IF NOT EXISTS orchestration_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  original_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','negotiating','executing','assembling','complete','failed')),
  task_plan JSONB,                        -- decomposed subtasks
  final_response TEXT,
  total_cost_lamports BIGINT DEFAULT 0,
  agent_count INTEGER DEFAULT 0,
  depth INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Agent messages: every message exchanged between agents (immutable log)
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  message_type TEXT NOT NULL
    CHECK (message_type IN (
      'task_assignment',   -- orchestrator assigns work
      'quote_request',     -- agent asks for price
      'quote_response',    -- agent replies with price + eta
      'acceptance',        -- price accepted, work begins
      'rejection',         -- price rejected (too high)
      'result',            -- agent delivers completed work
      'delegation',        -- agent sub-delegates to another
      'error'              -- agent reports failure
    )),
  content JSONB NOT NULL,               -- full message payload
  depth INTEGER NOT NULL DEFAULT 0,     -- 0=orchestrator, 1=specialist, 2=sub-specialist
  parent_message_id UUID REFERENCES agent_messages(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent negotiations: price negotiation records
CREATE TABLE IF NOT EXISTS agent_negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  requester_agent_id TEXT NOT NULL,
  provider_agent_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  quoted_lamports BIGINT NOT NULL,       -- what provider asked
  agreed_lamports BIGINT,               -- what was accepted (NULL if rejected)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','expired')),
  quote_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 seconds'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Orchestration subtasks: individual work items within a session
CREATE TABLE IF NOT EXISTS orchestration_subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  assigned_agent_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  task_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','negotiating','executing','complete','failed')),
  result TEXT,
  cost_lamports BIGINT DEFAULT 0,
  tx_signature TEXT,                    -- x402 payment tx
  depth INTEGER NOT NULL DEFAULT 1,
  parent_subtask_id UUID REFERENCES orchestration_subtasks(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast session lookups
CREATE INDEX IF NOT EXISTS idx_agent_messages_session
  ON agent_messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_orchestration_subtasks_session
  ON orchestration_subtasks(session_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_negotiations_session
  ON agent_negotiations(session_id, status);

-- ─── Seed specialist agents for multi-agent demo ─────────────────────────────
-- These agents participate in the negotiation + delegation flow

INSERT INTO agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
VALUES
  ('orchestrator-001',  'Monocle Orchestrator', 0,   10000000, 0),
  ('researcher-001',    'Research Agent',        200, 0,        0),
  ('writer-001',        'Writer Agent',          300, 0,        0),
  ('coder-001',         'Code Agent',            250, 0,        0),
  ('image-001',         'Image Agent',           350, 0,        0),
  ('factcheck-001',     'FactCheck Agent',       150, 0,        0),
  ('formatter-001',     'Formatter Agent',       100, 0,        0)
ON CONFLICT (id) DO UPDATE SET
  default_rate_per_1k_tokens = EXCLUDED.default_rate_per_1k_tokens;

-- Give the orchestrator balance to pay for delegated work
UPDATE agents SET balance_lamports = 10000000 WHERE id = 'orchestrator-001';

SELECT 'Migration complete.' as status;
SELECT id, name, default_rate_per_1k_tokens FROM agents ORDER BY created_at;
