import './App.css'
import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import ProtectedRoute from './components/auth/protected-route'
import PublicOnlyRoute from './components/auth/public-route'
import ConfigurationProfilePage from './pages/configuration/ConfigurationPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import NewMeetPage from './pages/meets/NewMeetPage'
import PermissionsPage from './pages/permissions/PermissionsPage'
import UsersPage from './pages/permissions/UsersPage'
import DepartmentsPage from './pages/configuration/DepartmentsPage'
import UserGroupingPage from './pages/configuration/UserGroupingPage'
import MeetsPage from './pages/meets/MeetsPage'
import DetailMeetPage from './pages/meets/DetailMeetPage'
import AttendancePage from './pages/meets/AttendancePage'
import ChekinPage from './pages/meets/ChekinPage'
import RegisterPage from './pages/auth/RegisterPage'
import RoleRoute from './components/auth/role-route'
import ReportsPage from './pages/reports/ReportsPage'
import ReportTrainingPlanPage from './pages/reports/ReportTrainingPlanPage'
import ReportGroupPage from './pages/reports/ReportGroupPage'
import SurveyAdminPage from './pages/survey/SurveyAdminPage'
import NewSurveyPage from './pages/survey/NewSurveyPage'
import EditSurveyPage from './pages/survey/EditSurveyPage'
import SurveyPage from './pages/survey/SurveyPage'
import SurveyResultsPage from './pages/survey/SurveyResultsPage'
import ReportIndividualPage from './pages/reports/ReportIndividualPage'

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
                            <RoleRoute requireAny={["departments_manage"]}>
                                <DepartmentsPage />
                            </RoleRoute>
                        )}
                    />
                    <Route
                        path="/user-grouping"
                        element={(
                            <RoleRoute requireAny={["user_grouping_manage"]}>
                                <UserGroupingPage />
                            </RoleRoute>
                        )}
                    />
                    <Route path="/new-meeting" element={(
                        <RoleRoute requireAny={["meetings_create"]}>
                            <NewMeetPage />
                        </RoleRoute>
                    )} />
                    <Route path="/meets" element={<MeetsPage />} />
                    <Route path="/meeting/:id" element={<DetailMeetPage />} />
                    <Route path="/attendance/:id" element={(
                        <RoleRoute requireAny={["meetings_attendance_view"]}>
                            <AttendancePage />
                        </RoleRoute>
                    )} />
                    <Route
                        path="/permissions"
                        element={(
                            <RoleRoute requireAny={["roles_view", "roles_manage"]}>
                                <PermissionsPage />
                            </RoleRoute>
                        )}
                    />
                    <Route
                        path="/users"
                        element={(
                            <RoleRoute requireAny={["users_view", "users_activate", "users_deactivate", "users_assign_role"]}>
                                <UsersPage />
                            </RoleRoute>
                        )}
                    />
                    <Route
                        path="/reports"
                        element={(
                            <RoleRoute requireAny={["reports_view_team", "reports_view_all"]}>
                                <ReportsPage />
                            </RoleRoute>
                        )}
                    />
                    <Route
                        path="/reports/training-plan"
                        element={(
                            <RoleRoute requireAny={["reports_view_team", "reports_view_all"]}>
                                <ReportTrainingPlanPage />
                            </RoleRoute>
                        )}
                    />

                        <Route
                            path="/reports/group"
                            element={(
                                <RoleRoute requireAny={["reports_view_team", "reports_view_all"]}>
                                    <ReportGroupPage />
                                </RoleRoute>
                            )}
                        />

                    <Route path="/reports/individual" element={(
                        <RoleRoute requireAny={["reports_view_team", "reports_view_all"]}>
                            <ReportIndividualPage />
                        </RoleRoute>
                    )} />

                    <Route path="/survey"
                        element={(
                            <RoleRoute requireAny={["surveys_admin_view"]}>
                                <SurveyAdminPage />
                            </RoleRoute>
                        )}
                    />

                    <Route path='/survey/create' element={(
                        <RoleRoute requireAny={["surveys_create"]}>
                            <NewSurveyPage />
                        </RoleRoute>
                    )} />

                    <Route
                        path="/survey/:id"
                        element={(
                            <RoleRoute requireAny={["surveys_edit"]}>
                                <EditSurveyPage />
                            </RoleRoute>
                        )}
                    />

                    <Route
                        path="/survey/:id/results"
                        element={(
                            <RoleRoute requireAny={["surveys_results_view"]}>
                                <SurveyResultsPage />
                            </RoleRoute>
                        )}
                    />

                    <Route path="/survey/:id/response/:trainingId" element={(
                        <SurveyPage />
                    )} />

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
