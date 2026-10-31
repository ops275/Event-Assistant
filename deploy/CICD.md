# qooob GitHub workflow

## Branches and day-to-day changes

- `main`: production history. Protect against force pushes/deletion and require the `Tests` status check.
- `staging`: integration and test bot. Feature branches target this branch through a Pull Request; require `Tests`.
- `feature/<task>` or `codex/<task>`: work in isolation. CI runs on every push and PR, without deployment secrets in PR jobs.

The standard path is `feature -> PR into staging -> automatic stage deployment -> flow acceptance -> PR staging into main -> automatic production promotion`. Sync staging with main after promotion, so the next release PR has the same tree as the accepted stage. GitHub merge commits are supported: the full Git tree must match the accepted staging tree, and production uses the retained stage archive, not a rebuild of main. If main contains other changes, first merge them into staging and deploy/test again.

`Tests` runs Python deployment guards, Node staging guards and the bot/web/Slack tests on a GitHub-hosted Linux Node22 runner. One optional browser test may be skipped; CI does not prove live integration behavior. Staging packages the exact tested installed dependencies into a SHA256-manifested artifact (30-day GitHub retention; server archives retained for promotion). No npm installs/builds/test suites run on the shared 2GB server.

## One-time server setup (administrator)

Install the reviewed `release.py` as `/usr/local/lib/qooob-deploy/release.py`, root:root 700. The receiver creates `/var/lib/qooob-deploy` with 700 permissions for receipts, artifacts, baseline and backups. Keep the installed receiver version separate from branch source: ordinary pushes cannot replace the root program.

Create two distinct Ed25519 keys outside the repository. Append their public keys to root authorized_keys with:

```
restrict,command="/usr/bin/python3 /usr/local/lib/qooob-deploy/release.py ssh staging" ssh-ed25519 <STAGING_PUBLIC_KEY>
restrict,command="/usr/bin/python3 /usr/local/lib/qooob-deploy/release.py ssh production" ssh-ed25519 <PRODUCTION_PUBLIC_KEY>
```

The staging key permits only `stage <commit> <tree> <archive-sha256>` plus archive bytes on stdin. The production key permits only `promote <tree>`. Neither permits shell, file transfer, port forwarding, acceptance, baseline reset or rollback. Production identity/private configuration remains server-side; do not upload bot tokens, Google/Slack credentials or live data to GitHub.

Before first deployment, download a source-only baseline using the package's tracked runtime paths, compare it with the candidate, inspect PM2 and resolve production current. Initialize the baseline once from a reviewed manifest:

```
python3 /usr/local/lib/qooob-deploy/release.py baseline /path/to/release.manifest.json
```

It records current source and dependency hashes; it does not change the application. Further production drift fails closed. If an emergency manual fix changes production, reconcile it through Git/staging and explicitly review the baseline update; never automatically reset the baseline to bypass drift.

## GitHub settings (repository Admin required)

Create environments `staging` and `production`, each restricted to its matching branch. In EACH environment set:

- Secret `DEPLOY_SSH_KEY`: that environment's restricted private key.
- Secret `DEPLOY_KNOWN_HOSTS`: the host key line for `81.27.103.54`, verified against the already trusted administrator SSH connection. Never use unverified ssh-keyscan in CI.

Protect both branches with `Tests`, strict up-to-date checks and no force push/deletion. Keep `main` as default. Suggested: require PRs with zero mandatory external approvals so a solo maintainer can merge after CI. Enforce protections for administrators after bootstrap. Environment branch restrictions are essential because PR/feature workflows must not access production secrets. No recurring human deployment confirmation is added; main deploys automatically when its staged tree has acceptance.

## Staging acceptance and production

A successful staging deploy checks isolated units, HTTPS health and exact Telegram bot 9280625084, and records the artifact hash. It also confirms production PIDs did not change. It does NOT mark functional acceptance.

After checking the changed user flows, an administrator records acceptance on the server:

```
python3 /usr/local/lib/qooob-deploy/release.py accept <FULL_GIT_TREE_SHA> 'Checked /start and changed flow; integrations disabled: ...; outstanding live checks: ...'
```

Only the currently active staging release can be accepted. This is evidence of performed acceptance, not permission to claim disabled integrations passed. Staging currently has only bot/web and no working production Google/Sheets, Slack, Apollo, OpenAI or Telegram user session. Changes relying on those integrations require separate test credentials or an explicitly documented limited acceptance; do not silently claim parity.

Merge staging into main after acceptance. The production receiver locks deployment, validates the retained archive/receipt/tree, checks live source/dependency baseline and bot 8344814605, backs up changed source/dependencies, applies only changed runtime files and restarts affected `onlyplay-*` processes. It checks source hashes, private config checksums, unaffected PIDs, PM2 and HTTPS. It preserves data, calendar accounts, notification cutovers and delivery ledgers. Source deletion and unmanaged path collisions require an explicit migration and otherwise fail closed.

## Rollback

On production deploy verification failure, the receiver restores the backed-up source/dependencies and restarts affected workers, without restoring old live data. If rollback itself fails, the workflow stays red: inspect PM2 and the root-only backup record immediately. No automated success claim is made.

Manual latest-production rollback after checking live baseline:

```
python3 /usr/local/lib/qooob-deploy/release.py rollback
```

For staging, use `previous` from its root-only receipt: restore `/srv/qooob-staging/current` and restart only `qooob-staging@bot` and `qooob-staging@web`. Keep persistent staging data. After any rollback, reconcile branches with the desired release before the next push; do not assume rollback changed Git history. Backups/archives are retained until an administrator explicitly prunes reviewed old releases.

## Deployment status

Workflow source alone is not activation. Record GitHub push/run URLs, enabled environments/protections, staging deployed commit/tree/hash, acceptance limitations, production promotion and rollback evidence in Todoist project qooob. Missing Admin permissions or unaccepted invitations must be reported explicitly.
