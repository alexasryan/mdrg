import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-100 p-6 text-center dark:bg-slate-950">
      <Compass className="h-12 w-12 text-primary-500" aria-hidden />
      <h1 className="text-3xl font-bold">404</h1>
      <p className="max-w-sm text-sm text-slate-500">Такой страницы нет. Возможно, ссылка на звонок устарела или вы ошиблись адресом.</p>
      <Link to="/" className="btn-primary">На главную</Link>
    </div>
  );
}
