const { z } = require('zod');

const emailSchema = z.string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());

const passwordSchema = z.string()
  .min(8)
  .max(72)
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
    message: 'Password must be at most 72 bytes.',
  });

const registrationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
}).strict();

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict();

module.exports = { registrationSchema, loginSchema };
