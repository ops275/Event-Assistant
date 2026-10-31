# qooob

Telegram lead-capture bot, calendar web application, onboarding, reminders and Slack integration.

## Requirements

Node.js 22 or newer; Linux for the onboarding worker (uses flock).

## Install and check

```sh
npm ci --ignore-scripts
npm test
```

## Run

Supply credentials through the process environment or private configuration files outside this repository. No environment files, production records, OAuth credentials or Telegram sessions are included.

| Command | Component |
| --- | --- |
| npm start | qooob Telegram bot |
| npm run start:web | Calendar web application |
| npm run start:onboarding | Telegram onboarding worker |
| npm run start:reminders | Reminder worker |
| npm run start:slack | Slack worker |

The bot accepts ENV_FILE pointing to a private configuration file. The calendar accepts CALENDAR_BOT_ENV. Configure the required integration credentials, access controls, public URLs and persistent data paths before starting any worker. Run only one instance of each worker to avoid duplicate actions.

## Docker

```sh
docker build -t onlyplay .
```

The image contains application code and dependencies only. Inject environment variables at runtime; mount private configuration and persistent storage separately. The default command starts only the bot.

## Deployment notes

The calendar currently listens on loopback; configure a same-host reverse proxy for HTTPS. Container deployment requires adapting and verifying the listen address. Slack requires current and legacy app configuration files, an explicit notification cutover and data paths under /root/event-bot. Google OAuth files and the Telegram onboarding session must be provisioned separately.

Application images and videos are included because they are used at runtime. Shared Qooob names and media are part of the existing qooob application; no separate Qooob service or production data is included.

Tests do not verify live credentials or production integration behavior. An optional browser test is skipped when Playwright is unavailable.
