# SAT Tutoring

A small site for my SAT tutoring students.

- **Students** log in with just their name. Their dashboard shows their next session, past sessions (each with its own page: session plan, notes, homework), scores, optional goals, and a log of practice questions by question ID, skill, category and difficulty.
- **The tutor** logs in with a name and password to see every student: this week's sessions with prep check-offs, editable session pages (plan, Granola notes, homework, focus skill, private note), weakest skills, struggled questions, scores, course plans and private notes.

It runs on Vercel. Student data is kept in a private Vercel Blob store, never in this repository.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What it is |
| --- | --- |
| `TUTOR_NAME` | The name you log in with |
| `TUTOR_PASSWORD` | Your password |
| `SESSION_SECRET` | Long random text used to sign logins |
| `GCAL_ICS_URL` | Google Calendar → Settings → your Tutoring calendar → "Secret address in iCal format" |
| `BLOB_READ_WRITE_TOKEN` | Added automatically when the Blob store is connected |

Calendar events titled `SAT - Student Name` show up as sessions.
