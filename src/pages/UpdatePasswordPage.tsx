import { useState, type FormEvent } from 'react';
import { backend } from '../lib/backend';
import { useAuth } from '../hooks/useAuth';
export default function UpdatePasswordPage() {
 const { finishRecovery } = useAuth();
 const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 async function submit(e: FormEvent) {
  e.preventDefault(); setError('');
  if(password.length<8 || password.length>72) return setError('Пароль: от 8 до 72 символов');
  if(password!==confirm) return setError('Пароли не совпадают');
  setBusy(true);
  try { const result=await backend.updatePassword(password); if(result.error) setError(result.error); else finishRecovery(); }
  catch { setError('Не удалось обновить пароль. Проверьте соединение'); } finally { setBusy(false); }
 }
 return <main className="flex min-h-dvh items-center justify-center p-4"><form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6"><h1 className="text-xl font-bold">Новый пароль</h1><label className="block">Новый пароль<input type="password" autoComplete="new-password" minLength={8} maxLength={72} required className="input mt-1" value={password} onChange={e=>setPassword(e.target.value)} /></label><label className="block">Повторите пароль<input type="password" autoComplete="new-password" required className="input mt-1" value={confirm} onChange={e=>setConfirm(e.target.value)} /></label>{error&&<p role="alert">{error}</p>}<button className="btn-primary w-full" disabled={busy}>{busy?'Сохраняем…':'Сохранить пароль'}</button></form></main>;
}
