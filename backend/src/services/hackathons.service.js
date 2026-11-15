const repository = require('../repositories/hackathons.repository');
const AppError = require('../utils/app-error');

const STATUSES = new Set(['upcoming', 'active', 'completed', 'cancelled']);

function pagination(page, pageSize, total) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

function parseStatuses(value) {
  if (value === undefined || value === '') return undefined;
  const statuses = [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
  if (!statuses.length || statuses.some((status) => !STATUSES.has(status))) {
    throw new AppError('status must contain upcoming, active, completed, or cancelled.', 400);
  }
  return statuses;
}

async function listHackathons({ page, pageSize, search, status }) {
  const { hackathons, total } = await repository.listHackathons({
    page, pageSize, search: search || undefined, statuses: parseStatuses(status),
  });
  return { hackathons, pagination: pagination(page, pageSize, total) };
}

async function getHackathon(hackathonId) {
  const hackathon = await repository.findHackathon(hackathonId);
  if (!hackathon) throw new AppError('Hackathon not found.', 404);
  return hackathon;
}

async function listTeams({ hackathonId, page, pageSize, search, availableOnly }) {
  const result = await repository.listTeams({
    hackathonId, page, pageSize, search: search || undefined, availableOnly,
  });
  if (!result) throw new AppError('Hackathon not found.', 404);
  const { teams, total } = result;
  return { hackathonId, teams, pagination: pagination(page, pageSize, total) };
}

module.exports = { listHackathons, getHackathon, listTeams };
