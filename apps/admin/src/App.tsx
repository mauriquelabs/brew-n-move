import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import './App.css';

import { supabase } from './lib/supabase';
import { BudgetDetail } from './pages/BudgetDetail';
import { BudgetList } from './pages/BudgetList';
import { BudgetNew } from './pages/BudgetNew';
import { NotAuthorized } from './pages/NotAuthorized';
import { OfferForm } from './pages/OfferForm';
import { PartnerDetail } from './pages/PartnerDetail';
import { PartnerForm } from './pages/PartnerForm';
import { PartnerList } from './pages/PartnerList';
import { SignIn } from './pages/SignIn';

function isAdmin(session: Session | null) {
  return session?.user.app_metadata?.role === 'admin';
}

function AdminRoute({
  children,
  onSession,
  session,
}: {
  children: ReactNode;
  onSession: (session: Session | null) => void;
  session: Session | null;
}) {
  if (!session) {
    return <Navigate to="/" replace />;
  }
  if (!isAdmin(session)) {
    return <NotAuthorized onSession={onSession} />;
  }
  return children;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return <main><p>Loading…</p></main>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SignIn onSession={setSession} session={session} />} path="/" />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <PartnerList onSession={setSession} session={session!} />
            </AdminRoute>
          )}
          path="/partners"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <PartnerForm session={session!} />
            </AdminRoute>
          )}
          path="/partners/new"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <PartnerDetail session={session!} />
            </AdminRoute>
          )}
          path="/partners/:partnerId"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <PartnerForm session={session!} />
            </AdminRoute>
          )}
          path="/partners/:partnerId/edit"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <OfferForm session={session!} />
            </AdminRoute>
          )}
          path="/partners/:partnerId/offers/new"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <OfferForm session={session!} />
            </AdminRoute>
          )}
          path="/partners/:partnerId/offers/:offerId"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <BudgetList onSession={setSession} session={session!} />
            </AdminRoute>
          )}
          path="/reward-budgets"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <BudgetNew session={session!} />
            </AdminRoute>
          )}
          path="/reward-budgets/new"
        />
        <Route
          element={(
            <AdminRoute onSession={setSession} session={session}>
              <BudgetDetail session={session!} />
            </AdminRoute>
          )}
          path="/reward-budgets/:id"
        />
        <Route element={<Navigate to={session ? '/partners' : '/'} replace />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}
