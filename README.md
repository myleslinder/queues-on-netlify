# Netlify Queues

- Warning, dont use in anything close to a prod environment
- Netlify warning about background and scheduled functions

## How It Works

- Queue orchestrator takes in a config : base url, backround url, secret, db connector

- when a job is enqueued it's inserted into the DB with either "RUNNING" or "SCHEDULED" status
- all immediate jobs are handed to the executioner which runs them in the background
-

## Job Table

### Schema

```prisma
enum JobStatus {
  FAILED
  RUNNING
  SCHEDULED
}

enum ScheduleType {
  CRON
  VERCEL_MS
}

model Job {
  id           String        @id @default(cuid())
  customId     String?       @unique
  queue        String
  payload      String
  runAt        DateTime
  status       JobStatus
  reason       String?       @db.LongText
  count        Int           @default(0)
  scheduleType ScheduleType?
  schedule     String?
  countLimit   Int?

  @@index([queue])
  @@index([runAt])
  @@index([runAt, status])
}
```

### DB adapters

- prisma only so far

## Administrivia

- netlify.toml
- remix.config.js
- \_functions folder with `invoke-background.ts` and `producer.ts`

## Queues

### Define a Queue

- `app/queues/index.ts` || `app/queues/booking-reminder.ts`

```ts
import type { QueueHandler } from "netlify-queue";

export const bookingReminderHandler: QueueHandler<string> = async (job) => {
  console.log("BOOKING");
};
```

The generic you provide for your job type with your handler is the type that will be enforced
for the payload you provide when enqueing a job to this queue

### Register Queue with Orchestrator

- `app/lib/orchestrator.server.ts`

```ts
import { bookingReminderHandler } from "~/queues/booking-reminder";
import { QueueOrchestrator } from "netlify-queue";

export const orchestrator = new QueueOrchestrator({
  bookingReminder: bookingReminderHandler,
});
```

### Enqueue a Job

```ts
await orchestrator.enqueue("bookingReminder", "payload");
```

## Crons

- just make another scheduled function as per netlify docs and put it in the \_functions folder
- actually likely a better way to do this is to just reuse the orchestrator and take in queue and cron
  handlers and then just reschedule the jobs from the chrons vs the queues

## Notes

- API insipired by Quirrel

### thoughts

- should no handler throw error?
