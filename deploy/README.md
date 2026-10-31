# qooob release workflow

Production: `@Leadgen_Ass1stant_bot`, `/root/event-bot/current`, PM2 `onlyplay-*`.
Staging: `@qooob_event_assistant_bot`, `/srv/qooob-staging/current`, systemd `qooob-staging@bot` and `qooob-staging@web`.
Staging HTTPS: https://staging.qooob.81.27.103.54.sslip.io

Staging uses its own Linux user, `/etc/qooob-staging` configuration and `/var/lib/qooob-staging` data. The runtime discards inherited environment variables, fixes all data paths and verifies the exact bot through getMe before importing application code. systemd denies access to production private directories and `/root`.

Only bot and web run in staging. No production Google/Sheets, Slack, Apollo, OpenAI or Telegram user-session credentials are installed. Manual lead capture and UI inspection work; enrichment, Google booking and real group creation require separate test integrations before they can be accepted. Google client files are deliberately non-working placeholders. Do not connect production Google accounts or replace these files with production secrets.

## Candidate

1. Develop on a `codex/*` branch. Run `npm ci --ignore-scripts`, `node --test scripts/staging.test.mjs`, `npm test`; inspect diff and scan source/history for secrets.
2. Commit the candidate and create an immutable archive using `git archive HEAD`. Record commit ID and SHA256. Transfer only source and media to a new `/srv/qooob-staging/releases/<commit>` directory. Build/install dependencies on a separate Linux builder, never with unrestricted npm on the shared production host. For an unchanged lockfile, an independent copy of the existing dependency tree is acceptable only after byte-for-byte lockfile comparison. Do not edit the active release.
3. Re-run tests under a clean environment, including Node 22/Linux checks. Any server-side install/build/test must run in a transient systemd service with `MemoryMax=256M`, `MemorySwapMax=128M`, `CPUQuota=40%`; abort if limits cannot be applied or free host resources are insufficient. Change staging `current` to the candidate only after checks pass; restart only the two staging units. Verify public health and getMe identity. Keep the previous symlink target for rollback.
4. Test the changed flows in the staging bot. Record which integrations are disabled and which live checks remain outstanding. Passing `/health` alone is not acceptance.

## Production promotion

Promote only the exact staging-tested commit/archive; never rebuild from an uncommitted working directory. This initial staging setup does not switch production.

1. Resolve production `current`, inspect PM2 and compare hashes with a fresh downloaded application-only baseline. Acquire a deployment lock and reject unexpected file changes.
2. Back up replaced application files and record existing production PIDs, health and configuration checksums. Preserve `/etc/onlyplay`, `/var/lib/onlyplay`, calendar accounts and all cutover/delivery ledgers.
3. Stage only changed application files from the tested release. Never deploy `deploy/`, staging runtime scripts, systemd units or staging private files over production configuration. Never run `start-staging.mjs` with production credentials.
4. Run appropriate checks, replace the intended application files, restart only affected qooob PM2 processes, then verify hashes, health and bot identity 8344814605. Roll back replaced application files if verification fails.
5. Record release, checks, manual acceptance and rollback in Todoist qooob. Never equate user-requested task closure with a verified implementation.

Automated GitHub CI runs checks only. No workflow automatically publishes to production. Promotion currently follows the above checked deployment procedure; a fully automatic production deploy pipeline is not implemented.

## Staging rollback / shutdown

Restore `/srv/qooob-staging/current` to its recorded previous release and restart `qooob-staging@bot` and `qooob-staging@web`. Persistent staging data remains separate. To stop staging: `systemctl stop qooob-staging@bot qooob-staging@web`. Production services are unaffected.
