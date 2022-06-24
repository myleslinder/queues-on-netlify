import { symmetric } from "secure-webhooks";
import type { Handler } from "@netlify/functions";
import { schedule } from "@netlify/functions";
import ms from "ms";
import type {
  StringValue,
  EnqueueJobOptions,
  Job,
  JobRegisterConfig,
  QueueHandler,
  QueueOrchestratorConfig,
} from "~/types";
import {
  addMsToDate,
  getDateTimeDiff,
  isDateOnOrBeforeNow,
} from "~/utils";

export class QueueOrchestrator<T extends Record<string, QueueHandler<any>>> {
  private BASE_URL: string;
  private BACKGROUND_URL: string;
  private url: string;

  constructor(
    public config: QueueOrchestratorConfig,
    public queueHandlerMap: T
  ) {
    
    this.BASE_URL = this.config.baseUrl;
  this.BACKGROUND_URL =
    this.config.backgroundUrl ?? `_functions/background/invoke`;
    this.url = `${this.BASE_URL}/${this.BACKGROUND_URL}`;
  }

  /**
   *
   * The workflow
   *
   */

  public async enqueue<Q extends keyof T & string>(
    queue: Q,
    payload: Parameters<T[Q]>[0],
    options?: EnqueueJobOptions
  ) {
    const [item] = await this.enqueueMany(queue, [{ payload, options }]);
    return item;
  }

  public async enqueueMany<
    Q extends keyof T & string,
    P extends Parameters<T[Q]>[0]
  >(
    queue: Q,
    jobs: {
      payload: P;
      options?: EnqueueJobOptions;
    }[]
  ) {
    if (!this.queueHandlerMap[queue]) {
      throw new Error(`No handler provided for queue: "${queue}"`);
    }
    try {
      const dbJobPromises = jobs.map(async (job) => {
        if (job.options?.customId) {
          // If a job already exists with custom id and no override then error out
          await this.handleCustomId(
            job.options.customId,
            job.options.override ?? false
          );
        }
        const runAt = this.determineRunAt(
          job.options?.runAt,
          job.options?.delay
        );
        // Insert the job into the db with "RUNNING" status
        return this.registerJob(queue, job.payload, {
          runAt,
          customId: job.options?.customId,
          countLimit: job.options?.repeat?.times,
          status: isDateOnOrBeforeNow(runAt) ? "RUNNING" : "SCHEDULED",
          scheduleType: job.options?.repeat?.cron
            ? "CRON"
            : job.options?.repeat?.every
            ? "VERCEL_MS"
            : undefined,
          schedule:
            job.options?.repeat?.cron ?? job.options?.repeat?.every
              ? `${job.options.repeat.every}`
              : undefined,
        });
      });

      const dbJobs = await Promise.all(dbJobPromises);
      const immediateJobs = dbJobs.filter((j) => j.status === "RUNNING");
      const executedJobs = await this.executioner(immediateJobs);
      return this.handleJobOutcome(executedJobs);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  private async executioner(currentJobs: Job[]) {
    const executions = await this.execute(currentJobs);
    const executedJobPromises = executions.map((execution) => {
      console.log({ accepted: execution.accepted });
      if (execution.accepted) {
        return Promise.resolve(execution.job);
      }
      return this.handleFailedJob(
        execution.job.id,
        `${execution.responseStatus}: "${execution.reason}"`
      );
    });

    const executedJobs = await Promise.allSettled(executedJobPromises);
    return executedJobs;
  }

  private async execute(jobEnqueues: Job[]) {
    const fetcher = typeof fetch === "function" ? fetch : require("node-fetch");
    const secret = this.config.secret;
    const promises = jobEnqueues.map(async (jobEnqueue) => {
      const body = JSON.stringify(jobEnqueue);

      // TODO: encrypt the body here
      const signature = symmetric.sign(body, secret);
      try {
        const res = await fetcher(this.url, {
          body,
          method: "POST",
          headers: {
            "x-webhook-signature": signature,
          },
        });

        return {
          job: jobEnqueue,
          accepted: res.status === 202,
          responseStatus: res.status,
        };
      } catch (e: any) {
        return {
          job: jobEnqueue,
          accepted: false,
          responseStatus: 500,
          reason: e?.message,
        };
      }
    });
    return Promise.allSettled(promises).then((results) => {
      return results.map((result, i) => {
        if (result.status === "fulfilled") {
          return result.value;
        }
        // if (result.status === "rejected") {
        return {
          job: jobEnqueues[i],
          accepted: false,
          responseStatus: 500,
        };
      });
    });
  }

  /**
   *
   * Netlify handler methods
   *
   */

  invoke: Handler = async (event, context) => {
    const secret = this.config.secret;

    if (event.body && event.headers["x-webhook-signature"]) {
      const isTrustWorthy = symmetric.verify(
        event.body, // 👈 needs to be exactly the same as above, make sure to disable any body parsing for this route
        secret,
        event.headers["x-webhook-signature"]
      );
      console.log({ isTrustWorthy });
      if (!isTrustWorthy) {
        return {
          statusCode: 401,
          body: "Not Authorized",
        };
      }
      // TODO: decrypt the body here
      const jobEnqueue: Job = JSON.parse(event.body);
      const handler = this.queueHandlerMap[jobEnqueue.queue];
      if (!handler) {
        await this.handleFailedJob(jobEnqueue.id, "No handler");
        throw new Error(
          `No handler for queue ${jobEnqueue.queue} with Job Id: ${jobEnqueue.id}`
        );
      }
      // TODO: should we pass a final param sign function into your handler?
      try {
        const jobPayload = JSON.parse(jobEnqueue.payload);
        await handler(jobPayload?.original, {});
        await this.handleCompletedJob(jobEnqueue);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Hello World" }),
        };
      } catch (e: any) {
        //Netlify auto: If function execution returns an error, an execution retry happens after one minute. If it fails again, another retry happens two minutes later.
        await this.handleFailedJob(
          jobEnqueue.id,
          e?.message ?? `error in background code`
        );
      }
    }
    return {
      statusCode: 402,
      body: JSON.stringify({
        noBody: !!event.body,
        noHeader: !!event.headers["x-webhook-signature"],
      }),
    };
  };

  private _scheduledHandler: Handler = async function (
    this: QueueOrchestrator<any>,
    event,
    context
  ) {
    // console.log("Received event:", event);

    const jobs = await this.getJobsToRun();
    console.log({ jobs });
    const outcomes = await this.executioner(jobs);
    this.handleJobOutcome(outcomes);
    return {
      statusCode: 200,
    };
  };
  public scheduledHandler = schedule(
    "* * * * *",
    this._scheduledHandler.bind(this)
  );

  /****
   *
   * Helper functions
   *
   */

  private async handleCustomId(customId: string, override: boolean) {
    const existingCustomJob = await this.getByCustomId(customId);
    if (existingCustomJob) {
      if (override) {
        await this.deleteByCustomId(customId);
      } else {
        throw new Error("A job already exists with the custom id: " + customId);
      }
    }
  }

  private determineRunAt(runAt?: Date, delay?: number | StringValue) {
    let finalRunAt = runAt;
    if (delay && !finalRunAt) {
      let addedMs;
      if (typeof delay === "string") {
        addedMs = ms(delay);
      } else {
        addedMs = delay ?? 0;
      }
      finalRunAt = addMsToDate(addedMs);
    }
    console.log({ finalRunAt });
    return finalRunAt ?? new Date();
  }

  private handleJobOutcome(outcomes: PromiseSettledResult<Job>[]) {
    const successes = outcomes.filter((a) => a.status === "fulfilled");
    const failures = outcomes.filter((a) => a.status === "rejected");
    if (failures.length) {
      const reasonsArr = failures.map((a) =>
        a.status === "rejected" ? a.reason.message : ""
      );
      throw new Error(`Failed to enqueue job: "${reasonsArr.join(", ")}"`);
    }
    return successes.map((item) => {
      if (item.status === "fulfilled") {
        return item.value;
      }
      throw new Error(`Failed to enqueue job: "${item.reason}"`);
    });
  }

  private async handleCompletedJob(job: Job) {
    if (!job.schedule || job.count >= (job.countLimit ?? 0) - 1) {
      return this.delete(job.id);
    }

    let delay = 0;
    if (job.scheduleType === "VERCEL_MS") {
      delay = isNaN(Number(job.schedule))
        ? ms(job.schedule as StringValue)
        : Number(job.schedule);
    } else if (job.scheduleType === "CRON") {
      //handle cron reader
      delay = 0;
    }
    const runAt = this.determineRunAt(undefined, delay);
    return this.setNextRun(job.id, runAt, job.count);
  }

  /**
   *
   * DB Connector pass along functions
   */

  async getById(id: string) {
    return this.config.dbConnector.getById(id);
  }
  async getByCustomId(customId: string) {
    return this.config.dbConnector.getByCustomId(customId);
  }

  async delete(ids: string[] | string) {
    const idList = Array.isArray(ids) ? ids : [ids];
    return this.config.dbConnector.delete(idList);
  }
  async deleteByCustomId(customIds: string[] | string) {
    const idList = Array.isArray(customIds) ? customIds : [customIds];
    return this.config.dbConnector.deleteByCustomId(idList);
  }

  private async handleFailedJob(id: string, reason?: string) {
    return this.config.dbConnector.handleFailedJob(id, reason);
  }

  private async registerJob(
    queue: string,
    payload: any,
    config: JobRegisterConfig
  ) {
    return this.config.dbConnector.registerJob(queue, payload, config);
  }

  private async setNextRun(id: string, runAt: Date, count: number = 0) {
    return this.config.dbConnector.setNextRun(id, runAt, count);
  }

  private async getJobsToRun() {
    const oneMinuteFromNow = getDateTimeDiff(1);
    return this.config.dbConnector.getJobsToRun(oneMinuteFromNow);
  }
}
