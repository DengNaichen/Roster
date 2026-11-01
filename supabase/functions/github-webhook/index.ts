import { createJobs } from '../../../packages/backend/src/jobs.ts';
const jobs = createJobs(Deno.env.toObject());
Deno.serve((request) => jobs.webhook(request));
