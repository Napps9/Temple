# Demo cue sheet: CrossFit Good Life

The showcase runs on the seeded tenant `demo-crossfit-good-life` at
app.jointemple.io. It is a demo gym (migration 0278): every email and
SMS is simulated, invites show their code on screen, Stripe writes are
refused, and the assistant is live. Nothing here can reach a real
person. The seed was taken on Sun 6 Sep 2026; the timetable runs to
Sun 20 Sep. Reseed the evening before the showcase (Actions, "Demo
gym", `mode=teardown` then `mode=seed`, slug `demo-crossfit-good-life`,
name `CrossFit Good Life`) and the dates below move with it: the full
class is always the first CrossFit after the reseed.

## Logins

All on `@demo-crossfit-good-life.temple.test`, password `TempleDemo1!`.

| Who | Email | Name |
|---|---|---|
| Owner | `owner@` | Sam Okafor |
| Coach 1 | `coach1@` | Priya Sharma (CrossFit, Engine, Gymnastics) |
| Coach 2 | `coach2@` | Callum Reid (Open Gym, Olympic Lifting) |
| Member | `member01@` | Alice Adams |
| Waitlisted | `member06@`, `member07@`, `member09@` | Finn Foster, Grace Green, Isla Irwin (queue order) |

## Sessions, set up before you walk in

- iPhone Safari, normal tab: owner. Private tab: member01.
- Laptop Chrome: owner. Incognito window: coach1.
- Reject the cookie banner in all four. Sign in, land, leave them open.
- Charge the phone. Put the laptop on the demo tenant's Timeline.

## The week's timetable (Europe/London)

| Day | Classes |
|---|---|
| Mon | 06:00 CrossFit (full, 14 of 14, three waitlisted), 12:00 Open Gym, 17:30 CrossFit |
| Tue | 06:00 CrossFit, 07:15 Engine, 17:30 CrossFit, 18:30 Olympic Lifting |
| Wed | 06:00 CrossFit, 12:00 Open Gym, 17:30 CrossFit |
| Thu | 06:00 CrossFit, 07:15 Engine, 17:30 CrossFit, 18:30 Olympic Lifting |
| Fri | 06:00 CrossFit, 12:00 Open Gym, 17:30 CrossFit |
| Sat | 09:00 Gymnastics |
| Sun | nothing scheduled: add a class as the owner if the showcase is a Sunday |

Programming is written for every class day of the week.

## Job 1. The owner's day (owner, iPhone)

1. Sign in. Land on Timeline: the day's feed, three questions waiting
   for the owner (a chase, a plan upgrade offer, a retention message)
   with six receipts behind them.
2. Show the dock. Scroll the feed: the dock shrinks. Scroll back: it
   returns. Tap the gear: the gym's doors. Tap the avatar: the account
   menu with the member switch.
3. Composer, say: "show me Alice Adams". The member card opens.
4. Say: "move tomorrow's 17:30 CrossFit to 18:00". Read the preview
   aloud, confirm, point at the receipt.
5. Say: "what is uncovered". Nothing yet; that changes in job 3.
6. Page back one day with the arrow. The composer's place says past days
   are the record. Tap Today.

Safe sentences if asked for more: "who has gone quiet", "close the gym
on 25 December" (then "reopen 25 December"), "add a lead called Jo
Ellis". Avoid money, refunds and scheduled sends.

## Job 2. A member books (member01, iPhone Private tab)

1. Open `/book`. The week strip with dots, today's list.
2. Tap Book on tomorrow's 17:30 CrossFit. The row flips to booked with
   an undo. Tap undo, then Book again.
3. Open the class. Cancel the booking from the sheet.
4. Move the strip to Monday and open the 06:00 CrossFit. It is full:
   Join waitlist. Open `/bookings`: the waitlist card shows the rank.
   Finn, Grace and Isla are already ahead in the queue.
5. Tap the grid toggle at the right of the date row to show the two-day
   grid, then back to the list.

If the showcase is after Monday 06:00, make any future class full first
as the owner: "set Thursday's 17:30 CrossFit capacity to 7" (its booked
count), and use that class for the waitlist.

## Job 3. Coach cover and the calendar (coach1 laptop incognito, then owner)

1. Coach1's Timeline lists her classes today. Click one that has not
   started, or open `/classes` and tap tomorrow's 06:00 CrossFit.
2. Request cover, then Yes, ask them. "Asked the coaches."
3. Owner, any device: Timeline shows "Priya Sharma needs cover. Take
   one?" Page forward to that day: the class line reads "Still needs a
   coach" in amber.
4. Owner: say "what is uncovered". The class is named.
5. Owner claims it from the card. Inbox, Cover tab: the notification.
6. Owner, `/classes`: Add class, fill it in, it appears on the grid.
   Day, Week, Month; Bulk.

Stage one extra request from coach1 on a Friday class during the
rehearsal so an uncovered class already exists before the live one.

## Job 4. Programming, messaging, leads (owner, laptop)

1. `/programming`: a programmed day, then Sunday (empty, the Add
   affordance), then back. Member tab: the same day as Alice sees it.
2. `/classes`, open a class, Message class: "Bring a skipping rope
   tomorrow." Member tab, `/inbox`: it has arrived.
3. `/management`, AI Front Desk: the pipeline. Megan Pryce and Tomasz
   Kowalski are cold, Aisha Bello and Rob Jenkins contacted, Steph
   Curran and Leon Baptiste have intros booked, Hannah Moore and Dylan
   Rees have attended a trial, Fatima Zahra converted, Craig Donnelly
   lost. Open one conversation.
4. Composer: "add a lead called Jo Ellis".

## Do not show

Override and comp-grant switches on Team, hard delete, scheduled
campaign send, Stripe checkout, invites by email.

## If something goes wrong

- A class has moved or been cancelled by an earlier rehearsal: reseed
  (teardown then seed) and the week resets.
- The composer does not answer: the hosted Anthropic key. Journey 2 of
  `npm run e2e` against `E2E_SLUG=demo-crossfit-good-life` proves it.
- Do not run "Run the gym" with reseed on, or the sim, against this
  tenant after the final reseed.
