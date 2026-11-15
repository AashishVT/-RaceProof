const { z } = require('zod');
const AppError = require('../utils/app-error');
const service = require('../services/hackathons.service');

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.string().max(100).optional(),
  availableOnly: z.enum(['true', 'false']).optional(),
}).strict();

function parseQuery(request) {
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) throw new AppError('Invalid query parameters.', 400, { details: parsed.error.issues });
  return parsed.data;
}

async function list(request, response, next) {
  try {
    const query = parseQuery(request);
    const result = await service.listHackathons({
      page: query.page, pageSize: query.pageSize, search: query.q, status: query.status,
    });
    return response.json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function get(request, response, next) {
  try {
    const hackathon = await service.getHackathon(request.params.hackathonId);
    return response.json({ success: true, data: { hackathon } });
  } catch (error) { return next(error); }
}

async function listTeams(request, response, next) {
  try {
    const query = parseQuery(request);
    const result = await service.listTeams({
      hackathonId: request.params.hackathonId,
      page: query.page,
      pageSize: query.pageSize,
      search: query.q,
      availableOnly: query.availableOnly === 'true',
    });
    return response.json({ success: true, data: result });
  } catch (error) { return next(error); }
}

module.exports = { list, get, listTeams };
