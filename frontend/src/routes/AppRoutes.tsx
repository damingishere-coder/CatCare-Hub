import { Navigate, Route, Routes } from "react-router-dom";

import { AdminLayout } from "../layouts/AdminLayout";
import { CustomersPage } from "../features/customers/CustomersPage";
import { OrdersPage } from "../features/orders/OrdersPage";
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
        <Route path="plans" element={<OrdersPage />} />
        <Route path="orders" element={<Navigate to="/admin/plans" replace />} />
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
