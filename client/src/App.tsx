import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { SplashScreen } from "./components/SplashScreen";
import { Spinner } from "./components/ui";

const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Signup = lazy(() => import("./pages/Signup").then((m) => ({ default: m.Signup })));
const VerifyTwoFactor = lazy(() => import("./pages/VerifyTwoFactor").then((m) => ({ default: m.VerifyTwoFactor })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Editor = lazy(() => import("./pages/Editor").then((m) => ({ default: m.Editor })));
const Audit = lazy(() => import("./pages/Audit").then((m) => ({ default: m.Audit })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Billing = lazy(() => import("./pages/Billing").then((m) => ({ default: m.Billing })));
const Checkout = lazy(() => import("./pages/Checkout").then((m) => ({ default: m.Checkout })));
const SharedProject = lazy(() => import("./pages/SharedProject").then((m) => ({ default: m.SharedProject })));

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8 text-emerald-400" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <SplashScreen />
      <Suspense fallback={<FullScreenLoading />}>
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
      <Route path="/verify-2fa" element={<PublicOnly><VerifyTwoFactor /></PublicOnly>} />
      <Route path="/share/:token" element={<SharedProject />} />

      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/editor/:id" element={<Editor />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/billing/checkout/:paymentId" element={<Checkout />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}
