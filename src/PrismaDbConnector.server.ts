import { db } from "~/lib/db.server";
import type { DBConnector } from "~/netQueue/types";

export const PrismaDbConnector: DBConnector = {
  getById(id) {
    return db.job.findUnique({ where: { id } });
  },
  getByCustomId(customId) {
    return db.job.findUnique({ where: { customId } });
  },
  delete: (ids) => {
    return db.job.deleteMany({ where: { id: { in: ids } } });
  },
  deleteByCustomId: (customIds) => {
    return db.job.deleteMany({ where: { customId: { in: customIds } } });
  },
  registerJob(
    queue: string,
    payload: any,
    { runAt, customId, countLimit, schedule, scheduleType, status }
  ) {
    return db.job.create({
      data: {
        queue,
        // delay: job.options?.delay,
        customId,
        status,
        payload: JSON.stringify({ original: payload }),
        runAt: runAt ?? new Date(),
        countLimit,
        schedule,
        scheduleType,
      },
    });
  },
  handleFailedJob(id, reason) {
    return db.job.update({
      where: {
        id,
      },
      data: {
        status: "FAILED",
        reason: reason ?? "failed to execute job",
      },
    });
  },
  setNextRun(id, runAt, count = 0) {
    return db.job.update({
      where: {
        id,
      },
      data: {
        status: "SCHEDULED",
        runAt,
        count: count + 1,
      },
    });
  },
  getJobsToRun(lt) {
    // const oneMinuteAgo = getDateTimeDiff(-1);

    return db.job.findMany({
      where: {
        runAt: {
          // gte: oneMinuteAgo,
          lt,
        },
        status: "SCHEDULED",
      },
    });
  },
};
