ALTER TABLE model_budget_reservations
  DROP CONSTRAINT IF EXISTS model_budget_reservations_lane_check;
ALTER TABLE model_budget_reservations
  ADD CONSTRAINT model_budget_reservations_lane_check
  CHECK (lane IN ('responses', 'realtime_transcription', 'transcription', 'speech', 'image_generation'));

ALTER TABLE model_usage_events
  DROP CONSTRAINT IF EXISTS model_usage_events_lane_check;
ALTER TABLE model_usage_events
  ADD CONSTRAINT model_usage_events_lane_check
  CHECK (lane IN ('responses', 'realtime_transcription', 'transcription', 'speech', 'image_generation'));

ALTER TABLE model_usage_events
  ADD COLUMN IF NOT EXISTS input_text_tokens BIGINT NOT NULL DEFAULT 0
  CHECK (input_text_tokens >= 0),
  ADD COLUMN IF NOT EXISTS input_image_tokens BIGINT NOT NULL DEFAULT 0
  CHECK (input_image_tokens >= 0),
  ADD COLUMN IF NOT EXISTS output_image_tokens BIGINT NOT NULL DEFAULT 0
  CHECK (output_image_tokens >= 0);

COMMENT ON TABLE model_usage_events IS
  'Sanitized provider usage only: never store prompts, outputs, screenshots, images, filenames, or tool arguments.';
