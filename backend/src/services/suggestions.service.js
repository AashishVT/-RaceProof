const { pool } = require('../config/database');
const teamsRepository = require('../repositories/teams.repository');
const AppError = require('../utils/app-error');

const SKILL_POINTS = 60;

function normalizeSkill(skill) {
  return String(skill).trim().toLocaleLowerCase('en-US');
}

function timezoneOffsetMinutes(timeZone, date = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      hour: '2-digit',
    }).formatToParts(date).find((value) => value.type === 'timeZoneName')?.value;
    if (!part || part === 'GMT' || part === 'UTC') return 0;
    const match = part.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch (_error) {
    return null;
  }
}

function timeZoneScore(offsetDifferenceHours) {
  if (offsetDifferenceHours === null) return { points: 0, label: 'time zone unknown' };
  if (offsetDifferenceHours <= 3) return { points: 40, label: 'within 3 hours' };
  if (offsetDifferenceHours <= 6) return { points: 30, label: 'within 6 hours' };
  if (offsetDifferenceHours <= 9) return { points: 20, label: 'within 9 hours' };
  if (offsetDifferenceHours <= 12) return { points: 10, label: 'within 12 hours' };
  return { points: 0, label: 'more than 12 hours apart' };
}

function roundScore(value) {
  return Math.round(value * 100) / 100;
}

function rankCandidates({ candidates, teamSkills, teamTimeZones, limit }) {
  const teamSkillSet = new Set(teamSkills.map(normalizeSkill).filter(Boolean));
  const skillFrequency = new Map();
  for (const candidate of candidates) {
    const candidateSkills = new Set((candidate.skills || []).map(normalizeSkill).filter(Boolean));
    for (const skill of candidateSkills) {
      if (!teamSkillSet.has(skill)) skillFrequency.set(skill, (skillFrequency.get(skill) || 0) + 1);
    }
  }

  const candidatesWithSkills = candidates.filter((candidate) => (candidate.skills || []).length > 0).length;
  const minimumCandidateFrequency = candidatesWithSkills
    ? Math.max(1, Math.ceil(candidatesWithSkills * 0.2))
    : 1;
  const skillGaps = [...skillFrequency.entries()]
    .filter(([, frequency]) => frequency >= minimumCandidateFrequency)
    .map(([skill]) => skill)
    .sort();
  const gapSet = new Set(skillGaps);
  const teamOffsets = teamTimeZones.map((timeZone) => timezoneOffsetMinutes(timeZone));

  const suggestions = candidates.map((candidate) => {
    const candidateSkills = [...new Set((candidate.skills || []).map(normalizeSkill).filter(Boolean))];
    const matchedGaps = candidateSkills.filter((skill) => gapSet.has(skill)).sort();
    const skillPoints = skillGaps.length ? (matchedGaps.length / skillGaps.length) * SKILL_POINTS : 0;
    const candidateOffset = timezoneOffsetMinutes(candidate.timeZone);
    const nearestDifference = candidateOffset !== null && teamOffsets.length
      ? Math.min(...teamOffsets.map((offset) => {
        const difference = Math.abs(offset - candidateOffset) / 60;
        return Math.min(difference, 24 - difference);
      }))
      : null;
    const differenceHours = nearestDifference === null ? null : roundScore(nearestDifference);
    const timeZone = timeZoneScore(differenceHours);
    const skillScore = roundScore(skillPoints);
    const totalScore = roundScore(skillScore + timeZone.points);

    return {
      userId: candidate.userId,
      name: candidate.name,
      skills: candidate.skills || [],
      timeZone: candidate.timeZone,
      score: totalScore,
      scoreBreakdown: { skillCoverage: skillScore, timeZoneCompatibility: timeZone.points },
      explanation: {
        matchedSkillGaps: matchedGaps,
        skillGapCoverage: `${matchedGaps.length}/${skillGaps.length}`,
        nearestTeamTimeZoneDifferenceHours: differenceHours,
        timeZoneCompatibility: timeZone.label,
      },
    };
  }).sort((left, right) => right.score - left.score
    || right.scoreBreakdown.skillCoverage - left.scoreBreakdown.skillCoverage
    || left.explanation.nearestTeamTimeZoneDifferenceHours - right.explanation.nearestTeamTimeZoneDifferenceHours
    || left.name.localeCompare(right.name)
    || left.userId.localeCompare(right.userId));

  return { skillGaps, suggestions: suggestions.slice(0, limit) };
}

async function getSuggestions({ actorId, teamId, limit = 10 }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const team = await teamsRepository.findTeam(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    if (team.hackathonStatus !== 'active') {
      throw new AppError('Suggestions are available only for active hackathons.', 409);
    }
    const requesterMembership = await teamsRepository.findMember(client, teamId, actorId);
    if (!requesterMembership) throw new AppError('You must be a team member to view suggestions.', 403);

    const teamSkills = await teamsRepository.listTeamSkills(client, teamId);
    const members = await teamsRepository.listMembers(client, teamId);
    const candidates = await teamsRepository.listEligibleSuggestionCandidates(
      client,
      team.hackathonId,
      teamId,
      actorId,
    );
    const ranking = rankCandidates({
      candidates,
      teamSkills,
      teamTimeZones: members.map((member) => member.timeZone || 'UTC'),
      limit,
    });
    await client.query('COMMIT');
    return {
      teamId,
      hackathonId: team.hackathonId,
      teamSkillGaps: ranking.skillGaps,
      scoring: {
        formula: 'score = skillGapCoverage × 60 + timeZoneCompatibility (0–40)',
        skillGapDefinition: 'A missing team skill held by at least 20% of skill-bearing eligible candidates, rounded up, with a minimum frequency of one.',
        timeZoneBands: [
          { maximumDifferenceHours: 3, points: 40 },
          { maximumDifferenceHours: 6, points: 30 },
          { maximumDifferenceHours: 9, points: 20 },
          { maximumDifferenceHours: 12, points: 10 },
          { maximumDifferenceHours: 24, points: 0 },
        ],
      },
      suggestions: ranking.suggestions,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Preserve the original operation error.
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getSuggestions, rankCandidates };
