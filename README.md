# SAT Tutoring

A small site for my SAT tutoring students.

- **Students** log in with their name, keep their goals up to date, and log the practice questions they do.
- **The tutor** logs in with a name and password to see every student: goals, question logs with accuracy by skill area, course plans, private notes, a session log, and upcoming sessions from Google Calendar (with optional AI prep briefs).

It runs on Vercel. Student data is kept in a private Vercel Blob store, never in this repository.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What it is |
| --- | --- |
| `TUTOR_NAME` | The name you log in with |
| `TUTOR_PASSWORD` | Your password |
| `SESSION_SECRET` | Long random text used to sign logins |
| `GCAL_ICS_URL` | Google Calendar → Settings → your Tutoring calendar → "Secret address in iCal format" |
| `ANTHROPIC_API_KEY` | Optional. Turns on AI prep briefs and course-plan drafts |
| `BLOB_READ_WRITE_TOKEN` | Added automatically when the Blob store is connected |

Calendar events titled `SAT - Student Name` show up as sessions.
