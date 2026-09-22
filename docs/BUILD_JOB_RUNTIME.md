# Build job runtime and recovery

The CMS build executor supports one worker on one host. It requires **Python 3
on PATH and a Unix host with `fcntl.flock`** (the supported macOS/Linux authoring
and server environments). Python is already used for sprite extraction. The
small `cms/jobs/build_worker_lock.py` child owns a kernel advisory lock and exits
when its Node parent's stdin pipe closes. Windows requires an equivalent native
locking implementation before running this worker.

The lock file is never unlinked, including after shutdown: its stable inode is
what makes concurrent stale-record takeover safe. If the helper unexpectedly
dies after acquiring ownership, the CMS exits with code 70 so it cannot continue
submitting or mutating alongside a replacement worker. Normal server shutdown
releases the helper deliberately. The lock metadata is diagnostic, not a lease.
A still-running owner from the older exclusive-file protocol blocks startup;
drain that old process before upgrading.

For multiple launchers sharing remote storage on the same host, configure the
same `CMS_BUILD_LOCK_PATH`. This does not provide multi-host coordination.

On `server.close()`, new mutation requests return HTTP 503. Previously admitted
mutation handlers and active builds finish before ownership is released. Pending
jobs remain stored for the next process. Startup repairs indexed heads from
immutable journals, resumes safe pre-submission work, and recovers accepted tasks
or saved sources. An unknown acceptance outcome becomes `submission-uncertain`
and is never automatically resubmitted. Archived characters remain paused.

Job status is available as full snapshots through
`GET /api/characters/:characterId/build-jobs/:jobId/events`. Events are named
`job`, carry `{job}`, and use numeric revision IDs. Reconnect with `Last-Event-ID`
or `?after=revision`; polling the ordinary job endpoint remains supported.

Operators can resolve an interrupted job without retrying, recover its saved
source, or attach a provider task ID checked against that job's recorded attempt.
Partial multi-frame image attempts still require manual assembly. Video recovery
requires matching original inputs and an archived accepted checkpoint.
