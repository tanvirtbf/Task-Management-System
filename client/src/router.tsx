import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import Root from "./layouts/Root";
import AppShell from "./layouts/AppShell";
import AuthLayout from "./layouts/AuthLayout";
import PublicFormLayout from "./layouts/PublicFormLayout";
import RequireAuth from "./layouts/RequireAuth";
import RequireGuest from "./layouts/RequireGuest";
// Auth pages — small, keep eager
import LoginPage from "./pages/auth/Login";
import TwoFactorChallengePage from "./pages/auth/TwoFactorChallenge";
import ForgotPasswordPage from "./pages/auth/ForgotPassword";
import ResetPasswordPage from "./pages/auth/ResetPassword";
import AcceptInvitationPage from "./pages/auth/AcceptInvitation";
import TwoFactorSetupPage from "./pages/auth/TwoFactorSetup";
// Home + Task redirect — small, keep eager
import HomePage from "./pages/home/HomePage";
import TaskRedirect from "./pages/task/TaskRedirect";
import { RouteFallback } from "./components/shared/RouteFallback";

// Heavy / less-frequently-visited pages — lazy
const SpacePage = lazy(() => import("./pages/space/SpacePage"));
const ListPage = lazy(() => import("./pages/list/ListPage"));
const FormsListPage = lazy(() => import("./pages/forms/FormsListPage"));
const FormBuilderPage = lazy(() => import("./pages/forms/FormBuilderPage"));
const PublicFormPage = lazy(() => import("./pages/public-form/PublicFormPage"));
const CustomFieldsSettings = lazy(
    () => import("./pages/settings/CustomFieldsSettings"),
);
const AutomationsListPage = lazy(
    () => import("./pages/automations/AutomationsListPage"),
);
const AutomationBuilderPage = lazy(
    () => import("./pages/automations/AutomationBuilderPage"),
);
const AutomationRunsPage = lazy(
    () => import("./pages/automations/AutomationRunsPage"),
);
const TemplatesListPage = lazy(
    () => import("./pages/templates/TemplatesListPage"),
);
const DashboardsListPage = lazy(
    () => import("./pages/dashboards/DashboardsListPage"),
);
const DashboardViewPage = lazy(
    () => import("./pages/dashboards/DashboardViewPage"),
);
const SettingsLayout = lazy(() => import("./pages/settings/SettingsLayout"));
const ProfileSettings = lazy(() => import("./pages/settings/ProfileSettings"));
const NotificationsSettings = lazy(
    () => import("./pages/settings/NotificationsSettings"),
);
const SecuritySettings = lazy(
    () => import("./pages/settings/SecuritySettings"),
);
const WorkspaceSettings = lazy(
    () => import("./pages/settings/WorkspaceSettings"),
);
const MembersSettings = lazy(() => import("./pages/settings/MembersSettings"));
const RolesSettings = lazy(() => import("./pages/settings/RolesSettings"));
const TaskTypesSettings = lazy(
    () => import("./pages/settings/TaskTypesSettings"),
);
const TagsSettings = lazy(() => import("./pages/settings/TagsSettings"));
const StatusesSettings = lazy(
    () => import("./pages/settings/StatusesSettings"),
);
const IntegrationsSettings = lazy(
    () => import("./pages/settings/IntegrationsSettings"),
);
const WebhooksSettings = lazy(
    () => import("./pages/settings/WebhooksSettings"),
);
const ImportExportSettings = lazy(
    () => import("./pages/settings/ImportExportSettings"),
);
const BillingSettings = lazy(() => import("./pages/settings/BillingSettings"));
const InboxPage = lazy(() => import("./pages/inbox/InboxPage"));
const SearchPage = lazy(() => import("./pages/search/SearchPage"));
const TimeReportPage = lazy(
    () => import("./pages/time-report/TimeReportPage"),
);
const NotepadPage = lazy(() => import("./pages/notepad/NotepadPage"));
const RemindersPage = lazy(() => import("./pages/reminders/RemindersPage"));

const lazyRoute = (node: ReactElement): ReactElement => (
    <Suspense fallback={<RouteFallback />}>{node}</Suspense>
);

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Root />,
        children: [
            // Public form pages — no auth, no app shell
            {
                element: <PublicFormLayout />,
                children: [
                    {
                        path: "forms/:slug",
                        element: lazyRoute(<PublicFormPage />),
                    },
                ],
            },

            // Public / guest-only auth pages
            {
                element: <RequireGuest />,
                children: [
                    {
                        element: <AuthLayout />,
                        children: [
                            { path: "login", element: <LoginPage /> },
                            {
                                path: "login/2fa",
                                element: <TwoFactorChallengePage />,
                            },
                            {
                                path: "forgot-password",
                                element: <ForgotPasswordPage />,
                            },
                            {
                                path: "reset-password/:token",
                                element: <ResetPasswordPage />,
                            },
                            {
                                path: "invitation/:token",
                                element: <AcceptInvitationPage />,
                            },
                        ],
                    },
                ],
            },

            // Authenticated app shell
            {
                element: <RequireAuth />,
                children: [
                    {
                        element: <AppShell />,
                        children: [
                            { path: "", element: <HomePage /> },
                            { path: "inbox", element: lazyRoute(<InboxPage />) },
                            {
                                path: "search",
                                element: lazyRoute(<SearchPage />),
                            },
                            {
                                path: "dashboards",
                                element: lazyRoute(<DashboardsListPage />),
                            },
                            {
                                path: "dashboards/:dashboardId",
                                element: lazyRoute(<DashboardViewPage />),
                            },
                            {
                                path: "notepad",
                                element: lazyRoute(<NotepadPage />),
                            },
                            {
                                path: "reminders",
                                element: lazyRoute(<RemindersPage />),
                            },
                            {
                                path: "time-report",
                                element: lazyRoute(<TimeReportPage />),
                            },
                            {
                                path: "settings",
                                element: lazyRoute(<SettingsLayout />),
                                children: [
                                    {
                                        index: true,
                                        element: (
                                            <Navigate
                                                to="/settings/profile"
                                                replace
                                            />
                                        ),
                                    },
                                    {
                                        path: "profile",
                                        element: lazyRoute(<ProfileSettings />),
                                    },
                                    {
                                        path: "notifications",
                                        element: lazyRoute(
                                            <NotificationsSettings />,
                                        ),
                                    },
                                    {
                                        path: "security",
                                        element: lazyRoute(
                                            <SecuritySettings />,
                                        ),
                                    },
                                    {
                                        path: "workspace",
                                        element: lazyRoute(
                                            <WorkspaceSettings />,
                                        ),
                                    },
                                    {
                                        path: "members",
                                        element: lazyRoute(
                                            <MembersSettings />,
                                        ),
                                    },
                                    {
                                        path: "roles",
                                        element: lazyRoute(<RolesSettings />),
                                    },
                                    {
                                        path: "task-types",
                                        element: lazyRoute(
                                            <TaskTypesSettings />,
                                        ),
                                    },
                                    {
                                        path: "tags",
                                        element: lazyRoute(<TagsSettings />),
                                    },
                                    {
                                        path: "statuses",
                                        element: lazyRoute(
                                            <StatusesSettings />,
                                        ),
                                    },
                                    {
                                        path: "custom-fields",
                                        element: lazyRoute(
                                            <CustomFieldsSettings />,
                                        ),
                                    },
                                    {
                                        path: "integrations",
                                        element: lazyRoute(
                                            <IntegrationsSettings />,
                                        ),
                                    },
                                    {
                                        path: "webhooks",
                                        element: lazyRoute(
                                            <WebhooksSettings />,
                                        ),
                                    },
                                    {
                                        path: "import-export",
                                        element: lazyRoute(
                                            <ImportExportSettings />,
                                        ),
                                    },
                                    {
                                        path: "billing",
                                        element: lazyRoute(<BillingSettings />),
                                    },
                                ],
                            },
                            {
                                path: "s/:spaceId",
                                element: lazyRoute(<SpacePage />),
                            },
                            {
                                path: "s/:spaceId/l/:listId",
                                element: lazyRoute(<ListPage />),
                            },
                            {
                                path: "s/:spaceId/l/:listId/:viewId",
                                element: lazyRoute(<ListPage />),
                            },
                            { path: "t/:taskKey", element: <TaskRedirect /> },

                            // Authenticated forms management
                            {
                                path: "forms",
                                element: lazyRoute(<FormsListPage />),
                            },
                            {
                                path: "forms/:formId/edit",
                                element: lazyRoute(<FormBuilderPage />),
                            },

                            // Automations & Templates
                            {
                                path: "automations",
                                element: lazyRoute(<AutomationsListPage />),
                            },
                            {
                                path: "automations/new",
                                element: lazyRoute(<AutomationBuilderPage />),
                            },
                            {
                                path: "automations/:automationId/edit",
                                element: lazyRoute(<AutomationBuilderPage />),
                            },
                            {
                                path: "automations/:automationId/runs",
                                element: lazyRoute(<AutomationRunsPage />),
                            },
                            {
                                path: "templates",
                                element: lazyRoute(<TemplatesListPage />),
                            },
                        ],
                    },
                    // 2FA setup uses AuthLayout (no sidebar)
                    {
                        element: <AuthLayout />,
                        children: [
                            { path: "2fa-setup", element: <TwoFactorSetupPage /> },
                        ],
                    },
                ],
            },

            { path: "*", element: <Navigate to="/" replace /> },
        ],
    },
]);
