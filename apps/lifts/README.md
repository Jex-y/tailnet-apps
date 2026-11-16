# Lifts

A strength training log built for powerlifting: each tailnet login keeps its own, which nobody else sees. It stands
apart from the other apps: it keeps its own look, Paper (`src/web/paper.css`), whatever theme they are in, and links
only to its own sections. A workout holds exercises in order, each with its sets: weight, reps, an optional RPE, and
whether it was a warm-up.

- **Log**: the session under way. A new one starts from a past session's exercises or empty. Exercises done fold to a
  line; the one being lifted is a dense table of its sets, each beside what was lifted in its place last time, with the
  max it implies and how that compares with last session; the rest wait below. A dock above the tab bar logs each set:
  the weight, reps and RPE are typed on its own number pad, the first key replacing what a field held, and one big
  button, always in the same place, logs the set, so a set can be logged without looking. While resting, the dock shows
  the rest against a three-minute target and asks the last set's RPE in one tap; logging the next set skips the
  question, and an RPE typed in with a set is never asked again. Tapping any row hands it to the dock to correct or
  delete. A set that beats the best estimated max is marked as a record.
- **History**: every workout, newest first, each open to correction in the same table and dock.
- **Exercises**: each competition lift's max as its trend puts it today, with the total, then each exercise. An
  exercise's page fits its trend and reads its rep–strength profile (below), then lists the heaviest set at each rep
  count and every session.

Estimated one-rep maxes come from the Reactive Training Systems RPE chart, taking a set without an RPE as all-out;
warm-ups never count. That arithmetic is in `src/strength.ts`, pure and shared by the server and the UI.

## Statistics

The trend is an ordinary least-squares line through each session's best estimated max over a span (twelve weeks by
default), with time in weeks so its slope reads in kilograms a week. It is drawn with the 95% confidence interval of
the line and the 95% prediction interval for a single session, both on Student's t with n − 2 degrees of freedom,
over a strip of residuals for judging whether a straight line suits the data. The latest session is held against a
line fitted to the sessions before it, so it cannot pull the line towards itself: it reads as a real rise only when
it beats that prediction interval. The total adds the three lifts' fitted values and variances, taking the lifts as
independent, on the fewest degrees of freedom among them.

The rep–strength profile first carries every work set in the span to today's level along the trend, then fits one
max to them all by least squares on weight = max × the RPE chart's share for the set's reps and RPE. Each rep range
is read as its sets' mean distance from that max with a t interval, and flagged only when the interval leaves out
zero. The arithmetic is in `src/web/features/exercises/utils/fit.ts` and `progress.ts`, with tests that check the
intervals' coverage by simulation.

## It works without a connection

The app opens and logs with no network, as a gym basement requires. The device keeps a copy of the log and a queue
of changes not yet sent, shows every change at once, and sends the queue in order when the server is next reachable;
a banner counts what is waiting. Until then those changes exist only on that device, so install the app to the Home
Screen: iOS may clear the storage of a site that is only visited in Safari.

Each row's id is made on the device, a change writes the whole row, and each batch carries a key the server
remembers for thirty days, so a batch sent twice lands once. Two devices changing the same row leave whichever
change arrived last. If the server refuses a change, for instance a set for a workout since deleted elsewhere, the
device undoes it and says why.

The local copy is [TanStack DB](https://tanstack.com/db) collections persisted to SQLite in the browser. Its
packages are pinned to exact versions that were tested together; check that the app still loads and still restores
its rows offline before moving them.

## Manage the log from Claude

The lifts tools (read workouts, exercise histories, estimated maxes and rep records; log whole workouts or single
sets; correct and delete them; write programs, whose loads are fixed weights, percentages of a per-program training
max or target RPEs, rounded down to each exercise's weight step) are served alone at `https://apps.<tailnet>.ts.net/lifts/mcp`, and to claude.ai
through a connector of their own at `https://apps-mcp.<tailnet>.ts.net/lifts/mcp`, not with every other app's. They act as the same Tailscale identity as the web app, and what they
change shows on a device the next time it syncs.
