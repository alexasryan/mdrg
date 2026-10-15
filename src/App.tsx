import { Component, type ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { APP_CONFIG } from './config';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SettingsProvider } from './hooks/useSettings';
import { CallProvider } from './hooks/useCalls';
import { IncomingCallBanner } from './components/IncomingCallBanner';
import { Spinner } from './components/ui';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import CreateCallPage from './pages/CreateCallPage';
import RoomPage from './pages/RoomPage';
import NotFoundPage from './pages/NotFoundPage';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-lg font-bold">Что-то пошло не так</h1>
          <p className="max-w-md text-sm text-slate-500">{this.state.error.message}</p>
          <button className="btn-primary" onClick={() => location.reload()}>Перезагрузить</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function FullscreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-100 dark:bg-slate-950">
      <Spinner className="h-8 w-8 text-primary-500" />
      <p className="text-sm text-slate-500">Загрузка {APP_CONFIG.name}…</p>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function Shell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  useEffect(() => {
    document.title = `${APP_CONFIG.name}${location.pathname === '/' ? '' : ' · ' + location.pathname.split('/').filter(Boolean).join('/')}`;
  }, [location]);
  if (loading) return <FullscreenLoader />;
  return (
    <>
      {user && <IncomingCallBanner />}
      <Routes>
        <Route path="/" element={<Protected><CallProvider userId={user!.id}><HomePage /></CallProvider></Protected>} />
        <Route path="/chat/:chatId" element={<Protected><CallProvider userId={user!.id}><HomePage /></CallProvider></Protected>} />
        <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
        <Route path="/create-call" element={<Protected><CreateCallPage /></Protected>} />
        <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
        {/* комнаты и прямые звонки доступны гостям без авторизации */}
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="/call/:id" element={<RoomPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <SettingsProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </SettingsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
