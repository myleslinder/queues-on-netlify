type Unit =
  | "Years"
  | "Year"
  | "Yrs"
  | "Yr"
  | "Y"
  | "Weeks"
  | "Week"
  | "W"
  | "Days"
  | "Day"
  | "D"
  | "Hours"
  | "Hour"
  | "Hrs"
  | "Hr"
  | "H"
  | "Minutes"
  | "Minute"
  | "Mins"
  | "Min"
  | "M"
  | "Seconds"
  | "Second"
  | "Secs"
  | "Sec"
  | "s"
  | "Milliseconds"
  | "Millisecond"
  | "Msecs"
  | "Msec"
  | "Ms";

type UnitAnyCase = Unit | Uppercase<Unit> | Lowercase<Unit>;

export type StringValue =
  | `${number}`
  | `${number}${UnitAnyCase}`
  | `${number} ${UnitAnyCase}`;

export type Job = {
  id: string;
  customId: string | null;
  queue: string;
  payload: string;
  runAt: Date;
  status: JobStatus;
  reason: string | null;
  count: number;
  scheduleType: ScheduleType | null;
  schedule: string | null;
  countLimit: number | null;
};
type JobStatus = "FAILED" | "RUNNING" | "SCHEDULED";
type ScheduleType = "VERCEL_MS" | "CRON";
export type QueueHandler<T> = (job: T, meta: {}) => Promise<void>;

export type QueueOrchestratorConfig = {
  baseUrl: string;
  backgroundUrl?: string;
  secret: string;
  dbConnector: DBConnector;
};

export interface EnqueueJobOptions {
  /**
   * Serves as a custom id. Can be used to make a job easier to manage.
   * If there's already a job with the same ID, this job will be trashed.
   */
  customId?: string;
  /**
   * Determines what to do when a job
   * with the same ID already exists.
   * false: do nothing (default)
   * true: replace the job
   */
  override?: boolean;

  /**
   * Will delay the job's execution by the specified amount of milliseconds.
   * Supports human-readable notation as of @see https://github.com/vercel/ms.
   * If used together with `repeat`, this will delay the first job to be executed.
   */
  delay?: number | StringValue;

  /**
   * Schedules the job for execution at the specified timestamp.
   */
  runAt?: Date;
  repeat?: {
    /**
     * Will make the job repeat every X milliseconds.
     * Supports human-readable notation as of @see https://github.com/vercel/ms.
     * If `delay` isn't set, the first repetition will be executed immediately.
     */
    every?: number | string;

    /**
     * Can be used in conjunction with @field every and @field cron
     * to limit the number of executions.
     */
    times?: number;

    /**
     * Schedules the job according to the Cron expression.
     * @see https://github.com/harrisiirak/cron-parser for supported syntax
     * If `delay` isn't set, the first repetition will be executed immediately.
     *
     * To specify the timezone, pass a tuple with the IANA timezone in second place.
     * Defaults to Etc/UTC.
     */
    cron?: string; //| [expression: string, timezone: string];
  };
}

export type DBConnector = {
  getById(id: string): Promise<Job | null>;
  getByCustomId(customId: string): Promise<Job | null>;
  delete: (ids: string[]) => void;
  deleteByCustomId: (customIds: string[]) => void;
  registerJob(
    queue: string,
    payload: any,
    { runAt, customId, countLimit, schedule, scheduleType }: JobRegisterConfig
  ): Promise<Job>;
  handleFailedJob(id: string, reason?: string): Promise<Job>;
  setNextRun(id: string, runAt: Date, count?: number): Promise<Job>;
  getJobsToRun(lt: Date): Promise<Job[]>;
};

export type JobRegisterConfig = {
  runAt: Date;
  countLimit?: number;
  schedule?: string;
  scheduleType?: ScheduleType;
  customId?: string;
  status: JobStatus;
};
