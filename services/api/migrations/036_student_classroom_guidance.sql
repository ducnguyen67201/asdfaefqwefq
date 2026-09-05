CREATE TABLE IF NOT EXISTS knowledge_classroom_guidance_starts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 broadcast_id UUID NOT NULL REFERENCES knowledge_class_session_broadcasts(id) ON DELETE RESTRICT,
 session_id UUID NOT NULL REFERENCES knowledge_class_sessions(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 anchor_attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
 attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
 activity_version_id UUID NOT NULL REFERENCES knowledge_activity_versions(id) ON DELETE RESTRICT,
 client_start_id UUID NOT NULL, task_id UUID NOT NULL, client_instance_id UUID NOT NULL,
 context_mode TEXT NOT NULL CHECK (context_mode IN ('screen_if_permitted','text_only')),
 work_session_id UUID NOT NULL UNIQUE REFERENCES knowledge_activity_work_sessions(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','active','finished','cancelled','failed','interrupted','unknown')),
 revision BIGINT NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
 reason TEXT CHECK (reason IN ('student_stop','session_ended','access_changed','expired','model_unavailable','budget_exhausted','network_unavailable','device_busy','restart','outcome_unknown','runtime_failed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(broadcast_id,user_id), UNIQUE(user_id,client_start_id)
);
CREATE INDEX classroom_guidance_summary_idx ON knowledge_classroom_guidance_starts(broadcast_id,status);
