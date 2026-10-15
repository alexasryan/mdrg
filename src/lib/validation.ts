import { z } from 'zod';
import { APP_CONFIG } from '../config';

export const loginSchema = z.object({
  email: z.string().trim().email('Введите корректный e-mail'),
  password: z.string().min(1, 'Введите пароль'),
});

export const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Имя должно быть не короче 2 символов')
    .max(60, 'Имя слишком длинное'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,30}$/, 'Логин: 3–30 символов, латиница, цифры и «_»'),
  email: z.string().trim().email('Введите корректный e-mail'),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(72),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Минимум 2 символа').max(60),
  statusText: z.string().trim().max(120, 'Статус слишком длинный'),
});

export const messageSchema = z
  .string()
  .trim()
  .max(APP_CONFIG.limits.maxMessageLength, 'Сообщение слишком длинное');

export const guestNameSchema = z
  .string()
  .trim()
  .min(2, 'Введите имя (минимум 2 символа)')
  .max(40, 'Имя слишком длинное');

export const resetSchema = z.object({
  email: z.string().trim().email('Введите корректный e-mail'),
});

export function validate<T>(schema: z.ZodType<T>, data: unknown): { ok: true; value: T } | { ok: false; errors: Record<string, string> } {
  const res = schema.safeParse(data);
  if (res.success) return { ok: true, value: res.data };
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
