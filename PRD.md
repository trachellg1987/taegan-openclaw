# Taegan OpenClaw Executive Functioning System — PRD
**Version:** 1.0 | **Date:** March 2026 | **Platform:** Mac Mini 24/7

> Ralph: find the next uncompleted [ ] item, build it, commit, and loop until all are marked [x].

---

## SECTION 1: Data Collection

- [x] DC-001: ClassLink Canvas Scraper
  Acceptance criteria:
  - Playwright logs into ClassLink and navigates to Canvas
  - Scrapes assignments, due dates, submission status
  - Outputs to ~/.openclaw/workspace/canvas-data.json
  - Sends parent alert on failure

- [x] DC-002: ClassLink Skyward Scraper
  Acceptance criteria:
  - Navigates from ClassLink to Skyward PFISD
  - Scrapes grades and missing assignments
  - Outputs to ~/.openclaw/workspace/skyward-data.json
  - Sends parent alert on failure

- [x] DC-003: Gmail School Email Monitor
  Acceptance criteria:
  - Polls school Gmail every 30 min on weekdays
  - Filters Canvas and Google Classroom emails
  - Forwards summaries to parent via iMessage

- [x] DC-004: Cron Job Scheduler
  Acceptance criteria:
  - Runs Canvas and Skyward scrapers at 6:00 AM and 3:00 PM weekdays
  - Does not run on weekends
  - Logs all runs to ~/.openclaw/logs/cron.log

- [x] DC-005: Daily Snapshot and Comparison
  Acceptance criteria:
  - Saves timestamped snapshots after each scraper run
  - Compares to previous day and alerts parent on new missing assignments
  - Prunes snapshots older than 30 days

---

## SECTION 2: Morning Routine (Weekdays 6:00–7:30 AM)

- [x] MR-001: Wake-Up Message (6:00 AM)
  Acceptance criteria:
  - iMessage: "Good morning Taegan! Time to wake up — drop and give me 10 push-ups!"
  - 5-minute escalation timer starts on send

- [x] MR-002: Push-Up Confirmation (6:05 AM)
  Acceptance criteria:
  - iMessage: "Push-ups done? Head to the bathroom."
  - Escalation applies

- [x] MR-003: Bathroom Routine (6:08 AM)
  Acceptance criteria:
  - iMessage: "Brush your teeth, floss, and hop in the shower."
  - Escalation applies

- [x] MR-004: Get Dressed (6:20 AM)
  Acceptance criteria:
  - iMessage: "Time to get dressed."
  - Append weather tip if weather API configured
  - Escalation applies

- [x] MR-005: Tidy Room (6:30 AM)
  Acceptance criteria:
  - iMessage: "Take 5 minutes to tidy your room and make your bed."
  - Escalation applies

- [x] MR-006: Breakfast (6:35 AM)
  Acceptance criteria:
  - iMessage: "Go eat breakfast."
  - Escalation applies

- [x] MR-007: Meds Reminder (6:45 AM)
  Acceptance criteria:
  - iMessage: "Don't forget your meds."
  - Fires every weekday regardless of other routine status
  - Escalation applies

- [x] MR-008: Lunch and Water (6:40 AM)
  Acceptance criteria:
  - iMessage: "Make your lunch and drink a full bottle of water."
  - Escalation applies

- [x] MR-009: Idle Buffer (6:55–7:10 AM)
  Acceptance criteria:
  - No messages sent during this window
  - No escalation timers active

- [x] MR-010: Pack Backpack and Depart (7:10 AM)
  Acceptance criteria:
  - iMessage: "Pack your backpack and head out — have a great day!"
  - Append gear reminder if practice today
  - Escalation applies
  - No messages after 7:30 AM until after-school routine

---

## SECTION 3: After-School Routine (Weekdays 4:45–6:45 PM)

- [x] AS-001: Idle Buffer (4:45–5:15 PM)
  Acceptance criteria:
  - No messages sent, no escalation timers
  - 30 minutes of decompression time

- [x] AS-002: Hydration Reminder (5:15 PM)
  Acceptance criteria:
  - iMessage: "Drink 2 full bottles of water right now."
  - Escalation applies

- [x] AS-003: Protein Meal Reminder (5:20 PM)
  Acceptance criteria:
  - iMessage: "Time to eat a protein-rich meal to refuel."
  - Escalation applies

- [x] AS-004: Skyward Check (5:35 PM)
  Acceptance criteria:
  - iMessage: "Open Skyward PFISD and check for any missing assignments."
  - Append missing assignment count if scraper data available
  - Escalation applies

- [x] AS-005: Canvas Check (5:45 PM)
  Acceptance criteria:
  - iMessage: "Check Canvas for any upcoming assignments."
  - Append nearest due date if scraper data available
  - Escalation applies

- [x] AS-006: Email and Portals (5:55 PM)
  Acceptance criteria:
  - iMessage: "Check your school email, English assignment portal, and Google Classroom."
  - Escalation applies

- [x] AS-007: Folder and Backpack (6:10 PM)
  Acceptance criteria:
  - iMessage: "Check your folder and organize your backpack for tomorrow."
  - Append gear bag reminder if practice tomorrow
  - Escalation applies

- [x] AS-008: End Buffer (6:25–6:45 PM)
  Acceptance criteria:
  - No messages sent
  - Free time before nighttime routine

---

## SECTION 4: Nighttime Routine (Daily, lights out 10:30 PM)

- [x] NT-001: Dumbbell Exercise (8:45 PM)
  Acceptance criteria:
  - iMessage: "Time for your dumbbell workout before bed."
  - Escalation applies

- [x] NT-002: Shower (9:15 PM)
  Acceptance criteria:
  - iMessage: "Hop in the shower."
  - Escalation applies

- [x] NT-003: Brush Teeth (9:30 PM)
  Acceptance criteria:
  - iMessage: "Brush your teeth."
  - Escalation applies

- [x] NT-004: Tidy Room (9:40 PM)
  Acceptance criteria:
  - iMessage: "Do a quick tidy of your room."
  - Escalation applies

- [x] NT-005: Screen-Off MANDATORY ESCALATION (9:50 PM)
  Acceptance criteria:
  - iMessage: "Start winding down and put the phone down."
  - ALWAYS escalates to Twilio call if unread — hardcoded, not config-driven
  - No exceptions

- [x] NT-006: Lights Out (10:30 PM)
  Acceptance criteria:
  - iMessage: "Lights out Taegan. You crushed it today. Get some rest."
  - Warm positive tone
  - No messages after 10:30 PM until 6:00 AM

---

## SECTION 5: Escalation Engine

- [x] ESC-001: Read Receipt Timer
  Acceptance criteria:
  - Every iMessage starts a 5-minute countdown
  - Polls read receipt every 60 seconds
  - If read: cancel timer
  - If unread at 5 min: fire ESC-002
  - State persisted to disk, survives gateway restart

- [x] ESC-002: Twilio Voice Call with ElevenLabs TTS
  Acceptance criteria:
  - Twilio calls taegan_phone from config.yaml
  - ElevenLabs generates warm human-sounding audio from message text
  - If unanswered after 30 seconds: fire ESC-003

- [x] ESC-003: Voicemail Fallback Parent Alert
  Acceptance criteria:
  - iMessage to parent_phone within 60 seconds of unanswered call
  - Includes: which step was missed, original message, timestamp

- [x] ESC-004: Escalation Log and Weekly Report
  Acceptance criteria:
  - Every escalation logged to ~/.openclaw/workspace/escalation-log.json
  - Weekly report sent to parent every Sunday at 8:00 PM
  - Log is append-only, never deleted

---

## SECTION 6: Parent Dashboard

- [x] PD-001: Nightly Summary (9:30 PM)
  Acceptance criteria:
  - iMessage to parent_phone with: routine completion %, escalation count, missing assignments, grade alerts
  - Under 10 lines, concise and scannable

- [x] PD-002: Real-Time Critical Alerts
  Acceptance criteria:
  - Alert if 3+ missing assignments detected
  - Alert if any grade drops below B (80%)
  - Alert if major project due within 48 hours not started
  - Alert if Taegan unreachable after escalation

- [x] PD-003: Scraper Failure Notification
  Acceptance criteria:
  - iMessage to parent within 5 minutes of any scraper failure
  - Includes which scraper, error, timestamp
  - One retry before notification fires

---

## SECTION 7: Configuration and Security

- [x] CFG-001: Secure .env Credential Storage
  Acceptance criteria:
  - .env contains all secrets, never committed to repo
  - .env.example committed with blank values
  - No credentials in source code

- [x] CFG-002: config.yaml Schedule File
  Acceptance criteria:
  - All times configurable: wake_time, after_school_start, bedtime
  - Contains: taegan_phone, parent_phone, practice_days, game_schedule
  - config.yaml.example with inline comments committed to repo

- [x] CFG-003: Approved Contacts Enforcement
  Acceptance criteria:
  - iMessage and Twilio only contact approved_contacts from config.yaml
  - Unapproved numbers blocked and logged
  - Unit test verifies rejection

- [x] CFG-004: NemoClaw Security Layer
  Acceptance criteria:
  - NemoClaw wrapping OpenClaw gateway
  - Network policy allows only: Twilio, ElevenLabs, Gmail API, ClassLink
  - New skills require operator approval

- [x] CFG-005: Auto-Start LaunchAgent
  Acceptance criteria:
  - com.taegan.openclaw.plist in ~/Library/LaunchAgents/
  - Starts on reboot automatically
  - Health check every 5 minutes
  - 3 consecutive failures triggers parent iMessage alert

- [x] CFG-006: Setup and Health Scripts
  Acceptance criteria:
  - start.sh launches gateway, verifies Ollama, verifies cron jobs
  - health-check.sh verifies gateway, model, last scraper run
  - setup.sh installs everything on fresh Mac Mini in under 30 minutes

---

## SECTION 8: Deployment

- [x] DEP-001: DEPLOYMENT.md
  Acceptance criteria:
  - Step-by-step guide for basic Terminal user
  - Covers clone, .env setup, config.yaml, setup.sh, start.sh, LaunchAgent
  - Includes 8-item verification checklist

- [x] DEP-002: End-to-End Test Suite
  Acceptance criteria:
  - npm test runs full suite
  - Tests: scrapers return data, iMessage sends, escalation timer fires, Twilio call placed (sandbox), parent alert sends
  - All tests pass before any story marked complete

---

## Completion Criteria

Ralph exits when:
- All stories marked [x]
- npm test passes with zero failures
- ./health-check.sh returns healthy
- progress.txt has entry for every story

Output <promise>COMPLETE</promise> when done.
