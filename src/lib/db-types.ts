/**
 * Shared database document types.
 *
 * All persisted documents extend `Document` (the `_id`-only storage
 * convention — see AGENTS.md rule 5: docs are stored with `_id` and never
 * with a parallel `id` field; `{ id }` queries are an alias handled by
 * LocalCollection._match and the `_id` index).
 */

export interface Document {
  _id: string;
  created_at: string;
  updated_at: string;
}

export interface UserDoc extends Document {
  name?: string;
  email: string;
  password_hash?: string;
  image?: string;
  provider?: string;
}

export interface ScanDoc extends Document {
  user_id?: string;
  image_path?: string;
  raw_text?: string;
  items_count?: number;
  status?: string;
  enriched?: boolean;
  agent_summary?: string;
  menu_name?: string;
  dishes?: unknown[];
  error?: string;
}

export interface DishDoc extends Document {
  scan_id: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
  confidence?: number;
  ai_description?: string;
  origin?: string;
  dietary_tags?: string[];
  image_url?: string;
}

export type AgentJobStatus = "queued" | "processing" | "completed" | "failed" | "dlq";

export interface AgentJobDoc extends Document {
  /** Legacy jobs persisted before _id-only storage carried an explicit `id`
   *  field; `_id` is always present. Use jobId(job) to resolve. */
  id?: string;
  scan_id: string;
  status: AgentJobStatus;
  items_count: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
  /** Number of failed attempts so far */
  retries: number;
  max_retries: number;
  /** Time of the last failed attempt — drives exponential backoff */
  last_attempt_at?: string;
  /** When the job may be retried next (now + backoff). getNextJob only
   *  returns jobs whose retry_at is in the past. */
  retry_at?: string;
  /** Per-dish outcome tracking: dish name → error (absent = succeeded) */
  dish_errors?: Record<string, string>;
  /** Set when the job is moved to the dead-letter queue */
  dlq_at?: string;
  dlq_reason?: string;
}

export interface AgentLogDlqDoc extends Document {
  scan_id: string;
  job_id: string;
  status: AgentJobStatus;
  items_count: number;
  error: string;
  /** Full error stack when available */
  error_stack?: string;
  /** Dish names that were being processed when the job died */
  dish_names: string[];
  /** Per-dish outcome tracking preserved from the job */
  dish_errors?: Record<string, string>;
  retries: number;
  max_retries: number;
  job_created_at: string;
}

export interface CacheDoc extends Document {
  key: string;
  value: unknown;
}
