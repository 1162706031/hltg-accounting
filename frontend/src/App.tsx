import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { InventoryLogs } from './pages/InventoryLogs'
import { Invoices } from './pages/Invoices'
import { Items } from './pages/Items'
import { Login } from './pages/Login'
import { Parties } from './pages/Parties'
import { Payments } from './pages/Payments'
import { Placeholder } from './pages/Placeholder'
import { Reconciliation } from './pages/Reconciliation'
import { AuthProvider } from './utils/AuthContext'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="parties" element={<Parties />} />
              <Route path="items" element={<Items />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="inventory/logs" element={<InventoryLogs />} />
              <Route path="payments" element={<Payments />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="reconciliation" element={<Reconciliation />} />
              <Route path="procurement" element={<Placeholder title="采购管理" />} />
              <Route path="sales" element={<Placeholder title="销售管理" />} />
              <Route path="audit" element={<Placeholder title="审核中心" />} />
              <Route path="users" element={<Placeholder title="用户管理" />} />
              <Route path="settings" element={<Placeholder title="系统设置" />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
