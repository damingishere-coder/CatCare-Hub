import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";

import { AdminLayout } from "../layouts/AdminLayout";
import { CustomersPage } from "../features/customers/CustomersPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { PaymentsPage } from "../features/payments/PaymentsPage";
import { MobileTaskPage } from "../features/mobile/MobileTaskPage";
import { PlansPage } from "../features/plans/PlansPage";
import { TaskExecutionPage } from "../features/tasks/TaskExecutionPage";
import { SettingsPage } from "../pages/admin/AdminPages";
import { FillPage } from "../pages/FillPage";
import { MobilePage } from "../pages/MobilePage";
import { NotFoundPage } from "../pages/NotFoundPage";

function CustomersRoute() {
  const [searchParams] = useSearchParams();
  return <CustomersPage initialCreate={searchParams.get("action") === "create"} />;
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="tasks/:id" element={<TaskExecutionPage />} />
        <Route path="orders" element={<Navigate to="/admin/plans?view=orders" replace />} />
        <Route path="customers" element={<CustomersRoute />} />
        <Route path="payments" element={<PaymentsRoute />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/mobile" element={<MobilePage />} />
      <Route path="/mobile/tasks/:id" element={<MobileTaskPage />} />
      <Route path="/fill" element={<FillPage />} />
      <Route path="/fill/:token" element={<FillPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
