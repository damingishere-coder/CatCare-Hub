import { Navigate, Route, Routes } from "react-router-dom";

import { AdminLayout } from "../layouts/AdminLayout";
import { CustomersPage } from "../features/customers/CustomersPage";
import { PlansPage } from "../features/plans/PlansPage";
import { TaskExecutionPage } from "../features/tasks/TaskExecutionPage";
import {
  DashboardPage,
  PaymentsPage,
  SettingsPage,
} from "../pages/admin/AdminPages";
import { FillPage } from "../pages/FillPage";
import { MobilePage } from "../pages/MobilePage";
import { NotFoundPage } from "../pages/NotFoundPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="tasks/:id" element={<TaskExecutionPage />} />
        <Route path="orders" element={<Navigate to="/admin/plans?view=orders" replace />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/mobile" element={<MobilePage />} />
      <Route path="/fill" element={<FillPage />} />
      <Route path="/fill/:token" element={<FillPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
