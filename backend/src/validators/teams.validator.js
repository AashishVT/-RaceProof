const { z } = require('zod');

const createTeamSchema = z.object({
  hackathonId: z.uuid(),
  teamName: z.string().trim().min(2).max(80),
}).strict();

const emptyBodySchema = z.object({}).strict();
const createInviteSchema = z.object({
  expiresInHours: z.number().int().min(1).max(720).default(24),
}).strict();
const redeemInviteSchema = z.object({
  code: z.string().max(128),
}).strict();

module.exports = { createTeamSchema, emptyBodySchema, createInviteSchema, redeemInviteSchema };
