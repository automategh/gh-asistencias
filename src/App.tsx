import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'
import ConfigurationProfilePage from './pages/configuration/ConfigurationPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import NewMeetPage from './pages/meets/NewMeetPage'
import PermissionsPage from './pages/permissions/PermissionsPage'
import DepartmentsPage from './pages/configuration/DepartmentsPage'
import MeetsPage from './pages/meets/MeetsPage'
import DetailMeetPage from './pages/meets/DetailMeetPage'
import AttendancePage from './pages/meets/AttendancePage'
import ChekinPage from './pages/meets/ChekinPage'
import RegisterPage from './pages/auth/RegisterPage'
import RoleRoute from './components/auth/role-route'
import ReportsPage from './pages/reports/ReportsPage'
import ReportTrainingPlanPage from './pages/reports/ReportTrainingPlanPage'
import SurveyAdminPage from './pages/survey/SurveyAdminPage'


function App() {
    return (
        <>
            <Routes>
                <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/configure-profile" element={<ConfigurationProfilePage />} />
                    <Route
                        path="/departments"
                        element={(
                            <RoleRoute allowed={["Admin", "HR"]}>
                                <DepartmentsPage />
                            </RoleRoute>
                        )}
                    />
                    <Route path="/new-meeting" element={(
                        <RoleRoute allowed={["Admin", "HR", "Lider", "Instructor"]}>
                            <NewMeetPage />
                        </RoleRoute>
                    )} />
                    <Route path="/meets" element={<MeetsPage />} />
                    <Route path="/meeting/:id" element={<DetailMeetPage />} />
                    <Route path="/attendance/:id" element={(
                        <RoleRoute allowed={["Admin", "HR", "Lider", "Instructor"]}>
                            <AttendancePage />
                        </RoleRoute>
                    )} />
                    <Route
                        path="/permissions"
                        element={(
                            <RoleRoute allowed={["Admin", "HR"]}>
                                <PermissionsPage />
                            </RoleRoute>
                        )}
                    />
                    <Route
                        path="/reports"
                        element={(
                            <RoleRoute allowed={["Admin", "HR", "Lider"]}>
                                <ReportsPage />
                            </RoleRoute>
                        )}
                    />
                    <Route
                        path="/reports/training-plan"
                        element={(
                            <RoleRoute allowed={["Admin", "HR", "Lider"]}>
                                <ReportTrainingPlanPage />
                            </RoleRoute>
                        )}
                    />
                    <Route path="/survey"
                        element={(
                            <RoleRoute allowed={["Admin", "HR"]}>
                                <SurveyAdminPage />
                            </RoleRoute>
                        )}
                    />

                    <Route path="/checkin/:id" element={<ChekinPage />} />
                </Route>
                <Route element={<PublicOnlyRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                </Route>
            </Routes>
        </>
    )
}


export default App
