import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ReportView       from './views/ReportView';
import DashboardView    from './views/DashboardView';
import SettingsView     from './views/SettingsView';
import PublicReportView from './views/PublicReportView';
import RapportageView   from './views/RapportageView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/report"    element={<ReportView />} />
        <Route path="/meld"      element={<PublicReportView />} />
        <Route path="/dashboard" element={<DashboardView />} />
        <Route path="/settings"   element={<SettingsView />} />
        <Route path="/rapportage" element={<RapportageView />} />
        <Route path="*"          element={<Navigate to="/report" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
