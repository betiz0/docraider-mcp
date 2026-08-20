# Readiness and recovery decisions

Read readiness independently for `keyword`, `semantic`, and `hybrid`; each can be `ready`, `degraded`, or `unavailable` and includes reason codes and a recommended action.

- `none`: continue normally.
- `use_keyword_search`: select keyword mode.
- `hybrid_search_allowed`: hybrid can degrade safely to keyword.
- `start_backfill`: start one backfill only after confirming there is no active job.
- `wait_for_backfill`: poll the existing job; do not start another.
- `retry_failed`: address the recorded failure, then make at most one deliberate retry.
- `check_embedding_endpoint`: use a bounded explicit probe or fix endpoint configuration.
- `restart_worker`: preserve the job and recover the worker; do not duplicate the job.

Normal status is intentionally lightweight and does not probe external services. Status with `--job-id` tracks the persistent job. Remember the job ID and poll status, not the start command.
