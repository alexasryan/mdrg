import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { loginSchema, registerSchema, resetSchema, validate } from '../lib/validation';
import { APP_CONFIG } from '../config';

type Mode = 'login' | 'register' | 'reset';

export default function AuthPage() {
  const { signIn, signUp, demoMode } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [info, setInfo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ email: '', password: '', displayName: '', username: '' });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setInfo('');
    setErrors({});
    setBusy(true);
    try {
      if (mode === 'reset') {
        const v = validate(resetSchema, { email: form.email });
        if (!v.ok) return setErrors(v.errors);
        // восстановление пароля — через Supabase (в демо недоступно)
        const { backend } = await import('../lib/backend');
        const res = await backend.resetPassword(form.email);
        if (res.error) setFormError(res.error);
        else setInfo('Если такой e-mail зарегистрирован, мы отправили ссылку для сброса пароля.');
        return;
      }
      if (mode === 'login') {
        const v = validate(loginSchema, form);
        if (!v.ok) return setErrors(v.errors);
        const res = await signIn(v.value.email, v.value.password);
        if (res.error) return setFormError(res.error);
        navigate('/');
        return;
      }
      const v = validate(registerSchema, form);
      if (!v.ok) return setErrors(v.errors);
      const res = await signUp(v.value.email, v.value.password, v.value.displayName, v.value.username);
      if (res.error) return setFormError(res.error);
      if (res.needsConfirmation) {
        setInfo('Аккаунт создан! Подтвердите e-mail по ссылке из письма, затем войдите.');
        setMode('login');
      } else {
        navigate('/');
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof typeof form, label: string, type = 'text', autoComplete?: string) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={name} type={type} autoComplete={autoComplete} className={`input ${errors[name] ? '!border-red-500' : ''}`} value={form[name]} onChange={set(name)} />
      {errors[name] && <p className="mt-1 text-xs text-red-500" role="alert">{errors[name]}</p>}
    </div>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-2xl bg-primary-600 p-3 shadow-lg shadow-primary-600/30">
            <MessageCircle className="h-8 w-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{APP_CONFIG.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{APP_CONFIG.tagline}</p>
          {demoMode && (
            <p className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              Демо-режим без сервера. Тестовые аккаунты: anna@demo.local / ivan@demo.local, пароль demo1234
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6" noValidate>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErrors({}); setFormError(''); setInfo(''); }} className={`rounded-lg py-2 text-sm font-medium transition-colors ${mode === m ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                {m === 'login' ? 'Вход' : 'Регистрация'}
              </button>
            ))}
          </div>

          {mode === 'register' && (
            <>
              {field('displayName', 'Имя', 'text', 'name')}
              {field('username', 'Логин (для поиска)', 'text', 'username')}
            </>
          )}
          {field('email', 'Электронная почта', 'email', 'email')}
          {mode !== 'reset' && field('password', 'Пароль', 'password', mode === 'login' ? 'current-password' : 'new-password')}

          {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300" role="alert">{formError}</p>}
          {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{info}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Восстановить'}
          </button>

          <div className="flex justify-between text-xs text-slate-500">
            {mode === 'login' ? (
              <button type="button" className="hover:underline" onClick={() => setMode('reset')}>
                Забыли пароль?
              </button>
            ) : mode === 'reset' ? (
              <button type="button" className="hover:underline" onClick={() => setMode('login')}>
                Вернуться ко входу
              </button>
            ) : (
              <span />
            )}
            <Link to="/" className="hover:underline">
              На главную
            </Link>
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">Пароли хранятся только в Supabase Auth. Мы не храним пароли в базе данных.</p>
      </div>
    </div>
  );
}
