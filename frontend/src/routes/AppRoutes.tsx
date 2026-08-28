import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";

import { AdminLayout } from "../layouts/AdminLayout";
import { CustomersPage } from "../features/customers/CustomersPage";
import { AdminIntakePage } from "../features/intake/AdminIntakePage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { PaymentsPage } from "../features/payments/PaymentsPage";
import { MobileTaskPage } from "../features/mobile/MobileTaskPage";
import { PlansPage } from "../features/plans/PlansPage";
import { OrdersPage } from "../features/orders/OrdersPage";
import { TaskExecutionPage } from "../features/tasks/TaskExecutionPage";
import { SettingsPage } from "../pages/admin/AdminPages";
import { FillPage } from "../pages/FillPage";
import { MobilePage } from "../pages/MobilePage";
import { NotFoundPage } from "../pages/NotFoundPage";

function CustomersRoute() {
  const [searchParams] = useSearchParams();
  return <CustomersPage initialCreate={searchParams.get("action") === "create"} />;
}

function PublicFillRoute() {
  const { token } = useParams<{ token: string }>();
  return <FillPage token={token ?? null} />;
}

function PaymentsRoute() {
  const [searchParams] = useSearchParams();
  const requestedOrderId = Number(searchParams.get("order_id"));
  return (
    <PaymentsPage
      initialCreate={searchParams.get("action") === "create"}
      initialOrderId={Number.isInteger(requestedOrderId) && requestedOrderId > 0 ? requestedOrderId : null}
    />
  );
}

function OrdersRoute() {
  const [searchParams] = useSearchParams();
  return <OrdersPage initialCreate={searchParams.get("action") === "create"} />;
}

function LegacyPlansRedirect() {
  const [searchParams] = useSearchParams();
  const destination = searchParams.get("view") === "orders" ? "/admin/orders" : "/admin/routes";
  return <Navigate to={destination} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/login" element={<Navigate to="/admin" replace />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="routes" element={<PlansPage />} />
        <Route path="plans" element={<LegacyPlansRedirect />} />
        <Route path="tasks/:id" element={<TaskExecutionPage />} />
        <Route path="orders" element={<OrdersRoute />} />
        <Route path="customers" element={<CustomersRoute />} />
        <Route path="intake" element={<AdminIntakePage />} />
        <Route path="payments" element={<PaymentsRoute />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/mobile" element={<MobilePage />} />
      <Route path="/mobile/tasks/:id" element={<MobileTaskPage />} />
      <Route path="/f" element={<PublicFillRoute />} />
      <Route path="/f/:token" element={<PublicFillRoute />} />
      <Route path="/fill" element={<PublicFillRoute />} />
      <Route path="/fill/:token" element={<PublicFillRoute />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
