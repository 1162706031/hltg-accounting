import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { RequireRole } from './components/RequireRole'
import { Audit } from './pages/Audit'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { InventoryLogs } from './pages/InventoryLogs'
import { Invoices } from './pages/Invoices'
import { Items } from './pages/Items'
import { Login } from './pages/Login'
import { OperationLogs } from './pages/OperationLogs'
import { Outsource } from './pages/Outsource'
import { Parties } from './pages/Parties'
import { Payments } from './pages/Payments'
import { Placeholder } from './pages/Placeholder'
import { Procurement } from './pages/Procurement'
import { Reconciliation } from './pages/Reconciliation'
import { Sales } from './pages/Sales'
import { Smelting } from './pages/Smelting'
import { Users } from './pages/Users'
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
              <Route path="smelting" element={<Smelting />} />
              <Route path="outsource" element={<Outsource />} />
              <Route path="procurement" element={<Procurement />} />
              <Route path="sales" element={<Sales />} />
              <Route path="reconciliation" element={<Reconciliation />} />
              <Route path="payments" element={<Payments />} />
              <Route path="invoices" element={<Invoices />} />
              <Route
                path="audit"
                element={
                  <RequireRole roles={['admin', 'reviewer']}>
                    <Audit />
                  </RequireRole>
                }
              />
              <Route
                path="operation-logs"
                element={
                  <RequireRole roles={['admin']}>
                    <OperationLogs />
                  </RequireRole>
                }
              />
              <Route
                path="users"
                element={
                  <RequireRole roles={['admin']}>
                    <Users />
                  </RequireRole>
                }
              />
              <Route
                path="settings"
                element={
                  <RequireRole roles={['admin']}>
                    <Placeholder title="系统设置" />
                  </RequireRole>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
