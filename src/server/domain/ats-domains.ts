// Job boards and ATS hosts send mail from their own domains, so they say nothing about the employer.
export const ATS_DOMAINS: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'workdayjobs.com',
  'smartrecruiters.com',
  'linkedin.com',
  'indeed.com',
  // Common senders that were missing (SOW-0045, decision 20B).
  'myworkdayjobs.com',
  'icims.com',
  'jobvite.com',
  'teamtailor.com',
];
