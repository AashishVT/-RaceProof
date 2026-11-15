const { z } = require('zod');
const suggestionsService = require('../services/suggestions.service');
const AppError = require('../utils/app-error');

const limitSchema = z.coerce.number().int().min(1).max(50);

async function getSuggestions(request, response, next) {
  try {
    const parsedLimit = request.query.limit === undefined
      ? { success: true, data: 10 }
      : limitSchema.safeParse(request.query.limit);
    if (!parsedLimit.success) throw new AppError('limit must be an integer from 1 to 50.', 400);

    const result = await suggestionsService.getSuggestions({
      actorId: request.user.id,
      teamId: request.params.teamId,
      limit: parsedLimit.data,
    });
    return response.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getSuggestions };
