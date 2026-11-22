-- LifeOS initial schema.
--
-- Conventions
--   * Every user-data row carries workspace_id. Authorization is "you can read a
--     row if you are a member of its workspace with a role that permits it, or
--     you hold an unexpired, unrevoked grant to it". Queries scope in SQL.
--   * Ids are application-generated, prefixed text (tsk_..., cap_...).
--   * Money is integer minor units + ISO 4217 currency. Never floats.
--   * A date the source did not state is NULL, never a guess. Date-only values
--     are `date`; instants are `timestamptz`; wall-clock times are `time` +
--     an IANA timezone so recurrence survives DST and timezone changes.

-- ============================================================ identity

CREATE TABLE users (
  id              text PRIMARY KEY,
  email           text NOT NULL,
  password_hash   text NOT NULL,
  display_name    text NOT NULL,
  locale          text NOT NULL DEFAULT 'en-IN',
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata',
  date_order      text NOT NULL DEFAULT 'DMY' CHECK (date_order IN ('DMY', 'MDY', 'YMD')),
  currency        text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  default_reminder_time time NOT NULL DEFAULT '09:00',
  quiet_hours_start time,
  quiet_hours_end   time,
  onboarding_goals text[] NOT NULL DEFAULT '{}',
  onboarded_at    timestamptz,
  is_minor        boolean NOT NULL DEFAULT false,
  mfa_totp_secret text,
  mfa_enabled_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id            text PRIMARY KEY,            -- sha256(token); the token itself is never stored
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  user_agent    text,
  mfa_pending   boolean NOT NULL DEFAULT false
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE api_tokens (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  scopes        text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE TABLE user_consents (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('product_analytics', 'external_ai_processing', 'email_notifications', 'push_notifications')),
  granted     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purpose)
);

CREATE TABLE rate_limit_buckets (
  key        text PRIMARY KEY,
  count      integer NOT NULL,
  reset_at   timestamptz NOT NULL
);

-- ============================================================ workspaces

CREATE TABLE workspaces (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('personal', 'family')),
  name        text NOT NULL,
  owner_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspaces_one_personal ON workspaces (owner_id) WHERE kind = 'personal';

CREATE TABLE memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'adult', 'member', 'limited')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE invitations (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL CHECK (role IN ('adult', 'member', 'limited')),
  token_hash    text NOT NULL UNIQUE,
  invited_by    text REFERENCES users(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   text REFERENCES users(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ capture

CREATE TABLE captures (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by        text REFERENCES users(id) ON DELETE SET NULL,
  client_id         text,          -- idempotency key from offline drafts / extension
  source_type       text NOT NULL CHECK (source_type IN ('text', 'note', 'paste', 'url', 'screenshot', 'image', 'pdf', 'receipt', 'file', 'voice', 'extension', 'share')),
  source_app        text,          -- e.g. 'browser-extension', 'pwa-share-target'
  title             text,
  text_content      text,
  url               text,
  url_title         text,
  source_date       date,          -- date the information was originally issued, if known
  status            text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'queued', 'processing', 'extracted', 'review_required', 'confirmed', 'organized', 'archived', 'failed')),
  error             text,
  extracted_text    text,
  extraction_engine text,
  extraction_note   text,
  content_sha256    text,
  tags              text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);
CREATE UNIQUE INDEX captures_client_id_key ON captures (workspace_id, created_by, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX captures_ws_status_idx ON captures (workspace_id, status, created_at DESC);
CREATE INDEX captures_ws_sha_idx ON captures (workspace_id, content_sha256);

CREATE TABLE capture_files (
  id             text PRIMARY KEY,
  capture_id     text NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  storage_key    text NOT NULL,
  original_name  text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
  sha256         text NOT NULL,
  extracted_text text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capture_files_ws_sha_idx ON capture_files (workspace_id, sha256);
CREATE INDEX capture_files_capture_idx ON capture_files (capture_id);

CREATE TABLE extraction_candidates (
  id                  text PRIMARY KEY,
  capture_id          text NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  workspace_id        text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('task', 'event', 'deadline', 'purchase', 'warranty', 'return_window', 'subscription', 'bill', 'promise', 'document', 'contact', 'reference')),
  title               text NOT NULL,
  fields              jsonb NOT NULL,
  evidence            jsonb NOT NULL,
  uncertain           jsonb NOT NULL DEFAULT '[]',
  provenance          jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  created_record_type text,
  created_record_id   text,
  reviewed_by         text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Invariant 1: nothing becomes accepted without a recorded human review.
  CONSTRAINT candidate_accept_needs_review CHECK (status <> 'accepted' OR (reviewed_at IS NOT NULL AND created_record_id IS NOT NULL))
);
CREATE INDEX candidates_capture_idx ON extraction_candidates (capture_id);
CREATE INDEX candidates_ws_status_idx ON extraction_candidates (workspace_id, status);

-- ============================================================ lifegraph

CREATE TABLE contacts (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'organization')),
  notes         text,
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_ws_name_idx ON contacts (workspace_id, lower(name));

CREATE TABLE life_links (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_type     text NOT NULL,
  from_id       text NOT NULL,
  to_type       text NOT NULL,
  to_id         text NOT NULL,
  relation      text NOT NULL,
  provenance    jsonb NOT NULL,
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT life_links_no_self CHECK (NOT (from_type = to_type AND from_id = to_id)),
  UNIQUE (from_type, from_id, to_type, to_id, relation)
);
CREATE INDEX life_links_from_idx ON life_links (from_type, from_id);
CREATE INDEX life_links_to_idx ON life_links (to_type, to_id);

CREATE TABLE record_history (
  id           bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  action       text NOT NULL,
  changes      jsonb NOT NULL DEFAULT '{}',
  actor_id     text REFERENCES users(id) ON DELETE SET NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX record_history_entity_idx ON record_history (entity_type, entity_id, at);

-- ============================================================ tasks

CREATE TABLE task_lists (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text,
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

CREATE TABLE tasks (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  list_id           text REFERENCES task_lists(id) ON DELETE SET NULL,
  parent_id         text REFERENCES tasks(id) ON DELETE CASCADE,
  series_id         text,              -- shared by all occurrences of a recurring task
  occurrence_date   date,              -- which occurrence of the series this row is
  kind              text NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'follow_up', 'refund_follow_up', 'deadline', 'family_task', 'admin_step', 'warranty_claim')),
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  notes             text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'completed', 'cancelled', 'skipped', 'archived')),
  priority          smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  category          text,
  tags              text[] NOT NULL DEFAULT '{}',
  due_date          date,
  due_time          time,              -- only when the source or user stated a time
  timezone          text NOT NULL DEFAULT 'Asia/Kolkata',
  start_date        date,
  estimate_minutes  integer CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
  waiting_on        text,
  waiting_since     date,
  recurrence        jsonb,
  -- Minutes relative to the due moment at which to remind, e.g. [-1440, 0].
  -- Kept on the task so every occurrence of a series gets the same reminders.
  reminder_offsets  integer[] NOT NULL DEFAULT '{}',
  assignee_id       text REFERENCES users(id) ON DELETE SET NULL,
  assignment_status text CHECK (assignment_status IN ('pending', 'accepted', 'declined')),
  completed_at      timestamptz,
  completed_by      text REFERENCES users(id) ON DELETE SET NULL,
  completion_note   text,
  cancelled_reason  text,
  source_capture_id text REFERENCES captures(id) ON DELETE SET NULL,
  client_id         text,              -- idempotency key for tasks drafted offline
  version           integer NOT NULL DEFAULT 1,
  created_by        text REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_time_needs_date CHECK (due_time IS NULL OR due_date IS NOT NULL),
  CONSTRAINT tasks_completed_consistent CHECK ((status <> 'completed' OR completed_at IS NOT NULL) AND (completed_at IS NULL OR status IN ('completed', 'archived'))),
  CONSTRAINT tasks_occurrence_consistent CHECK ((series_id IS NULL) = (occurrence_date IS NULL))
);
-- Invariant 5: one row per occurrence of a recurring series, whatever retries happen.
CREATE UNIQUE INDEX tasks_series_occurrence_key ON tasks (series_id, occurrence_date) WHERE series_id IS NOT NULL;
CREATE UNIQUE INDEX tasks_client_id_key ON tasks (workspace_id, created_by, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX tasks_ws_status_due_idx ON tasks (workspace_id, status, due_date);
CREATE INDEX tasks_parent_idx ON tasks (parent_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id) WHERE assignee_id IS NOT NULL;

CREATE TABLE task_dependencies (
  task_id        text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id  text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE checklist_items (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_type    text NOT NULL CHECK (owner_type IN ('task', 'admin_workflow', 'life_event', 'subscription', 'warranty')),
  owner_id      text NOT NULL,
  group_name    text NOT NULL DEFAULT '',
  kind          text NOT NULL DEFAULT 'item' CHECK (kind IN ('item', 'document', 'step')),
  label         text NOT NULL,
  note          text,
  position      integer NOT NULL DEFAULT 0,
  done          boolean NOT NULL DEFAULT false,
  done_at       timestamptz,
  done_by       text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_owner_idx ON checklist_items (owner_type, owner_id, position);

-- ============================================================ commitments

CREATE TABLE promises (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  direction         text NOT NULL CHECK (direction IN ('i_promised', 'they_promised', 'waiting_on')),
  description       text NOT NULL,
  counterparty      text,
  recorded_on       date NOT NULL,
  expected_by       date,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'not_fulfilled', 'cancelled')),
  notes             text,
  resolution_note   text,
  resolved_at       timestamptz,
  source_capture_id text REFERENCES captures(id) ON DELETE SET NULL,
  version           integer NOT NULL DEFAULT 1,
  created_by        text REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promises_ws_status_idx ON promises (workspace_id, status, expected_by);

-- ============================================================ calendar

CREATE TABLE calendar_imports (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  imported_count integer NOT NULL,
  updated_count  integer NOT NULL,
  skipped_count  integer NOT NULL,
  created_by     text REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text,
  location       text,
  kind           text NOT NULL DEFAULT 'appointment' CHECK (kind IN ('appointment', 'deadline', 'flexible', 'time_block')),
  all_day        boolean NOT NULL DEFAULT false,
  starts_at      timestamptz,
  ends_at        timestamptz,
  start_date     date,
  end_date       date,
  timezone       text NOT NULL DEFAULT 'Asia/Kolkata',
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  recurrence     jsonb,
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ics', 'capture', 'task')),
  external_uid   text,
  import_id      text REFERENCES calendar_imports(id) ON DELETE SET NULL,
  task_id        text REFERENCES tasks(id) ON DELETE CASCADE,
  cancelled_at   timestamptz,
  version        integer NOT NULL DEFAULT 1,
  created_by     text REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_timing CHECK (
    (all_day AND start_date IS NOT NULL AND starts_at IS NULL)
    OR (NOT all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at >= starts_at)
  )
);
CREATE UNIQUE INDEX calendar_events_uid_key ON calendar_events (workspace_id, external_uid) WHERE external_uid IS NOT NULL;
CREATE INDEX calendar_events_ws_start_idx ON calendar_events (workspace_id, starts_at);
CREATE INDEX calendar_events_ws_date_idx ON calendar_events (workspace_id, start_date);

-- ============================================================ reminders

CREATE TABLE reminders (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type    text NOT NULL CHECK (target_type IN ('task', 'calendar_event', 'promise', 'warranty', 'return_window', 'subscription', 'bill_occurrence', 'document', 'admin_workflow', 'routine', 'life_event')),
  target_id      text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('one_time', 'advance', 'due', 'follow_up', 'renewal', 'expiry', 'routine', 'shared')),
  fire_at        timestamptz NOT NULL,
  -- What fire_at was computed from, so it can be recomputed when the user's
  -- timezone or default reminder time changes. NULL anchor = a fixed instant.
  anchor_date    date,
  anchor_time    time,             -- NULL = the user's default reminder time
  offset_minutes integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'delivered', 'dismissed', 'completed', 'cancelled', 'failed')),
  snooze_count   integer NOT NULL DEFAULT 0,
  channels       text[] NOT NULL DEFAULT '{in_app}',
  title          text NOT NULL,
  note           text,
  quiet_deferred boolean NOT NULL DEFAULT false,
  delivered_at   timestamptz,
  cancel_reason  text,
  created_by     text REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON reminders (fire_at) WHERE status = 'scheduled';
CREATE INDEX reminders_target_idx ON reminders (target_type, target_id);
CREATE INDEX reminders_user_idx ON reminders (user_id, status, fire_at);
-- Duplicate suppression: one live reminder per (recipient, target, kind, moment).
CREATE UNIQUE INDEX reminders_dedupe_key ON reminders (user_id, target_type, target_id, kind, fire_at) WHERE status = 'scheduled';

CREATE TABLE notification_attempts (
  id               text PRIMARY KEY,
  reminder_id      text NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('in_app', 'web_push')),
  push_subscription_id text,
  idempotency_key  text NOT NULL UNIQUE,
  attempt          integer NOT NULL DEFAULT 1,
  -- 'accepted' = the channel took the message (push service 201); we never
  -- claim the person saw it. 'delivered' is used only for in-app, where the
  -- notification row is written in the same transaction.
  status           text NOT NULL CHECK (status IN ('pending', 'accepted', 'delivered', 'failed', 'suppressed')),
  error            text,
  next_retry_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_attempts_retry_idx ON notification_attempts (next_retry_at) WHERE status = 'failed';

CREATE TABLE notifications (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id     text REFERENCES workspaces(id) ON DELETE CASCADE,
  reminder_id      text REFERENCES reminders(id) ON DELETE SET NULL,
  idempotency_key  text NOT NULL UNIQUE,
  title            text NOT NULL,
  body             text,
  link             text,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE push_subscriptions (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint         text NOT NULL UNIQUE,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  user_agent       text,
  failure_count    integer NOT NULL DEFAULT 0,
  last_success_at  timestamptz,
  disabled_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ vault

CREATE TABLE documents (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title              text NOT NULL,
  category           text NOT NULL DEFAULT 'other',
  tags               text[] NOT NULL DEFAULT '{}',
  issuer             text,
  issued_on          date,
  expires_on         date,
  notes              text,
  is_sensitive       boolean NOT NULL DEFAULT false,
  current_version_id text,
  source_capture_id  text REFERENCES captures(id) ON DELETE SET NULL,
  created_by         text REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_ws_idx ON documents (workspace_id, created_at DESC);
CREATE INDEX documents_expiry_idx ON documents (workspace_id, expires_on) WHERE expires_on IS NOT NULL;

CREATE TABLE document_versions (
  id              text PRIMARY KEY,
  document_id     text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id    text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  storage_key     text NOT NULL,
  original_name   text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL,
  sha256          text NOT NULL,
  extracted_text  text,
  created_by      text REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX document_versions_ws_sha_idx ON document_versions (workspace_id, sha256);

CREATE TABLE document_access_grants (
  id                    text PRIMARY KEY,
  document_id           text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  grantee_user_id       text REFERENCES users(id) ON DELETE CASCADE,
  grantee_workspace_id  text REFERENCES workspaces(id) ON DELETE CASCADE,
  can_download          boolean NOT NULL DEFAULT false,
  expires_at            timestamptz,
  revoked_at            timestamptz,
  granted_by            text REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((grantee_user_id IS NULL) <> (grantee_workspace_id IS NULL))
);
CREATE INDEX grants_doc_idx ON document_access_grants (document_id);
CREATE INDEX grants_user_idx ON document_access_grants (grantee_user_id) WHERE grantee_user_id IS NOT NULL;
CREATE INDEX grants_ws_idx ON document_access_grants (grantee_workspace_id) WHERE grantee_workspace_id IS NOT NULL;

-- ============================================================ purchase protection

CREATE TABLE purchases (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_name        text NOT NULL,
  merchant            text,
  category            text,
  purchase_date       date,
  amount_minor        bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency            text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  order_ref           text,
  delivery_date       date,
  notes               text,
  receipt_document_id text REFERENCES documents(id) ON DELETE SET NULL,
  source_capture_id   text REFERENCES captures(id) ON DELETE SET NULL,
  version             integer NOT NULL DEFAULT 1,
  created_by          text REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_ws_idx ON purchases (workspace_id, purchase_date DESC);

CREATE TABLE warranties (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purchase_id   text NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  provider      text,
  terms         text,
  -- Where the term came from: the user typed it, or it was read from a document
  -- the user then confirmed. Never "assumed from manufacturer policy".
  basis         text NOT NULL CHECK (basis IN ('user_entered', 'document_confirmed')),
  claim_status  text NOT NULL DEFAULT 'none' CHECK (claim_status IN ('none', 'preparing', 'submitted', 'resolved')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX warranties_ws_end_idx ON warranties (workspace_id, ends_on);

CREATE TABLE return_windows (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purchase_id        text NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  deadline           date NOT NULL,
  basis              text NOT NULL CHECK (basis IN ('user_entered', 'document_confirmed')),
  eligibility_notes  text,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'return_requested', 'returned', 'refund_pending', 'refunded', 'closed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX return_windows_ws_idx ON return_windows (workspace_id, status, deadline);

CREATE TABLE service_records (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purchase_id   text NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  description   text NOT NULL,
  provider      text,
  cost_minor    bigint CHECK (cost_minor IS NULL OR cost_minor >= 0),
  currency      text NOT NULL DEFAULT 'INR',
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ subscriptions & bills

CREATE TABLE service_subscriptions (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name               text NOT NULL,
  category           text,
  amount_minor       bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency           text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  cycle              text NOT NULL CHECK (cycle IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_renewal_date  date,
  trial_ends_on      date,
  account_label      text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'cancellation_pending', 'cancelled', 'paused')),
  cancellation_notes text,
  cancelled_on       date,
  version            integer NOT NULL DEFAULT 1,
  created_by         text REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_ws_idx ON service_subscriptions (workspace_id, status, next_renewal_date);

CREATE TABLE subscription_events (
  id               text PRIMARY KEY,
  subscription_id  text NOT NULL REFERENCES service_subscriptions(id) ON DELETE CASCADE,
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('created', 'renewed', 'price_changed', 'cancellation_requested', 'cancelled', 'reactivated', 'paused')),
  old_amount_minor bigint,
  new_amount_minor bigint,
  occurred_on      date NOT NULL,
  note             text,
  created_by       text REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bills (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text NOT NULL DEFAULT 'other',
  payee          text,
  amount_minor   bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),  -- NULL = varies
  currency       text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  cycle          text NOT NULL CHECK (cycle IN ('once', 'monthly', 'quarterly', 'yearly')),
  next_due_date  date NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes          text,
  created_by     text REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bill_occurrences (
  id                text PRIMARY KEY,
  bill_id           text NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  workspace_id      text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  due_date          date NOT NULL,
  amount_minor      bigint,
  -- 'verified_paid' requires an authorised source; no such integration exists
  -- in this build, so the application never writes it.
  status            text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'user_reported_paid', 'verified_paid', 'cancelled')),
  paid_reported_on  date,
  paid_note         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bill_id, due_date)
);
CREATE INDEX bill_occurrences_ws_idx ON bill_occurrences (workspace_id, status, due_date);

-- ============================================================ lifeadmin, events, routines

CREATE TABLE admin_workflows (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title             text NOT NULL,
  template_key      text,
  status            text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'documents_needed', 'preparing', 'ready_for_review', 'awaiting_approval', 'ready_for_submission', 'user_reported_submitted', 'awaiting_confirmation', 'confirmed_completed', 'rejected', 'cancelled')),
  official_url      text,
  reference_number  text,
  deadline          date,
  notes             text,
  submitted_on      date,
  confirmed_on      date,
  version           integer NOT NULL DEFAULT 1,
  created_by        text REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE life_events (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL,
  template_key  text,
  starts_on     date,
  ends_on       date,
  location      text,
  notes         text,
  status        text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'done', 'cancelled')),
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE event_participants (
  id             text PRIMARY KEY,
  life_event_id  text NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           text NOT NULL,
  user_id        text REFERENCES users(id) ON DELETE SET NULL,
  responsibility text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routines (
  id               text PRIMARY KEY,
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  recurrence       jsonb NOT NULL,
  time_of_day      time,
  timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  starts_on        date NOT NULL,
  reminder_enabled boolean NOT NULL DEFAULT false,
  paused_at        timestamptz,
  archived_at      timestamptz,
  created_by       text REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routine_occurrences (
  id           text PRIMARY KEY,
  routine_id   text NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  occurs_on    date NOT NULL,
  status       text NOT NULL CHECK (status IN ('done', 'skipped')),
  note         text,
  recorded_by  text REFERENCES users(id) ON DELETE SET NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routine_id, occurs_on)
);

-- ============================================================ family

CREATE TABLE shopping_lists (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

CREATE TABLE shopping_items (
  id            text PRIMARY KEY,
  list_id       text NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label         text NOT NULL,
  quantity      text,
  done          boolean NOT NULL DEFAULT false,
  done_by       text REFERENCES users(id) ON DELETE SET NULL,
  done_at       timestamptz,
  added_by      text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comments (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  author_id     text REFERENCES users(id) ON DELETE SET NULL,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_entity_idx ON comments (entity_type, entity_id, created_at);

-- ============================================================ intelligence

CREATE TABLE search_index (
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  occurs_on     date,
  status        text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- 'simple' keeps Hindi/Bengali and reference numbers searchable as written;
  -- 'english' adds stemming so "renewals" finds "renewal".
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX search_index_tsv_idx ON search_index USING gin (tsv);
CREATE INDEX search_index_ws_idx ON search_index (workspace_id, entity_type);

CREATE TABLE saved_searches (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  query       text NOT NULL,
  filters     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_preferences (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  source      text NOT NULL CHECK (source IN ('user_set', 'learned_from_correction')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE automation_rules (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  trigger        text NOT NULL CHECK (trigger IN ('warranty_expiring', 'return_window_closing', 'subscription_renewing', 'trial_ending', 'document_expiring', 'bill_due', 'promise_overdue')),
  conditions     jsonb NOT NULL DEFAULT '{}',
  action         text NOT NULL CHECK (action IN ('propose_task', 'propose_reminder', 'propose_checklist')),
  enabled        boolean NOT NULL DEFAULT true,
  max_runs       integer CHECK (max_runs IS NULL OR max_runs > 0),
  run_count      integer NOT NULL DEFAULT 0,
  last_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE action_proposals (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id       text REFERENCES automation_rules(id) ON DELETE SET NULL,
  origin        text NOT NULL CHECK (origin IN ('automation', 'assistant')),
  kind          text NOT NULL CHECK (kind IN ('create_task', 'create_reminder', 'create_checklist', 'draft_message')),
  title         text NOT NULL,
  explanation   text NOT NULL,
  payload       jsonb NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'undone', 'expired')),
  dedupe_key    text UNIQUE,
  result_type   text,
  result_id     text,
  error         text,
  undo_until    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  executed_at   timestamptz
);
CREATE INDEX proposals_user_idx ON action_proposals (user_id, status, created_at DESC);

-- ============================================================ billing

CREATE TABLE billing_subscriptions (
  id                        text PRIMARY KEY,
  user_id                   text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan                      text NOT NULL CHECK (plan IN ('free', 'plus', 'family')),
  interval                  text NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  status                    text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  provider                  text NOT NULL CHECK (provider IN ('none', 'development', 'razorpay')),
  provider_subscription_id  text UNIQUE,
  trial_ends_at             timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  trial_used                boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_counters (
  user_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric   text NOT NULL,
  period   text NOT NULL,           -- 'YYYY-MM' in UTC, or 'lifetime'
  count    bigint NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, metric, period)
);

CREATE TABLE payment_events (
  id                 text PRIMARY KEY,
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  event_type         text NOT NULL,
  user_id            text REFERENCES users(id) ON DELETE SET NULL,
  payload            jsonb NOT NULL,
  outcome            text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- ============================================================ operations

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  workspace_id  text,                -- not an FK: audit rows outlive deleted workspaces (anonymised)
  actor_id      text,
  action        text NOT NULL,
  entity_type   text,
  entity_id     text,
  meta          jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_ws_idx ON audit_events (workspace_id, at DESC);
CREATE INDEX audit_actor_idx ON audit_events (actor_id, at DESC);
CREATE INDEX audit_entity_idx ON audit_events (entity_type, entity_id);

CREATE TABLE background_jobs (
  id            text PRIMARY KEY,
  kind          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'dead')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  dedupe_key    text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX background_jobs_ready_idx ON background_jobs (run_after) WHERE status IN ('queued', 'failed');

CREATE TABLE sync_conflicts (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id    text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  base_version    integer NOT NULL,
  server_version  integer NOT NULL,
  client_payload  jsonb NOT NULL,
  server_payload  jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept_mine', 'kept_server')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE TABLE product_events (
  id          bigserial PRIMARY KEY,
  subject     text NOT NULL,         -- HMAC of the user id; not reversible without the server secret
  name        text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}',
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_events_name_idx ON product_events (name, at);

CREATE TABLE feedback (
  id          text PRIMARY KEY,
  user_id     text REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('bug', 'feature_request', 'confusing', 'extraction_failure', 'notification_problem', 'other')),
  message     text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  page        text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
