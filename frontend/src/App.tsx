import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import QueryTable from './pages/QueryTable';
import AdminIngestion from './pages/AdminIngestion';
import StaffingDashboard from './pages/StaffingDashboard';
import ProcessDetail from './pages/ProcessDetail';
import DepartmentOverview from './pages/DepartmentOverview';
import DeptSnapshot from './pages/DeptSnapshot';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<StaffingDashboard />} />
        <Route path="snapshot" element={<DeptSnapshot />} />
        <Route path="department" element={<DepartmentOverview />} />
        <Route path="query" element={<QueryTable />} />
        <Route path="process" element={<ProcessDetail />} />
        <Route path="admin" element={<AdminIngestion />} />
      </Route>
    </Routes>
  );
}
