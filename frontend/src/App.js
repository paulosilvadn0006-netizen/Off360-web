import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Loading } from "@/components/shared";

import Landing from "@/pages/Landing";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Forgot from "@/pages/auth/Forgot";
import AdminLogin from "@/pages/auth/AdminLogin";
import AdminChangePassword from "@/pages/auth/AdminChangePassword";

import ConsumerLayout from "@/layouts/ConsumerLayout";
import Home from "@/pages/consumer/Home";
import Explore from "@/pages/consumer/Explore";
import EstablishmentDetail from "@/pages/consumer/EstablishmentDetail";
import Scan from "@/pages/consumer/Scan";
import Transaction from "@/pages/consumer/Transaction";
import Economy from "@/pages/consumer/Economy";
import Raffles from "@/pages/consumer/Raffles";
import Notifications from "@/pages/consumer/Notifications";
import MyRequests from "@/pages/consumer/MyRequests";
import ConsumerProfile from "@/pages/consumer/Profile";
import Taxi from "@/pages/consumer/Taxi";

import MerchantLayout from "@/layouts/MerchantLayout";
import MDashboard from "@/pages/merchant/Dashboard";
import MOrders from "@/pages/merchant/Orders";
import DelivererLayout from "@/layouts/DelivererLayout";
import Deliverer from "@/pages/deliverer/Deliverer";
import OrderTracking from "@/pages/consumer/OrderTracking";
import MValidate from "@/pages/merchant/Validate";
import MTransactions from "@/pages/merchant/Transactions";
import MQRCode from "@/pages/merchant/QRCode";
import MStories from "@/pages/merchant/Stories";
import MEstablishment from "@/pages/merchant/Establishment";
import MRequests from "@/pages/merchant/Requests";
import MBoosts from "@/pages/merchant/Boosts";
import MSubscription from "@/pages/merchant/Subscription";

import AdminLayout from "@/layouts/AdminLayout";
import AOverview from "@/pages/admin/Overview";
import AConsumers from "@/pages/admin/Consumers";
import AMerchants from "@/pages/admin/Merchants";
import AEstablishments from "@/pages/admin/Establishments";
import ASubscriptions from "@/pages/admin/Subscriptions";
import AFinancial from "@/pages/admin/Financial";
import ATransactions from "@/pages/admin/Transactions";
import ACategories from "@/pages/admin/Categories";
import ARaffles from "@/pages/admin/Raffles";
import ASettings from "@/pages/admin/Settings";
import AAudit from "@/pages/admin/Audit";
import ABoosts from "@/pages/admin/Boosts";

function RoleRoute({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading || user === null) return <div className="min-h-screen bg-off-bg"><Loading /></div>;
  if (!user) return <Navigate to={role === "admin" ? "/admin-access" : "/login"} state={{ from: location }} replace />;
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  if (role === "admin" ? !isAdmin : user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function homeFor(role) {
  if (role === "merchant") return "/merchant";
  if (role === "deliverer") return "/deliverer";
  if (role === "admin" || role === "super_admin") return "/admin";
  return "/home";
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen bg-off-bg"><Loading /></div>;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicOnly><Landing /></PublicOnly>} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot" element={<PublicOnly><Forgot /></PublicOnly>} />
      <Route path="/admin-access" element={<PublicOnly><AdminLogin /></PublicOnly>} />
      <Route path="/admin/trocar-senha" element={<RoleRoute role="admin"><AdminChangePassword /></RoleRoute>} />

      <Route element={<RoleRoute role="consumer"><ConsumerLayout /></RoleRoute>}>
        <Route path="/home" element={<Home />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/establishment/:id" element={<EstablishmentDetail />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/transaction/:id" element={<Transaction />} />
        <Route path="/economy" element={<Economy />} />
        <Route path="/my-requests" element={<MyRequests />} />
        <Route path="/raffles" element={<Raffles />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<ConsumerProfile />} />
        <Route path="/order/:id" element={<OrderTracking />} />
        <Route path="/taxi" element={<Taxi />} />
      </Route>

      <Route element={<RoleRoute role="deliverer"><DelivererLayout /></RoleRoute>}>
        <Route path="/deliverer" element={<Deliverer />} />
      </Route>

      <Route element={<RoleRoute role="merchant"><MerchantLayout /></RoleRoute>}>
        <Route path="/merchant" element={<MDashboard />} />
        <Route path="/merchant/orders" element={<MOrders />} />
        <Route path="/merchant/validate" element={<MValidate />} />
        <Route path="/merchant/transactions" element={<MTransactions />} />
        <Route path="/merchant/qr" element={<MQRCode />} />
        <Route path="/merchant/stories" element={<MStories />} />
        <Route path="/merchant/requests" element={<MRequests />} />
        <Route path="/merchant/boosts" element={<MBoosts />} />
        <Route path="/merchant/establishment" element={<MEstablishment />} />
        <Route path="/merchant/subscription" element={<MSubscription />} />
      </Route>

      <Route element={<RoleRoute role="admin"><AdminLayout /></RoleRoute>}>
        <Route path="/admin" element={<AOverview />} />
        <Route path="/admin/consumers" element={<AConsumers />} />
        <Route path="/admin/merchants" element={<AMerchants />} />
        <Route path="/admin/establishments" element={<AEstablishments />} />
        <Route path="/admin/subscriptions" element={<ASubscriptions />} />
        <Route path="/admin/financial" element={<AFinancial />} />
        <Route path="/admin/transactions" element={<ATransactions />} />
        <Route path="/admin/categories" element={<ACategories />} />
        <Route path="/admin/raffles" element={<ARaffles />} />
        <Route path="/admin/settings" element={<ASettings />} />
        <Route path="/admin/audit" element={<AAudit />} />
        <Route path="/admin/boosts" element={<ABoosts />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="top-center" theme="dark" richColors />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
